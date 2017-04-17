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

export function addTodo (text) {
  return {
    type: 'ADD_TODO',
    payload: {
      id: uid(),
      isDone: false,
      text: text
    }
  }
}

export function toggleTodo (id) {
  return {
    type: 'TOGGLE_TODO',
    payload: id
  }
}
