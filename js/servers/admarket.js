// servers/admarket.js
//
// Receieves streams of beacon data.

import { createStore } from 'redux'
import { combineReducers } from 'redux-immutable'
import { List } from 'immutable'
import Web3 from 'web3'

import config from '../config'
import { admarketChannelsReducer } from '../reducers'
import { adMarketImpressionDB as impressionDB, adMarketChannelDB as channelDB } from '../storage'
import { makeChannel, sign } from '../channel'
const {
  demand: {hostUrl: demandHostUrl},
  supply: {hostUrl: supplyHostUrl},
  adMarket: {
    privKey: adMarketPrivKey,
    hostUrl: adMarketHostUrl,
    port: port
  }
} = config

const web3 = new Web3()
const sha3 = web3.sha3

const privKey = new Buffer(adMarketPrivKey, 'hex')

const store = createStore(admarketChannelsReducer)
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
  pendingUpdates: List([])
}

var express = require('express')
var bodyParser = require('body-parser')
var app = express()

app.use(bodyParser.json())

let IS_OPEN = false

// This is a hack to initialize the channel in storage before receiving
// impressions
// This will have to change
app.get('/open', async function (req, res) {
  IS_OPEN = true

  await channelDB.remove({}, { multi: true })
  await impressionDB.remove({}, { multi: true })

  await channelDB.insert(channel)
  dispatch({ type: 'CHANNEL_OPENED', payload: channel })
  // console.log(await channelDB.find({channelId: CHANNEL_ID}))

  res.sendStatus(200)
})

app.post('/channel_update', async function (req, res) {
  const { impression, update } = req.body

  // TODO Before we dispatch, verify the inputs.

  // TODO If impression doesn't exist in DB, save it. (for now just save)
  await impressionDB.insert(impression)

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

  console.log('\nChannel Update Received\n')
  console.log(formatState(channelState))

  await channelDB.update(
    { channelId: CHANNEL_ID },
    channelState,
    { multi: true }
  )

  res.sendStatus(200)
})

app.get('/request_signature', async function (req, res) {
  // Just need the impression Id?
  const impressions = req.body

  console.log('Signature requested for impressions:\n')
  console.log(impressions)

  const savedImpressions = await impressionDB.find({
    impressionId: { $in: impressions.map(({ impressionId }) => impressionId) }
  })

  // needs to return signed impressions, each signed individually
  // [ { impressionId, signature } ... ]
  if (savedImpressions && savedImpressions.length) {
    console.log('Impression found')

    const signedImpressions = savedImpressions.map(impression => {
      impression.signature = sign(sha3(impression.impressionId), privKey)
      delete impression._id
      return impression
    })

    res.json(signedImpressions)

  } else {
    console.log('Impression not found')
    res.json([])
  }
})

app.post('/', async function (req, res) {
  // The impression could be received before or after the channel_update.
  // Most likely it will be before, in which case we saved the impression and
  // add it the the pendingImpressions queue.
  // If it arrives after, the impression will have already both been saved and
  // the channel updated, so there is no reason to do anything.
  // There is a chance the impression was received as part of the channelUpdate
  // but out of order, so it is saved but still in the pendingUpdates queue.

  const impression = req.body

  console.log('\nImpression Received:\n', impression)

  // TODO If impression doesn't exist in DB, save it. (for now just save)
  await impressionDB.insert(impression)

  res.sendStatus(200)
})

app.listen(port, () => {
  console.log(`AdMarket listening on ${port}`)
})

function formatState(state) {
  return {
    price: state.price,
    impressionId: state.impressionId,
    balance: state.balance,
    impressions: state.impressions,
    prevRoot: state.prevRoot,
    root: state.root,
    signature: state.signature
  }
}
