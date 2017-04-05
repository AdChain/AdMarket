// servers/supply.js
//
// Receives impression beacon events from the browser.
// Receives impression acknowledgments from demand partners.

import { createStore } from 'redux'
import { combineReducers } from 'redux-immutable'
import { List } from 'immutable'
import request from 'request'
import { supplyChannelsReducer } from '../reducers'
import { supImpDB as impressionDB, supChDB as channelDB } from '../storage'
import { makeChannel, makeUpdate } from '../channel'
import Promise from 'bluebird'
import Web3 from 'web3'


const web3 = new Web3()

const p = Promise.promisify

const rootReducer = combineReducers(supplyChannelsReducer)
const store = createStore(supplyChannelsReducer)
const dispatch = store.dispatch

const CHANNEL_ID = web3.sha3('foo')

const channel = {
  contractId: '0x12345123451234512345',
  channelId: CHANNEL_ID,
  demand: '0x11111111111111111111',
  supply: '0x22222222222222222222',
  impressionId: 'foo',
  price: 1,
  impressions: 0,
  root: web3.sha3('0'),
  balance: 0,
  state: 0,
  expiration: 100,
  challengeTimeout: 100,
  proposedRoot: 0,
  pendingImpressions: List([]),
  pendingUpdates: List([]),
  pendingUpdateRequests: List([])
}


var express = require('express')
var bodyParser = require('body-parser');
var app = express()

app.use(bodyParser.json());

let IS_OPEN = false

// This is a hack to initialize the channel in storage before receiving
// impressions
// This will have to change
app.get('/open', async function(req, res) {
  IS_OPEN = true
  await p(channelDB.remove.bind(channelDB))({}, { multi: true })
  await p(impressionDB.remove.bind(impressionDB))({}, { multi: true })
  await p(channelDB.insert.bind(channelDB))(channel)
  dispatch({ type: 'CHANNEL_OPENED', payload: channel })
  // console.log(await p(channelDB.find.bind(channelDB))({ channelId: CHANNEL_ID}))
  res.sendStatus(200)
})

app.get('/verify', async function(req, res) {
  // implement an endpoint which queries all existing data and verifies it
  // in practice, this will be used to validate an impression chain starting
  // from some checkpointed state. This will require us to query all data for
  // the channel, sort it, and then do the sequence of hashing to see if it
  // produces the same root. req.root should be the root we are checking
  // against, and req.from should be the impression # to start, and req.end
  // should be the impression # to end at.
  //
  // req: { supplyId, demandId, root, from, to }
  // const saved = await p(impressionDB.find.bind(impressionDB))({ supplyId: req.supplyId, demandId: req.demandId})

  const saved = await p(impressionDB.find.bind(impressionDB))({ supplyId: req.body.supplyId, demandId: req.body.demandId })
  // NOTE - query responses are not ordered
  saved.sort((a, b) => {
    return a.impressionId - b.impressionId
  })

  const newChannel = makeChannel(channel)

  const final = newChannel.withMutations(channel => {
    saved.reduce((channel, impression) => {
      return makeUpdate(channel, impression)
    }, channel)
  })

  res.sendStatus(200)
})

app.post('/channel_update', async function(req, res) {

  const { impression, update } = req.body

  // TODO Before we dispatch, verify the inputs.

  // TODO If impression doesn't exist in DB, save it. (for now just save)
  await p(impressionDB.insert.bind(impressionDB))(impression)

  // How can we tell if the impression has already been received?
  // It should exist in the DB, and also be in the pendingImpression queue.
  // What if there is a race condition? The channel_update is received during
  // the processing of the impression event. We could check both conditions
  // separately. If it isn't in the database, save it. If it is in the
  // pendingImpressions queue, remove it.
  //
  // There is no reason to fire an impressionServed event if we are receiving
  // the channel_update with the impression before the actual impression event.

  dispatch({ type: 'CHANNEL_UPDATE', payload: update })

  const channelState = store.getState().toJS()[0]

  console.log('\nCHANNEL_UPDATE - CHANNEL STATE\n')
  console.log(channelState)

  await p(channelDB.update.bind(channelDB))(
    { channelId: CHANNEL_ID },
    channelState,
    { multi: true }
  )

  res.sendStatus(200)
})

app.post('/', async function(req, res) {

  // The impression could be received before or after the channel_update.
  // Most likely it will be before, in which case we saved the impression and
  // add it the the pendingImpressions queue.
  // If it arrives after, the impression will have already both been saved and
  // the channel updated, so there is no reason to do anything.
  // There is a chance the impression was received as part of the channelUpdate
  // but out of order, so it is saved but still in the pendingUpdates queue.

  const impression = req.body

  // TODO If impression doesn't exist in DB, save it. (for now just save)
  await p(impressionDB.insert.bind(impressionDB))(impression)

  // TODO Before we dispatch, verify the inputs.

  dispatch({ type: 'IMPRESSION_SERVED', payload: {
    demandId: impression.demandId, supplyId: impression.supplyId,
    impressionId: impression.impressionId, price: impression.price,
    time: impression.time
  }})

  // console.log(store.getState().get(0))

  const channelState = store.getState().toJS()[0]

  console.log('\nIMPRESSION_SERVED - CHANNEL STATE\n')
  console.log(channelState)

  await p(channelDB.update.bind(channelDB))(
    { channelId: CHANNEL_ID },
    channelState,
    { multi: true }
  )

  // const saved = await p(channelDB.find.bind(channelDB))({ channelId: CHANNEL_ID})
  // const sig = saved[0].signature

  res.sendStatus(200)
})

app.get('/state', function (req, res) {
  res.json(store.getState())
})

app.listen(3001, function () {
  console.log('listening on 3001')
})

function requestSignature(impressionIds) {
  request.get({ url: 'http://localhost:3002/request_signature', body: impressionIds, json: true }, function(err, res, body) {
    if (err) { throw err }
    console.log(body)
    const signatures = body

    // save signatures?

    if (signatures && signatures.length) {
      dispatch({ type: 'SIGNATURES_RECEIVED', payload: signatures })
    }
  })
}


// long running process which queries the AdMarket for pendingImpressions
function loopPendingImpressions(timeout) {
  setTimeout(function() {
    if (IS_OPEN) {
      const now = new Date() / 1000
      const pending = store.getState().get(0).get('pendingImpressions').filter(impression => {
        return now - impression.time > 2
      })
      console.log('\nTRIGGER\n')
      console.log(pending.toJS())
    }
    loopPendingImpressions(timeout)
  }, timeout)
}

// loopPendingImpressions(2000)
