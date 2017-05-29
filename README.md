# AdMarket

## Tests

At the moment, only the contract tests have been written.

To run tests:

(in a separate terminal)
```bash
npm run testrpc
```

```bash
npm run mocha
```

## Overview

This repo is a (WIP) state channel system to allow an advertiser and a publisher (or their agents) to synchronize their recorded advertising impressions in real-time.

### Background

For traditional ad contracts with 30 to 60 day settlement cycles, discrepancies in impression reporting between parties are not discovered until the contract is complete. Discrepancies in tracked impressions commonly reach [up to 20%](https://support.google.com/dfp_premium/answer/6160380). Some of these are intrinsic to browsers and networks and come from latency, network connection errors, ad blockers, and differences between ad server spam filtering techniques. The widespread acceptance of discrepancies across the industry, however, is exploited through fraudulent tampering of metrics and misreporting impressions.

By syncronizing impressions in real-time, discrepancies can be eliminated or at
least discovered much more quickly.

### AdChain Overview

This repo is being developed as part of the AdChain project, a collaboration
between ConsenSys and MetaX.

Check out [these slides](https://docs.google.com/presentation/d/1U7vi49QalSg2zwaetGK7DqQFhwMmiRGFdpdhtr1p3iU) for a quick overview of AdChain and the AdMarket.

### State Channels

State Channels is a design pattern for building scalable decentralized
applications. This documentation assumes familiarity with state channels. To
review, check out the following links:

Martin Koeppelmann (Oct. 2015, blog) - [How offchain trading will work](http://forum.groupgnosis.com/t/how-offchain-trading-will-work/63)

Robert Mccone (Oct. 2015, blog) - [Ethereum Lightning Network and Beyond](http://www.arcturnus.com/ethereum-lightning-network-and-beyond/)

Jeff Coleman (Nov. 2015, blog) - [State Channels](http://www.jeffcoleman.ca/state-channels/) (see also: [discussion on /r/ethereum](https://www.reddit.com/r/ethereum/comments/3tcu82/state_channels_an_explanation/))

Heiko Hees (Dec. 2015, talk) - [Raiden: Scaling Out With Offchain State
Networks](https://www.youtube.com/watch?v=h791zjvf3uQ)

Jeff Coleman (Dec. 2015, interview) - [Epicenter Bitcoin: State Networks](https://www.youtube.com/watch?v=v0ZJDsRYnbA)

Jehan Tremback (Dec. 2015, blog) - [Universal Payment Channels](http://altheamesh.com/blog/universal-payment-channels/)

Martin Koeppelmann (Jan. 2016, slides) - [Scalability via State Channels](http://de.slideshare.net/MartinKppelmann/state-channels-and-scalibility)

Vitalik Buterin (Jun. 2016, paper)  - [Ethereum: Platform Review (page 30)](http://static1.squarespace.com/static/55f73743e4b051cfcc0b02cf/t/57506f387da24ff6bdecb3c1/1464889147417/Ethereum_Paper.pdf)

Ameen Soleimani (Sept. 2016, talk) - [An Introduction to State Channels in
Depth](https://www.youtube.com/watch?v=MEL50CVOcH4)

Jeff Coleman (ongoing, wiki) - [State Channels Wiki](https://github.com/ledgerlabs/state-channels/wiki)

Jeff Coleman (ongoing, code) - [Toy State Channels](https://github.com/ledgerlabs/toy-state-channels/tree/master/contracts)

Heiko Hees (ongoing, code) - [Raiden Network](https://github.com/raiden-network/raiden)

Sergey Ukustov (ongoing, code) - [Machinomy](https://github.com/machinomy/machinomy)

I especially recommend Jeff Coleman's blog post and the Machinomy documentation
as starting points.

### Usage

The advertiser or their agent (demand) and the publisher or their agent (supply)
will maintain a state channel for the duration of their business relationship,
periodically checkpointing the channel state onchain.

This state channel tracks the impressions between represent an "impression ledger"

#### Registration

In the current implementation, both the demand and supply must be registered
with the AdMarket in order to open channels.

Only the owner of the AdMarket contract may register (or deregister) supply and demand
participants.

To register demand or supply, the AdMarket owner must provide their Ethereum address as well as a url string which points to their adserver which will handle state channel messages.

Once registration is complete, the supply and demand may update their own
adserver urls.

##### Integration with the AdChain Registry

In the future, registration will be separated into its own contract so an AdMarket contract can opt to instead use the AdChain Registry as its canonical source of truth regarding supply and demand identity.

#### Opening the Channel

The demand opens the channel initially,

#### Checkpointing On Chain

#### Closing the Channel

#### Disputes



### Architecture


