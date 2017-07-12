pragma solidity ^0.4.7;

import "ECVerify.sol";

// Registers supply and demand, facilitates discovery, and manages the impression tracking state channels between them
contract AdMarket is ECVerify {

  bytes32 emptyString = hex"c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";

  address owner;
  string ownerUrl;

  mapping (address => string) public registeredDemand;
  // registeredDemand[0xabc...] => toyota.adserver.com

  mapping (address => string) public registeredSupply;
  // registeredSupply[0xdef...] => nyt.adserver.com

  mapping (bytes32 => Channel) channels;
  // channels[channelId] => channel metadata

  mapping (bytes32 => Challenge) challenges;
  // channels[channelId] => channel challenge metadata

  mapping (address => mapping (address => bool)) channelPartners;
  // channelPartners[demand][supply] => true/false

  uint256 public channelCount = 0;
  uint256 public channelTimeout; // max lifetime of a channel in blocks
  uint256 public challengePeriod; // number of blocks to wait for challenges before closing

  enum ChannelState { Open, Checkpointing, Closing, Closed }

  struct Channel {
    // State Variables (only root changes on each channel update)
    address contractId;
    bytes32 channelId;
    address demand;
    address supply;
    bytes32 root;

    // Metadata (not included in offchain state updates)
    ChannelState state;
    uint256 expiration; // block number after which the channel expires and can be closed by anyone (set in openChannel)
    uint256 challengeTimeout; // block number after which the channel can be closed by its participants (set in proposeCheckpointChannel and challengeCheckpointChannel)
    bytes32 proposedRoot; // a placeholder root which is only stored and set after the challenge period is over
  }

  // Note: Root is the merkle root of the previous root and the current state. The current state includes:
  //  - balance: demand -> supply
  //  - impressions (#) (sequence number)
  //  - impressionId
  //  - impressionPrice
  // In case of a dispute, the data can be made public and verified onchain using merkle proofs.
  // For example, to challenge a replay attack, we provide impression count (sequence number) and merkle proof for both the replay
  //  state and the most recent one.

  struct Challenge {
    bytes32 challengeRoot; // the root of the most recent channel state, according to the challenging party
    uint256 impressions; // the state with the higher impression count wins
  }

  modifier only_owner() {
    if (msg.sender != owner) {
        revert();
    }

    _;
  }

  modifier only_registered_demand() {
    if (!isRegisteredDemand(msg.sender)) {
        revert();
    }

    _;
  }

  modifier only_registered_supply() {
    if (!isRegisteredSupply(msg.sender)) {
        revert();
    }

    _;
  }

  event DemandRegistered(address indexed demand);
  event SupplyRegistered(address indexed supply);
  event DemandDeregistered(address indexed demand);
  event SupplyDeregistered(address indexed supply);
  event DemandUrlUpdated(address indexed demand);
  event SupplyUrlUpdated(address indexed supply);
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
  function AdMarket(string _ownerUrl, uint256 _channelTimeout, uint256 _challengePeriod) {
    owner = msg.sender;
    ownerUrl = _ownerUrl;
    channelTimeout = _channelTimeout;
    challengePeriod = _challengePeriod;
  }

  function updateOwnerUrl(string _ownerUrl) only_owner {
    ownerUrl = _ownerUrl;
  }

  function registerDemand(address demand, string url) only_owner {
    if (isEmptyString(url)) revert(); // must at least provide a non-empty string to update later
    registeredDemand[demand] = url;
    DemandRegistered(demand);
  }

  function registerSupply(address supply, string url) only_owner {
    if (isEmptyString(url)) revert(); // must at least provide a non-empty string to update later
    registeredSupply[supply] = url;
    SupplyRegistered(supply);
  }

  function deregisterDemand(address demand) only_owner {
    registeredDemand[demand] = "";
    DemandDeregistered(demand);
  }

  function deregisterSupply(address supply) only_owner {
    registeredSupply[supply] = "";
    SupplyDeregistered(supply);
  }

  // A registered demand can update the url of their server endpoint
  function updateDemandUrl(string url) only_registered_demand {
    if (isEmptyString(url)) revert(); // can't update to empty string, must deregister
    registeredDemand[msg.sender] = url;
    DemandUrlUpdated(msg.sender);
  }

  // A registered supply can update the url of their server endpoint
  function updateSupplyUrl(string url) only_registered_supply {
    if (isEmptyString(url)) revert(); // can't update to empty string, must deregister
    registeredSupply[msg.sender] = url;
    SupplyUrlUpdated(msg.sender);
  }

  // Demand can open a channel with any supply
  function openChannel(address supply) only_registered_demand {
    address demand = msg.sender;

    // Check that supply is registered
    if (!isRegisteredSupply(supply)) revert();

    // Check that we don't already have a channel open with the supply
    if (channelPartners[demand][supply]) revert();

    bytes32 channelId = sha3(channelCount++);
    uint256 expiration = block.number + channelTimeout;

    channels[channelId] = Channel(
      this, // contractId
      channelId,
      demand,
      supply,
      0, // root
      ChannelState.Open,
      expiration,
      0, // challengeTimeout
      0 // proposed root
    );

    channelPartners[demand][supply] = true;
  }

  // Either supply or demand can checkpoint a channel at any time
  // We have to have a challenge period because we aren't tracking sequence number (impressions) onchain.
  // Checkpointing gives us the ability to have long-lived channels without downtime.
  // The channel participants can elect to renew the channel during a checkpoint.
  function proposeCheckpoint(
    bytes32 channelId,
    bytes32 proposedRoot,
    bytes signature,
    bool renew
  ) {
    Channel storage channel = channels[channelId];

    // Check that msg.sender is either demand or supply
    if (!(channel.demand == msg.sender || channel.supply == msg.sender)) revert();

    // Check that the channel is open
    if (!(channel.state == ChannelState.Open)) revert();

    bytes32 fingerprint = sha3(
      address(this),
      channelId,
      channel.demand,
      channel.supply,
      proposedRoot
    );

    // Check the signature on the state
    if (!ecverify(fingerprint, signature, channel.demand)) revert();

    // renew the channel, keeping it open at the end of the checkpoint
    if (renew) {
      channel.state = ChannelState.Checkpointing;

    // close the channel at the end of the checkpoint process
    } else {
      channel.state = ChannelState.Closing;
    }

    channel.challengeTimeout = block.number + challengePeriod;
    channel.proposedRoot = proposedRoot;
  }

  // Either supply or demand can choose to not renew and instead close a channel
  // at any point during the checkpointing process.
  // The checkpointing process would continue in the same exact way, but it would
  // close upon completion instead of remaining open
  function closeChannel(bytes32 channelId) {
    Channel storage channel = channels[channelId];

    // Check that msg.sender is either demand or supply
    if (!(channel.demand == msg.sender || channel.supply == msg.sender)) revert();

    // Check that the channel is checkpointing
    if (!(channel.state == ChannelState.Checkpointing)) revert();

    channel.state = ChannelState.Closing;
  }

  // Either supply or demand can challenge a checkpointing channel before the challengeTimeout period ends
  // They supply a different merkleRoot -- the challenge root -- which has more impressions.
  // They also supply the proof for this impression count and the Demand's signature on it.
  // This resets the challengeTimeout giving the counterparty a chance to accept this challenge.
  // To accept the challenge, the counterparty must prove that the original checkpointed root has more impressions
  function challengeCheckpoint(
    bytes32 channelId,
    bytes32 challengeRoot,
    uint256 impressions,
    uint256 index,
    bytes merkleProof,
    bytes signature
  ) {
    Channel storage channel = channels[channelId];

    // Check that msg.sender is either demand or supply
    if (!(channel.demand == msg.sender || channel.supply == msg.sender)) revert();

    // Check that the channel is checkpointing or closing
    if (channel.state != ChannelState.Checkpointing && channel.state != ChannelState.Closing) revert();

    // Check that the challenge period has not expired
    if (channel.challengeTimeout < block.number) revert();

    bytes32 fingerprint = sha3(
      address(this),
      channelId,
      channel.demand,
      channel.supply,
      challengeRoot
    );

    // Check the signature on the state
    if (!ecverify(fingerprint, signature, channel.demand)) revert();

    // Check the merkle proof for the impressions and challengeRoot
    if (!(checkProofOrdered(merkleProof, challengeRoot, sha3(impressions), index))) revert();

    challenges[channelId] = Challenge(
      challengeRoot,
      impressions
    );

    // Extend the challenge timeout, giving the counterparty additional time to respond
    channel.challengeTimeout = block.number + challengePeriod;
  }

  // Either the demand or supply can accept a checkpoint challenge before the challengeTimeout ends.
  // They must provide proof that the impressions in the original checkpoint are greater than
  // in the checkpoint challenge.
  // If they succeed, then the channel checkpointing process immediately ends, and the channel
  // state is finalized with the original state.
  // Otherwise, the channel checkpointing process will continue until the challenge period expires
  // and the state is finalized by the checkPointChannel function
  // If the participants intend to renew, the channel will stay open and its expiration block will reset.
  // Otherwise the channel will close.
  function acceptChallenge(
    bytes32 channelId,
    uint256 impressions,
    uint256 index,
    bytes merkleProof
  ) {
    Channel storage channel = channels[channelId];

    // Check that msg.sender is either demand or supply
    if (!(channel.demand == msg.sender || channel.supply == msg.sender)) revert();

    // Check that the channel is checkpointing or closing
    if (channel.state != ChannelState.Checkpointing && channel.state != ChannelState.Closing) revert();

    // Check that the challenge period is not over
    if (channel.challengeTimeout < block.number) revert();

    Challenge storage challenge = challenges[channelId];

    // Check that a challenge was presented
    if (challenge.impressions <= 0) revert();

    // Check that impressions is larger than in the challenge
    if (challenge.impressions > impressions) revert();

    // Check the merkle proof for the impressions and proposedRoot
    if (!(checkProofOrdered(merkleProof, channel.proposedRoot, sha3(impressions), index))) revert();

    // renew channel
    if (channel.state == ChannelState.Checkpointing) {
      channel.expiration = block.number + channelTimeout;
      channel.state = ChannelState.Open;

    // close channel
    } else {
      channel.state = ChannelState.Closed;
      channelPartners[channel.demand][channel.supply] = false;
    }

    // even if the channel is closed, we want to record the final state root
    channel.root = channel.proposedRoot;
    channel.proposedRoot = 0x0;
    channel.challengeTimeout = 0;
    delete challenges[channelId];
  }

  // Either the demand or supply can finalize the checkpoint after the challengeTimeout ends.
  // If a valid challenge was presented and not accepted, it wins and becomes the final state.
  // If no challenge was presented, the originally proposed state root is accepted.
  // If the participants intend to renew, the channel will stay open and its expiration block will reset.
  // Otherwise the channel will close.
  function checkpointChannel(bytes32 channelId) {
    Channel storage channel = channels[channelId];

    // Check that msg.sender is either demand or supply
    if (!(channel.demand == msg.sender || channel.supply == msg.sender)) revert();

    // Check that the channel is checkpointing or closing
    if (channel.state != ChannelState.Checkpointing && channel.state != ChannelState.Closing) revert();

    // Check that the challenge period is over
    if (channel.challengeTimeout > block.number) revert();

    Challenge storage challenge = challenges[channelId];

    // If there was an unanswered challenge, it wins. Otherwise the proposedRoot is accepted.
    // note: challenge.impressions can only be > 0 if there was an unanswered challenge.
    // if the challenge was successfully answered, challenge.impressions would have been deleted
    if (challenge.impressions > 0) {
      channel.root = challenge.challengeRoot;
    } else {
      channel.root = channel.proposedRoot;
    }

    // renew channel
    if (channel.state == ChannelState.Checkpointing) {
      channel.expiration = block.number + channelTimeout;
      channel.state = ChannelState.Open;

    // close channel
    } else {
      channel.state = ChannelState.Closed;
      channelPartners[channel.demand][channel.supply] = false;
    }

    channel.proposedRoot = 0x0;
    channel.challengeTimeout = 0;
    delete challenges[channelId];
  }

  // TODO
  function closeExpiredChannel() {}

  function isEmptyString(string s) constant returns (bool) {
    return sha3(s) == emptyString;
  }

  function isRegisteredDemand(address demand) returns (bool) {
    return !isEmptyString(registeredDemand[demand]);
  }

  function isRegisteredSupply(address supply) returns (bool) {
    return !isEmptyString(registeredSupply[supply]);
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
    ChannelState state,
    uint256 expiration,
    uint256 challengeTimeout,
    bytes32 proposedRoot
  ) {
    Channel storage channel = channels[id];
    return (
      channel.contractId,
      channel.channelId,
      channel.demand,
      channel.supply,
      channel.root,
      channel.state,
      channel.expiration,
      channel.challengeTimeout,
      channel.proposedRoot
    );
  }

  function getChallenge(bytes32 id) constant returns (
    bytes32 challengeRoot,
    uint256 impressions
  ) {
    Challenge storage challenge = challenges[id];
    return (
      challenge.challengeRoot,
      challenge.impressions
    );
  }

  // TODO deploy as a library
  function checkProofOrdered(
    bytes proof, bytes32 root, bytes32 hash, uint256 index
  ) constant returns (bool) {
    // use the index to determine the node ordering
    // index ranges 1 to n

    bytes32 el;
    bytes32 h = hash;
    uint256 remaining;

    for (uint256 j = 32; j <= proof.length; j += 32) {
      assembly {
        el := mload(add(proof, j))
      }

      // calculate remaining elements in proof
      remaining = (proof.length - j + 32) / 32;

      // we don't assume that the tree is padded to a power of 2
      // if the index is odd then the proof will start with a hash at a higher
      // layer, so we have to adjust the index to be the index at that layer
      while (remaining > 0 && index % 2 == 1 && index > 2 ** remaining) {
        index = uint(index) / 2 + 1;
      }

      if (index % 2 == 0) {
        h = sha3(el, h);
        index = index / 2;
      } else {
        h = sha3(h, el);
        index = uint(index) / 2 + 1;
      }
    }

    return h == root;
  }
}

