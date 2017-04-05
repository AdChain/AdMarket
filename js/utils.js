const utils = {
  wait
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export { utils }
