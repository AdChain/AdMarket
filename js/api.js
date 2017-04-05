// Top level API

/*
 * Demand Methods
 */

// Fires when demand receives the impression (after it has been saved)
function recordImpressionServed(supplyId, impressionId, impressionPrice) {
  // 1. lookup the channel from the supplyId
  // 2. update the channel store with new state
  // 3. send the new state to the peer (set status to pending)
  // 4. upon receiving the ACK, update the state in memory from pending to done
  //
  // possible optimizations:
  //   - wait for gaps to be filled to save. only save a whole batch once all
  //   previous transactions have been saved
  //   - supply can just ack most recent transaction
  //
  // Notes:
  //   - In case of system failure, we should do a scan for all impressions
  //   saved without corresponding ACKs from supply.
  //   - This means the ACK from supply is required before the commit.
  //     - We should save the ACK in the same DB table
  //   - There is no reason to save the channel update until the response
  //     - No need for saving the intermediate "state updated but ack
  //     pending" state.
  //   - Treat saving the impression as our WAL
}

// Priorities:
// 1. Finish up a strawman SQL database to use as a guide / test
//  - save impressions
//  - trigger processImpression
// 2. Implement the top level processImpressions function
//  - update channel store
//    - create schema for channels
//    - create reducer for updating channel state



function saveImpression() {}

function processImpression() {}

function saveChannel() {}

function notifyPeer() {}

function recordACK() {}

// Other messages

function provideData() {}



// In order to prevent replay attacks, even those that may be accidental, we
// need to save on the demand side intermediate state updates without ACKs. The
// reason why is to preserve ordering. If messages are ever replayed to a peer
// in a different order (e.g. in the event of a crash), then we are replaying.
// Either messages on the demand side should be saved in order, or we should
// assign order only once ever after the impression is received. In order to
// not depend on an external system for order (even if we depend on it as a WAL
// for impressions) we should implement ordering ourselves.
//
// So after a crash, we would query the DB for all unaccounted for impressions,
// order them and include them into the channel history, then get all messages
// that have yet to be ACKed, and fire them off to the supply.
//
// Supply needs a way of dealing with duplicate messages (should be
// idempotent). Basically, they should ignore duplicates.

// So we have one table w/ non blockchain data about impressions / price
// Need a query for that, but just for startup / cron job
//
// And then another table with all the channel data. New saves only after ACK.
//
// I DONT WANT TO USE SQL, because even if it does serve as an effective hack
// for this project, it will 1. slow down development 2. not be user friendly
// 3. I can iterate on it later, easier if I already know. Same as implementing
//    merkle trree in JS first. From here forth, SQL is only for fun.

function deliverImpression(supplyId, impressionId) {
  //
}

function ackReceived(supplyId, impressionId) {
  //
}

// Demand and supply both call "recordImpressionServed", the difference is what
// each do after. Demand needs to message supply. Supply needs to ACK to
// demand. Supply is done after sending the ACK. Demand will wait until it has
// recevied the message from Supply to change the channel status from pending
// to ackReceived.
//
// Demand will keep the most recent ACK from Supply.
//
// How to deal with supply getting message out of order?
// Save the message, notice the gap. Either cron / wait then request that data
