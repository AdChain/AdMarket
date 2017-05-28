// Supply Server

// Receives impression beacon events from the browser.
// Receives channel update events from Demand.

// Endpoints:

// /impression -> impression event from the browser
// Payload:
// - impression data
// Actions:
// - save the impression to storage
// - add the impression to a "pendingImpressions" queue for this channel
//   - after some time, if Demand has not included this impression in
//     a channel_update, send a request_signature message to the AdMarket
//   - if the AdMarket has seen impression and responds w/ sig:
//     - verify signature
//     - save their response in storage (WAL)
//     - add the message to the "pendingUpdateRequests" queue
//     - send the request_channel_update to Demand
//       - if Demand does not reply with the impression:
//         - close the channel
//       - if Demand does reply with the channel_update:
//         - save the channel update to storage
//         - verify the channel update signature
//         - verify the channel update state transition
//         - remove the update from "pendingUpdateRequests"
//   - if the AdMarket has not seen the impression and responds 404:
//     - remove the impression from the "pendingImpressions" queue
//     - delete the stored impression
// Sample Payloads (current implementation):
{"timestamp":"2017-03-01T00:00:04.018Z","did":"417","geo":"US","playersize":3,"domain":"http://www.bnd.com/news/local/article134550409.html","sid":"416","width":"640","height":"360","inventory":1}
{"timestamp":"2017-03-01T00:00:03.751Z","did":"-1","geo":"US","playersize":3,"domain":"http://writingcareer.com/deadlines/nonfiction-submissions-deadlines/","sid":"424","width":640,"height":360,"inventory":1}
{"timestamp":"2017-03-01T00:00:03.751Z","did":"420","geo":"US","playersize":3,"domain":"http://writingcareer.com/deadlines/nonfiction-submissions-deadlines/","sid":"424","width":640,"height":360,"playersizeblocked":1}
// Payload will be updated:
// - change did/sid to Ethereum 20 byte hex addresses
// - include channel identifier (channelId, contractId)

// /channel_update -> channel update message from Demand
// Payload:
// - impression data
// - channel update
// - Demand's signature on channel update
// Actions:
// - verify the channel update signature
// - verify the channel update state transition
// - if we haven't already seen the impression, save it to storage
// - save the channel update to storage (WAL)
// - remove (if it exists) the corresponding impression from this
//   channel's "pendingImpressions" queue
// Note:
// - channel updates can come out of order, but must be verified in order,
//   so we store the channel update in a "pendingUpdates" queue until the next
//   update in order arrives.

// When Booting this server (for each Supply account):
// 1. Read from Blockchain
//  - get all active channels
//  - get most recent checkpointed states
// 2. Read from Storage
//  - get most recent channel states
//  - get any WAL messages
// 3. create tasks for all WAL messages
//  - repopulate pendingImpressions queue with impressions that have yet to be
//    included in channel updates
//  - repopulate pendingUpdates queue with out of order channel updates that
//    are missing the earlier message
//  - repopulate pendingChannelUpdates queue with impressions the AdMarket has
//    signed off on but the Demand has yet to include in a channel update
