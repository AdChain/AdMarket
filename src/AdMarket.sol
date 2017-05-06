pragma solidity ^0.4.7;

// 5/6/2017 Cleanup
//
// Goal is to ship, can add features later
// - demo parallel impression tracking system
// - can inform clearing / settlement

import "ECVerify.sol";

// Registers supply and demand, facilitates discovery, and manages the impression tracking state channels between them
contract AdMarket is ECVerify {

  bytes32 emptyString = hex"c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";

  address owner;
  string ownerUrl;
  mapping (address => string) public registeredDemand;
  mapping (address => string) public registeredSupply;
  mapping (bytes32 => Channel) channels;
  mapping (bytes32 => Challenge) challenges;
  mapping (address => address[]) channelPartners;

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
    uint256 challengeTimeout; // block number after which the channel can be closed by its participants (set in proposeCloseChannel)
    bytes32 proposedRoot; // a placeholder root which is only stored and set after the challenge period is over
  }

  // Note: Root is the merkle root of the previous root and the current state. The current state includes:
  //  - balance: demand -> supply
  //  - impressions (#)
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
    if (msg.sender != owner) throw;
    _;
  }

  modifier only_registered_demand() {
    if (!isRegisteredDemand(msg.sender)) throw;
    _;
  }

  modifier only_registered_supply() {
    if (!isRegisteredSupply(msg.sender)) throw;
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
    if (isEmptyString(url)) throw; // must at least provide a non-empty string to update later
    registeredDemand[demand] = url;
    DemandRegistered(demand);
  }

  function registerSupply(address supply, string url) only_owner {
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
    if (isEmptyString(url)) throw; // can't update to empty string, must deregister
    registeredDemand[msg.sender] = url;
    DemandUrlUpdated(msg.sender);
  }

  // A registered supply can update the url of their server endpoint
  function updateSupplyUrl(string url) only_registered_supply {
    if (isEmptyString(url)) throw; // can't update to empty string, must deregister
    registeredSupply[msg.sender] = url;
    SupplyUrlUpdated(msg.sender);
  }

  // Demand can open a channel with any supply
  function openChannel(address supply) only_registered_demand {
    address demand = msg.sender;

    // Check that supply is registered
    if (!isRegisteredSupply(supply)) throw;

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

    // Check that impressions is larger than in the challenge
    if (challenge.impressions > impressions) throw;

    // Check the merkle proof for the impressions and proposedRoot
    if (!(checkProof(merkleProof, channel.proposedRoot, sha3(impressions)))) throw;

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
    // note: challenge.impressions can only be > 0 if there was an unanswered challenge.
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

    // Check that impressions is larger than in the challenge
    if (challenge.impressions > impressions) throw;

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
    // note: challenge.impressions can only be > 0 if there was an unanswered challenge.
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

  // TODO
  function closeExpiredChannel() {}
  function closeZeroStateChannel() {}

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
    Channel channel = channels[id];
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

