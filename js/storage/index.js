const Datastore = require('nedb')
const path = require('path')
const Promise = require('bluebird')
const p = Promise.promisify

const dbs = {
  // datastore for plain impressions
  impressionDB: createDatastore('DATA_IMPRESSION'),
  // datastore for channel state
  channelDB: createDatastore('DATA_CHANNEL'),
  supplyImpressionDB: createDatastore('S_DATA_IMPRESSION'),
  supplyChannelDB: createDatastore('S_DATA_CHANNEL'),
  adMarketImpressionDB: createDatastore('A_DATA_IMPRESSION'),
  adMarketChannelDB: createDatastore('A_DATA_CHANNEL')
}

const methods = ['find', 'insert', 'update', 'remove', 'count', 'ensureIndex']
const exportsObj = {}

// promisifying db methods
for (let key in dbs) {
  let db = dbs[key]
  exportsObj[key] = {}
  let obj = exportsObj[key]
  for (let i in methods) {
    let m = methods[i]
    obj[m] = pify(db, m)
  }
}

function createDatastore(filename) {
  return new Datastore({
    filename: path.join(__dirname, '/', filename),
    autoload: true
  })
}

function pify(obj, method) {
  return p(obj[method].bind(obj))
}

module.exports = exportsObj
