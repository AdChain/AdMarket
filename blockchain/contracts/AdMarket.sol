pragma solidity ^0.4.7;

// Current Implementation
// 1. We do not track winning bids, only served impressions
// 2. The impression count and balance are both private
// 3. The Arbiter is specified when Demand and Supply open a channel, but not implemented
// 4. Both parties can propose a checkpoint / close
// 5. Both parties can challenge checkpoint / close
// 6. Both parties can finalize a checkpoint / close
// 7. Closing a channel overrides the checkpointing as if it never happened
// 8. AdMarket does not know about any other contracts in the trust hierarchy
// 9. No implementation of "rulesets"
// 10. AdMarket is responsible for providing raw logs, not only of impressions, but also of tracking data

// Open Question
// 1. Privacy - What do we want to keep offchain?
//  - We can keep both balances and impression counts offchain and only reveal in case of disputes
//  - The Arbiter / Arbiter needs to post onchain about the fraction of impressions that were fraud
//    - actually could this happen offchain as well? Demand updates its amount owed based on the Arbiter's input...
//    - this means less transparency
// 2. what happens if I start checkpointing early and want to close but then the channel expires?
//  - it should be fine, because closing overrides CHECKPOINTING
// 3. How does settling work if we don't report balances onchain?
//  - how does the supply acknowledge being paid?
//  - demand can only decrease amount owed if supply signs off... but onchain or off?
//  - settle specific checkpoints? yea, we also want to reset from 0 again for both balance and impressions
//  - if we don't use impressions to settle checkpoint disputes (which we still maybe can) then need sequence numbers again
// 4. Do we want to track individual winning bids? How would we do so?
//  - The drive to do this comes from publishing conversion rates for Demand partners because some win bids and don't serve the ad
//  - Two correlated state channels:
//    - Supply already notifies Demand of winning bid in header bidding. That message could be a signed state update.
//    - The root would be the merkle root of the previous state and the current state:
//      - winning bids (#)
//      - bidId (same as impressionId?)
//      - winPrice
//      - bidPrice
//      - demandSignature - the Demand signature on the id / bidPrice of the bid
//    - Demand could include the most recent bid count as a param in its impression state updates
//      - Alternatively, Demand and Supply could both sign ACKs of hashes of state updates they send each other
//    - We can publish the bid conversion rate without publishing the total bids
//    - There could be a race condition between the Supply -> Demand "winning bid" message and the Page -> Demand "ad request"
//      - This means the Demand should optimistically serve an ad even if it hasn't been notified yet
//      - Is this actually true? Or is the "winning bid" message the same as the "ad request" message?
//  - Issues:
//    - Supply can attack Demand reputation for example by telling multiple Demand that they all won the bid.
//    - Supply can also just tell a single Demand they won but then serving the page without an ad (no incentive to do this though)
//    - Possible to fix for this while preserving privacy by having a third party audit Supply
//    - Auditing will catch Supply telling multiple Demand they won, but not Supply not serving an ad on purpose
// 5. How do disputes work?
//  - What are the different types of disputes that may need outside intervention?
//    - Demand is withholding payment, refusing to pay, or otherwise evading paying
//      - In this case we want to make the balance public
//      - requestPayment -> Supply publicly requests a payment from Demand.
//      - settleBalance -> If Demand pays, Supply can settle its balance with Demand
//      - requestArbitration -> Either Supply or Demand can request arbitration by ACF
//    - Arbiter is not providing its judgement in time
//    - Arbiter is providing questionable judgement (does anyone actually have the power to audit?)
//  - Perhaps we call a "dispute judgement" method which notifies the ACF?
//    - and perhaps brining a dispute to the ACF requires an offer of AdToken as a fee? (antispam)
//  - The simple case is to allow Arbiter to provide their judgement onchain.

// Notes
// 1. Demand can sign a state update, not send it to Supply, and instead submit it as a checkpoint.
//  - Supply will respond with the most recent state it knows about, and force Demand to reveal the state too.
//  - The burden of proof is thus on the party initiating the checkpoint.
//  - When Demand reveals, the state will either have a higher impression count, in which case Supply earns money, or
//    it will be invalid (because it has produced a new state based on the same previous hash)
//  - We need to punish invalid states -> if Supply has proof of Demand signing two states at the same height, punish Demand
// 2. Currently we don't auto close the channel if there is a dispute while checkpointing. This could be a configurable default.
// 3. It would be useful to have periodic consensus between Supply and Demand
//  - Supply could acknowledge out-of-band payments entirely offchain
//  - Demand could acknowledge the running bid count, or alternatively the latest Supply bid merkle root
//  - Arbiter could provide its judgement on how many impressions are valid

// TODO
// 1. style:
//    - replace negative conditional checks -- !() -- with != wherever possible
// 2. Arbiter - how does the Arbiter work?
//  - what mechanism allows it to inform the impression count?
//    - does it do so onchain or offchain? If onchain, impression counts must be made public.
//  - we have the notion of Impression Settlement Contracts (ISC) on the whitepaper atm
//    - these can have oracles or voting or other complexity
// 3. style - update comments to capitalize Demand and Supply
// 4. modifiers / checks - move as many checks to modifiers, regardless of gas costs
// 5. checkpointing a channel should (optionally) renew its lifetime
// 6. implement checkpointing challenge / response / verification
//  - need to prove that a field in a merkle proof is a specific field e.g. "impid:123"
//  - only need this for fields we want to prove onchain - e.g. to manage impression counts, payments, or sequence numbers
//  - at least need it for sequence numbers / impressions to settle ordering onchain
//  - means I need to implement "createStateUpdate" and "verifyStateUpdate" methods
// 7. Decide how supply is discovered. Demand needs to send them impression tracking messages.
//  - could use the same onchain mechanism as demand + arbiter
//  - could instead attach IP address onto the beacon when it fires
//  - could attach to the "winning bid" message notification

import "ECVerify.sol";

// Registers supply and demand, facilitates discovery, and manages the impression tracking state channels between them
contract AdMarket is ECVerify {

  bytes32 emptyString = hex"c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";

  address owner;
  mapping (address => string) public registeredDemand;
  mapping (address => bool) public registeredSupply;
  mapping (address => string) public registeredArbiter;
  mapping (bytes32 => Channel) channels;
  mapping (bytes32 => Challenge) challenges;
  // TODO
  // mapping (bytes32 => Settlement) settlements;
  mapping (address => address[]) channelPartners;

  uint256 public channelCount = 0;
  uint256 public channelTimeout; // max lifetime of a channel in blocks
  uint256 public challengePeriod; // number of blocks to wait for challenges before closing

  // Root is the merkle root of the previous root and the current state. The current state includes:
  //  - balance: demand -> supply
  //  - impressions (#)
  //  - impressionId
  //  - impressionPrice
  // In case of a dispute, the data can be made public and verified onchain using merkle proofs.
  // For example, to challenge a replay attack, we provide impression count (sequence number) and merkle proof for both the replay
  //  state and the most recent one.

  enum ChannelState { Open, Checkpointing, Closing, Closed }

  struct Channel {
    // State Variables
    address contractId;
    bytes32 channelId;
    address demand;
    address supply;
    bytes32 root;

    // Metadata (not included in offchain state updates)
    address arbiter;
    ChannelState state;
    uint256 expiration; // block number after which the channel expires and can be closed by anyone (set in openChannel)
    uint256 challengeTimeout; // block number after which the channel can be closed by its participants (set in proposeCloseChannel)
    bytes32 proposedRoot; // a placeholder root which is only stored and set after the challenge period is over
  }

  struct Challenge {
    bytes32 challengeRoot; // the root of the most recent channel state, according to the challenging party
    uint256 impressions; // the state with the higher impression count wins
  }

  modifier only_owner() {
    if (msg.sender != owner) throw;
    _;
  }

  modifier only_registered_demand() {
    if (isEmptyString(registeredDemand[msg.sender])) throw;
    _;
  }

  modifier only_registered_arbiter() {
    if (isEmptyString(registeredArbiter[msg.sender])) throw;
    _;
  }

  event DemandRegistered(address indexed demand);
  event SupplyRegistered(address indexed supply);
  event ArbiterRegistered(address indexed arbiter);
  event DemandDeregistered(address indexed demand);
  event SupplyDeregistered(address indexed supply);
  event ArbiterDeregistered(address indexed arbiter);
  event DemandUrlUpdated(address indexed demand);
  event SupplyUrlUpdated(address indexed supply);
  event ArbiterUrlUpdated(address indexed arbiter);
  // TODO
  // event ChannelOpened();
  // event ChannelCheckpointProposed();
  // event ChannelCheckpointChallenged();
  // event ChannelCheckpointChallengeAccepted();
  // event ChannelCheckpointed();
  // event ChannelCloseProposed();
  // event ChannelCloseChallenged();
  // event ChannelCloseChallengeAccepted();
  // event ChannelCloseed();

  // Debugging
  event Error(string message);
  event LogBytes32(bytes32 message);
  event LogBool(bool message);

  // Constructor
  function AdMarket(uint256 _channelTimeout, uint256 _challengePeriod) {
    owner = msg.sender;
    channelTimeout = _channelTimeout;
    challengePeriod = _challengePeriod;
  }

  function registerDemand(address demand, string url) only_owner {
    if (isEmptyString(url)) throw; // must at least provide a non-empty string to update later
    registeredDemand[demand] = url;
    DemandRegistered(demand);
  }

  function registerSupply(address supply) only_owner {
    registeredSupply[supply] = true;
    SupplyRegistered(supply);
  }

  function registerArbiter(address arbiter, string url) only_owner {
    if (isEmptyString(url)) throw; // must at least provide a non-empty string to update later
    registeredArbiter[arbiter] = url;
    ArbiterRegistered(arbiter);
  }

  function deregisterDemand(address demand) only_owner {
    registeredDemand[demand] = "";
    DemandDeregistered(demand);
  }

  function deregisterSupply(address supply) only_owner {
    registeredSupply[supply] = false;
    SupplyDeregistered(supply);
  }

  function deregisterArbiter(address arbiter) only_owner {
    registeredArbiter[arbiter] = "";
    ArbiterDeregistered(arbiter);
  }

  // A registered demand can update the url of their server endpoint
  function updateDemandUrl(string url) only_registered_demand {
    if (isEmptyString(url)) throw; // can't update to empty string, must deregister
    registeredDemand[msg.sender] = url;
    DemandUrlUpdated(msg.sender);
  }

  // A registered arbiter can update the url of their server endpoint
  function updateArbiterUrl(string url) only_registered_arbiter {
    if (isEmptyString(url)) throw; // can't update to empty string, must deregister
    registeredArbiter[msg.sender] = url;
    ArbiterUrlUpdated(msg.sender);
  }

  // demand and supply
  function openChannel(address supply, address arbiter) only_registered_demand {
    address demand = msg.sender;

    // Check that supply is registered
    if (!registeredSupply[supply]) throw;

    // Check that arbiter is registered
    if (isEmptyString(registeredArbiter[arbiter])) throw;

    // Check that we don't already have a channel open with the supply
    address[] storage partners = channelPartners[demand];
    for (uint256 i = 0; i < partners.length; i++) {
      if (partners[i] == supply) throw;
    }

    bytes32 channelId = sha3(channelCount++);
    uint256 expiration = block.number + channelTimeout;

    channels[channelId] = Channel(
      this, // contractId
      channelId,
      demand,
      supply,
      0, // root
      arbiter,
      ChannelState.Open,
      expiration,
      0, // challengeTimeout
      0 // proposed root
    );

    channelPartners[demand].push(supply);
  }

  // Either supply or demand can checkpoint a channel at any time
  // We have to have a challenge period because we aren't tracking sequence number (impressions) onchain.
  // Checkpointing gives us the ability to have long-lived channels without downtime.
  // The channel participants can elect to renew the channel during a checkpoint.
  // If a channel is open and also has a challengeTimeout, that challengeTimeout is interpreted as a checkpoint challenge period.
  // -- keep it open
  function proposeCheckpointChannel(
    bytes32 channelId,
    bytes32 proposedRoot,
    bytes signature
  ) {
    Channel channel = channels[channelId];

    // Check that msg.sender is either demand or supply
    if (!(channel.demand == msg.sender || channel.supply == msg.sender)) throw;

    // Check that the channel is open
    if (!(channel.state == ChannelState.Open)) throw;

    bytes32 fingerprint = sha3(
      address(this),
      channelId,
      channel.demand,
      channel.supply,
      proposedRoot
    );

    // Check the signature on the state
    if (!ecverify(fingerprint, signature, channel.demand)) throw;

    channel.state = ChannelState.Checkpointing;
    channel.challengeTimeout = block.number + challengePeriod;
    channel.proposedRoot = proposedRoot;
  }


  function challengeCheckpointChannel(
    bytes32 channelId,
    bytes32 challengeRoot,
    uint256 impressions,
    bytes merkleProof,
    bytes signature
  ) {
    Channel channel = channels[channelId];

    // Check that msg.sender is either demand or supply
    if (!(channel.demand == msg.sender || channel.supply == msg.sender)) throw;

    // Check that the channel is checkpointing
    if (channel.state != ChannelState.Checkpointing) throw;

    // Check that the challenge period has not expired
    if (channel.challengeTimeout < block.number) throw;

    bytes32 fingerprint = sha3(
      address(this),
      channelId,
      channel.demand,
      channel.supply,
      challengeRoot
    );

    // Check the signature on the state
    if (!ecverify(fingerprint, signature, channel.demand)) throw;

    // Check the merkle proof for the impressions and challengeRoot
    if (!(checkProof(merkleProof, challengeRoot, sha3(impressions)))) throw;

    challenges[channelId] = Challenge(
      challengeRoot,
      impressions
    );

    // Extend the challenge timeout
    channel.challengeTimeout = block.number + challengePeriod;
  }

  function acceptChallengeCheckpointChannel(
    bytes32 channelId,
    uint256 impressions,
    bytes merkleProof
  ) {
    Channel channel = channels[channelId];

    // Check that msg.sender is either demand or supply
    if (!(channel.demand == msg.sender || channel.supply == msg.sender)) throw;

    // Check that the channel is checkpointing
    if (channel.state != ChannelState.Checkpointing) throw;

    // Check that the challenge period has not expired
    if (channel.challengeTimeout < block.number) throw;

    Challenge challenge = challenges[channelId];

    // Check that a challenge was presented
    if (challenge.impressions <= 0) throw;

    // Check the merkle proof for the impressions and proposedRoot
    if (!(checkProof(merkleProof, channel.proposedRoot, sha3(impressions)))) throw;

    // TODO shouldn't this compare impressions against impressions in the challenge?

    channel.root = channel.proposedRoot;
    channel.proposedRoot = 0;
    channel.state = ChannelState.Open;
    channel.challengeTimeout = 0;
    delete challenges[channelId];
  }

  function checkpointChannel(bytes32 channelId) {
    Channel channel = channels[channelId];

    // Check that msg.sender is either demand or supply
    if (!(channel.demand == msg.sender || channel.supply == msg.sender)) throw;

    // Check that the channel is checkpointing
    if (!(channel.state == ChannelState.Checkpointing)) throw;

    // Check that the challenge period is over
    if (!(channel.challengeTimeout < block.number)) throw;

    Challenge challenge = challenges[channelId];

    // If there was an unanswered challenge, it wins. Otherwise the proposedRoot is accepted.
    if (challenge.impressions > 0) {
      channel.root = challenge.challengeRoot;
    } else {
      channel.root = channel.proposedRoot;
    }

    channel.proposedRoot = 0;
    channel.state = ChannelState.Open;
    channel.challengeTimeout = 0;
    delete challenges[channelId];
  }

  function proposeCloseChannel(
    bytes32 channelId,
    bytes32 proposedRoot,
    bytes signature

  ) {
    Channel channel = channels[channelId];

    // Check that msg.sender is either demand or supply
    if (!(channel.demand == msg.sender || channel.supply == msg.sender)) throw;

    // Check that channel is not already closing or closed
    if ((channel.state == ChannelState.Closing || channel.state == ChannelState.Closed)) throw;

    // Override any existing challenges
    if (channel.state == ChannelState.Checkpointing && challenges[channelId].impressions > 0) {
      delete challenges[channelId];
    }

    bytes32 fingerprint = sha3(
      address(this),
      channelId,
      channel.demand,
      channel.supply,
      proposedRoot
    );

    // Check the signature on the state
    if (!ecverify(fingerprint, signature, channel.demand)) throw;

    channel.state = ChannelState.Closing;
    channel.challengeTimeout = block.number + challengePeriod;
    channel.proposedRoot = proposedRoot;
  }

  function challengeCloseChannel(
    bytes32 channelId,
    bytes32 challengeRoot,
    uint256 impressions,
    bytes merkleProof,
    bytes signature
  ) {
    Channel channel = channels[channelId];

    // Check that msg.sender is either demand or supply
    if (!(channel.demand == msg.sender || channel.supply == msg.sender)) throw;

    // Check that the channel is closing
    if (!(channel.state == ChannelState.Closing)) throw;

    // Check that the challenge period has not expired
    if (!(channel.challengeTimeout > block.number)) throw;

    bytes32 fingerprint = sha3(
      address(this),
      channelId,
      channel.demand,
      channel.supply,
      challengeRoot
    );

    // Check the signature on the state
    if (!ecverify(fingerprint, signature, channel.demand)) throw;

    // Check the merkle proof for the impressions and challengeRoot
    if (!(checkProof(merkleProof, challengeRoot, sha3(impressions)))) throw;

    challenges[channelId] = Challenge(
      challengeRoot,
      impressions
    );

    // Extend the challenge timeout
    channel.challengeTimeout = block.number + challengePeriod;
  }

  function acceptChallengeCloseChannel(
    bytes32 channelId,
    uint256 impressions,
    bytes merkleProof
  ) {
    Channel channel = channels[channelId];

    // Check that msg.sender is either demand or supply
    if (!(channel.demand == msg.sender || channel.supply == msg.sender)) throw;

    // Check that the channel is closing
    if (!(channel.state == ChannelState.Closing)) throw;

    // Check that the challenge period has not expired
    if (!(channel.challengeTimeout > block.number)) throw;

    Challenge challenge = challenges[channelId];

    // Check that a challenge was presented
    if (!(challenge.impressions > 0)) throw;

    // Check the merkle proof for the impressions and proposedRoot
    if (!(checkProof(merkleProof, channel.proposedRoot, sha3(impressions)))) throw;

    channel.root = channel.proposedRoot;
    channel.proposedRoot = 0;
    channel.state = ChannelState.Closed;
    channel.challengeTimeout = 0;
    delete challenges[channelId];
  }

  function closeChannel(bytes32 channelId) {
    Channel channel = channels[channelId];

    // Check that msg.sender is either demand or supply
    if (!(channel.demand == msg.sender || channel.supply == msg.sender)) throw;

    // Check that the channel is checkpointing
    if (!(channel.state == ChannelState.Closing)) throw;

    // Check that the challenge period is over
    if (!(channel.challengeTimeout < block.number)) throw;

    Challenge challenge = challenges[channelId];

    // If there was an unanswered challenge, it wins. Otherwise the proposedRoot is accepted.
    if (challenge.impressions > 0) {
      channel.root = challenge.challengeRoot;
    } else {
      channel.root = channel.proposedRoot;
    }

    channel.proposedRoot = 0;
    channel.state = ChannelState.Closed;
    channel.challengeTimeout = 0;
    delete challenges[channelId];
  }

  function closeExpiredChannel() {}
  function closeZeroStateChannel() {}

  // dispute duplicate states based on the same hash
  function disputeDuplicateState() {}

  // dispute an invalid state update
  function disputeBadState() {}

  // Impressions must be checkpointed to clear, settle, and be notarized.
  // checkpoint -> clear -> settle -> approve
  // disputes:
  //  - checkpointing can be disputed by either party
  //  - clearing can be disputed by either party
  //  - settling must be triggered by supply, otherwise supply can demandPayment
  //    - if payment still has not come supply can call disputePayment
  //    - if demand feels falsely accused, they can disputePayment as well
  //    - if demand pays after supply demanded, supply can settle
  //  - notarization happens after settlement
  //    - no further checkpoints can be made until the notarization process happens
  // Questions:
  //  - What happens after a dispute is resolved?
  //    - checkpoints: checkpoints will always go through, either the proposed state will be checkpointed or the challenge
  //    - clearing: if clearing is disputed, the AdMarket must respond with the final impressions count within some time frame
  //      - does this mean we need functions for the AdMarket to provide this input?
  //        - yes -> ...
  //        - there has to be a UI / CLI that mediates this (ideally an open API that combines the two)
  //      - what if there are many outstanding disputes?
  //        - the AdMarket can increase price of managing disputes dynamically to avoid getting DOSed
  //    - payment: if payment is disputed, the AdMarket must get involved...what does this look like?
  //  - can the AdMarket close out channels?
  //    - It can unregister, which prevents all further actions.
  //    - It should also be able to delete channels to recover storage (low priority)
  //
  // Notes:
  //  - I think it will be easier to track all the data / oracle inputs about specific checkpoints as a separate contract.
  //  - Each checkpoint will have its own entry,
  //  - alternative is to track checkpoints within a channel, possible as a separate nested struct.
  //  - checkpoint data should be stored in a channel...what data?
  //  - PUNT until we get to the point of settling / clearing / notarizing
  //
  // TODO:
  //  - separate the smart contract arbitration (checkpointing) from the human arbitration (settlements)
  function clear() {}
  function disputeClear() {}
  function settle() {}
  function demandPayment() {}
  function disputePayment() {}
  function notarize() {}

  function isEmptyString(string s) constant returns (bool) {
    return sha3(s) == emptyString;
  }

  // -------
  // Getters
  // -------

  function getChannel(bytes32 id) constant returns (
    address contractId,
    bytes32 channelId,
    address demand,
    address supply,
    bytes32 root,
    address arbiter,
    ChannelState state,
    uint256 expiration,
    uint256 challengeTimeout,
    bytes32 proposedRoot
  ) {
    Channel channel = channels[id];
    return (
      channel.contractId,
      channel.channelId,
      channel.demand,
      channel.supply,
      channel.root,
      channel.arbiter,
      channel.state,
      channel.expiration,
      channel.challengeTimeout,
      channel.proposedRoot
    );
  }

  // TODO deploy as a library
  function checkProof(bytes merkleProof, bytes32 root, bytes32 hash) constant returns (bool) {
    bytes32 el;
    bytes32 h = hash;

    for (uint256 i = 32; i <= merkleProof.length; i += 32) {
        assembly {
            el := mload(add(merkleProof, i))
        }

        if (h < el) {
            h = sha3(h, el);
        } else {
            h = sha3(el, h);
        }
    }

    return h == root;
  }
}

