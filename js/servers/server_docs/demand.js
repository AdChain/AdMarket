// Demand Server

// Receives impression beacon events from the browser.
// Receives impression clearing requests from supply.

// Endpoints:

// /impression -> impression event from the browser
// Payload:
// - impression data
// Actions:
// - save the impression to storage
// - update channel state to include impression
// - save the updated channel state to storage
// - send the channel update + impression to Supply
//   - listening for their response and retrying is not important,
//     Supply will ask if they are missing data
// Sample Payloads (current implementation):
{"timestamp":"2017-03-01T00:00:04.018Z","did":"417","geo":"US","playersize":3,"domain":"http://www.bnd.com/news/local/article134550409.html","sid":"416","width":"640","height":"360","inventory":1}
{"timestamp":"2017-03-01T00:00:03.751Z","did":"-1","geo":"US","playersize":3,"domain":"http://writingcareer.com/deadlines/nonfiction-submissions-deadlines/","sid":"424","width":640,"height":360,"inventory":1}
{"timestamp":"2017-03-01T00:00:03.751Z","did":"420","geo":"US","playersize":3,"domain":"http://writingcareer.com/deadlines/nonfiction-submissions-deadlines/","sid":"424","width":640,"height":360,"playersizeblocked":1}
// Payload will be updated:
// - change did/sid to Ethereum 20 byte hex addresses
// - include channel identifier (channelId, contractId)

//  /request_channel_update -> Supply bringing signed impression from AdMarket
//  as proof that an impression which this served didn't record did in fact
//  happen.
//  Payload:
//  - impression data
//  - AdMarket signature on impressionId
//  Actions:
//  - save the message to storage (WAL)
//  - verify signature of AdMarket on impressionId
//  - if valid:
//    - update channel state to include impression
//    - save the updated channel state to storage
//    - send the channel update + impression to AdMarket
//    - respond to Supply with updated channel state
//  - if invalid:
//    - respond that signature is invalid
//  - delete request_channel_update message from storage (WAL)

// When Booting this server (for each Demand account):
// 1. Read from Blockchain
//  - get all active channels
//  - get most recent checkpointed states
// 2. Read from Storage
//  - get most recent channel states
//  - get any WAL messages
// 3. create tasks for all WAL messages
//  - execute on request_channel_update messages
