# AdMarket

## Tests

At the moment, only the contract tests have been written. To run the tests:

First start testrpc in one terminal.

```bash
npm run testrpc
```

Then run the tests in a different terminal.

```bash
npm run mocha
```

## Overview

This repo is a (WIP) state channel system to allow an advertiser and a publisher (or their agents) to synchronize their recorded advertising impressions in real-time.

### Background

For traditional ad contracts with 30 to 60 day settlement cycles, discrepancies in impression reporting between parties are not discovered until the contract is complete. Discrepancies in tracked impressions commonly reach [up to 20%](https://support.google.com/dfp_premium/answer/6160380). Some of these are intrinsic to browsers and networks and come from latency, network connection errors, ad blockers, and differences between ad server spam filtering techniques. The widespread acceptance of discrepancies across the industry, however, is exploited through fraudulent tampering of metrics and misreporting impressions.

By syncronizing impressions in real-time, discrepancies can be eliminated or at
least discovered much more quickly.

### AdChain

This repo is being developed as part of the AdChain project, a collaboration
between ConsenSys and MetaX.

Check out [these slides](https://docs.google.com/presentation/d/1U7vi49QalSg2zwaetGK7DqQFhwMmiRGFdpdhtr1p3iU) for a quick overview of AdChain and the AdMarket.

### State Channels

State Channels is a design pattern for building scalable decentralized
applications. This documentation assumes familiarity with state channels. To
review, check out the following links:

- Martin Koeppelmann (Oct. 2015, blog) - [How offchain trading will work](http://forum.groupgnosis.com/t/how-offchain-trading-will-work/63)
- Robert Mccone (Oct. 2015, blog) - [Ethereum Lightning Network and Beyond](http://www.arcturnus.com/ethereum-lightning-network-and-beyond/)
- Jeff Coleman (Nov. 2015, blog) - [State Channels](http://www.jeffcoleman.ca/state-channels/) (see also: [discussion on /r/ethereum](https://www.reddit.com/r/ethereum/comments/3tcu82/state_channels_an_explanation/))
- Heiko Hees (Dec. 2015, talk) - [Raiden: Scaling Out With Offchain State
Networks](https://www.youtube.com/watch?v=h791zjvf3uQ)
- Jeff Coleman (Dec. 2015, interview) - [Epicenter Bitcoin: State Networks](https://www.youtube.com/watch?v=v0ZJDsRYnbA)
- Jehan Tremback (Dec. 2015, blog) - [Universal Payment Channels](http://altheamesh.com/blog/universal-payment-channels/)
- Martin Koeppelmann (Jan. 2016, slides) - [Scalability via State Channels](http://de.slideshare.net/MartinKppelmann/state-channels-and-scalibility)
- Vitalik Buterin (Jun. 2016, paper)  - [Ethereum: Platform Review (page 30)](http://static1.squarespace.com/static/55f73743e4b051cfcc0b02cf/t/57506f387da24ff6bdecb3c1/1464889147417/Ethereum_Paper.pdf)
- Ameen Soleimani (Sept. 2016, talk) - [An Introduction to State Channels in
Depth](https://www.youtube.com/watch?v=MEL50CVOcH4)
- Jeff Coleman (ongoing, wiki) - [State Channels Wiki](https://github.com/ledgerlabs/state-channels/wiki)
- Jeff Coleman (ongoing, code) - [Toy State Channels](https://github.com/ledgerlabs/toy-state-channels/tree/master/contracts)
- Heiko Hees (ongoing, code) - [Raiden Network](https://github.com/raiden-network/raiden)
- Sergey Ukustov (ongoing, code) - [Machinomy](https://github.com/machinomy/machinomy)

I especially recommend Jeff Coleman's blog post and the Machinomy documentation
as starting points.

### Usage

The advertiser or their agent (demand) and the publisher or their agent (supply)
will maintain a state channel for the duration of their business relationship,
periodically checkpointing the channel state onchain. All data can be kept private between the parties, even during checkpointing, unless there is a dispute.

This state channel tracks the impressions between demand and supply and can be thought of as an immutable "impression ledger". In response to browser ad impression events, the demand  will send a signed state channel update over HTTP to the supply, acknowledging the impression. Both supply and demand store these channel updates offchain, in traditional databases such as PostgreSQL or MongoDB.

The AdMarket operator plays a role as a passive observer and a tie-breaker in the event the supply witnesses an impression event the demand fails to acknowledge.

#### Registration

Both the demand and supply must be registered with the AdMarket in order to open channels. The AdMarket contract maintains a mapping of Ethereum addresses to url strings for registered members. The url strings point to adservers which will handle state channel messages.

```
mapping (address => string) public registeredDemand;
mapping (address => string) public registeredSupply;
```

Only the owner of the AdMarket contract may register (or deregister) supply and demand
participants.

To register demand or supply, the AdMarket owner must provide their Ethereum address as well as a url string which points to their adserver which will handle offchain HTTP state channel messages.

```
function registerDemand(address demand, string url) only_owner {...}
function registerSupply(address supply, string url) only_owner {...}

function deregisterDemand(address demand) only_owner {...}
function deregisterSupply(address supply) only_owner {...}
```

Once registration is complete, the supply and demand may update their own
adserver urls.

```
function updateDemandUrl(string url) only_registered_demand {...}
function updateSupplyUrl(string url) only_registered_supply {...}
```

##### Future Integration with the AdChain Registry

In the future, registration functionality will be removed in favor of interfacing directly with the AdChain Registry.

#### Opening the Channel

In this system, only the demand can open the channel, which it does by providing the address of a registered supply which it doesn't already have an open channel with.

```
function openChannel(address supply) only_registered_demand {...}
```

At the moment, the channel is only used for accounting purposes and payments are done out-of-band, so opening a channel does not require a monetary deposit.

#### State Updates

Once a channel is open, whenever the demand receives an impression event from a user's browser, it will generate a state channel update acknowledging the impression, save it, sign it, and send it to the supply.

The **signed** portions of state channel message include the following fields:

- contractId - the Ethereum address of the AdMarket contract
- channelId - the integer id for this channel
- demand - the Ethereum address of the demand
- supply - the Ethereum address of the supply
- root - the merkle root of the most recent channel state

Where the channel state includes the following fields:

- balance - the cumulative amount demand owes supply
- impressions - the cumulative number of impressions
- impressionId - the id of the latest impression
- impressionPrice - the price of the latest impression
- prevRoot - the merkle root of the previous channel state

Because the channel state includes the previous root, the **root** of each channel state acts as a unique identifier not only for that specific state, but for the entire historical record of states leading up to it.

Upon receiving the state channel message, the supply will verify  it and save it to persistant storage.


#### Channel Data

The channel data in the AdMarket contract is set once when the channel is opened and periodically as the channel is checkpointed. Only the `root` is actually updated; the metadata serves to guide the channel through the proper checkpointing flow.

```
struct Channel {
  // State Variables (only root changes on each channel update)
  address contractId;
  bytes32 channelId;
  address demand;
  address supply;
  bytes32 root;

  // Metadata (not included in offchain state updates)
  ChannelState state;
  uint256 expiration;
  uint256 challengeTimeout;
  bytes32 proposedRoot;
}

enum ChannelState { Open, Checkpointing, Closing, Closed }
```

- `expiration` - block number after which the channel expires and can be closed by anyone (set in `openChannel`)
- `challengeTimeout` - block number after which a proposed checkpoint or valid challenge can be finalized (set in `proposeCheckpoint` and `challengeCheckpoint`)
- `proposedRoot` - a placeholder root which is only stored and set after the challenge period is over

#### Checkpointing the Channel

Periodically, the demand or supply can checkpoint the channel on the AdMarket contract, and optionally renew the channel.

##### Propose Checkpoint

Checkpointing the channel happens in a few steps. The first step is to propose a checkpoint for the most recent signed state, indicated by its root. As mentioned above, the root acts as a unique fingerprint for the entire historical record of impressions for this channel, and checkpointing it amounts to a globally visible commitment to that record.

The signature provided must be from the demand and is verified in the contract method.

If `renew` is set to `true`, the channel will remain open once the checkpoint is completed.

```
function proposeCheckpoint(
  bytes32 channelId,
  bytes32 proposedRoot,
  bytes signature,
  bool renew
) {...}
```

##### Challenge Checkpoint

Proposing a checkpoint triggers a challenge period during which either party can challenge the `proposedRoot` by submitting a signed state update -- the `challengeRoot` -- with a higher impression count (the impressions count is sequence number). The index of the impressions in the state array and the corresponding merkle proof are required to verify that the impressions value is included in the `challengeRoot`.

```
function challengeCheckpoint(
  bytes32 channelId,
  bytes32 challengeRoot,
  uint256 impressions,
  uint256 index,
  bytes merkleProof,
  bytes signature
) {...}
```

##### Accept Challenge

If a challenge was issued, the challenge period is reset, providing time to answer the challenge. To accept the challenge, the party must provide an impressions count which can be proven to be included in the original `proposedRoot`, and is higher than the impressions in the challenge. Should this be the case, the checkpointing immediately completes and the original `proposedRoot` is recorded.

```
function acceptChallenge(
  bytes32 channelId,
  uint256 impressions,
  uint256 index,
  bytes merkleProof
) {...}
```

##### Checkpoint

If there is no valid challenge, then after the challenge period expires either party can finalize the proposed checkpoint, and `root` will be set to `proposedRoot`.

Alternatively, if there is a valid challenge which is not accepted within the (reset) challenge period, then calling the `checkpointChannel` method will set `root` to `challengeRoot`.

```
function checkpointChannel(bytes32 channelId) {...}
```



#### Closing the Channel

Closing a channel uses the same methods and follows the same flow as checkpointing, except with `renew` set to `false` from the beginning.

If checkpointing was initiated with `renew` set to `true`, either party can still decide to close the channel using the `closeChannel` method. This can be done at any time during the checkpointing process, and sets `renew` to `false`.

```
function closeChannel(bytes32 channelId) {...}
```

## License

MIT
