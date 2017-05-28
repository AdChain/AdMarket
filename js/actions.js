// Web Page Events
export function impressionServed (impression) {
  return {
    type: 'IMPRESSION_SERVED',
    payload: impression
  }
}
export function trackingDataReceived () {}

// Supply Peers Events
export function requestImpressionCleared (impressionId, arbiterSig) {}

// Human Events
export function openChannel () {}
export function closeChannel () {}

// Demand Peers Events
export function initiateCheckpoint () {}

// Blockchain Events
export function updateRegistry () {}
export function updateChannel () {}
