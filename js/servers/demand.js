// servers/demand.js
//
// Receives impression beacon events from the browser.
// Receives impression clearing requests from supply.

import request from 'request'
import { createStore } from 'redux'
import { combineReducers } from 'redux-immutable'
import Web3 from 'web3'

import { channelsReducer } from '../reducers'
import { impressionDB, channelDB } from '../storage'
import { makeChannel, makeUpdate } from '../channel'
import config from '../config'
const {
  demand: {hostUrl: demandHostUrl},
  supply: {hostUrl: supplyHostUrl},
  adMarket: {hostUrl: adMarketHostUrl}
} = config

const web3 = new Web3()

const store = createStore(channelsReducer)
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
  proposedRoot: 0
}

// Only need to track the most recent state
// need to track the signature!
// So I want to find the channel in storage and update it.

var express = require('express')
var bodyParser = require('body-parser')
var app = express()

app.use(bodyParser.json())

// This is a hack to initialize the channel in storage before receiving
// impressions
// This will have to change
app.get('/open', async function (req, res) {
  await channelDB.remove({}, { multi: true })
  await impressionDB.remove({}, { multi: true })

  await channelDB.insert(channel)
  dispatch({ type: 'CHANNEL_OPENED', payload: channel })
  // console.log(await channelDB.find({channelId: CHANNEL_ID}))

  res.sendStatus(200)
})

app.get('/verify', async function (req, res) {
  // implement an endpoint which queries all existing data and verifies it
  // in practice, this will be used to validate an impression chain starting
  // from some checkpointed state. This will require us to query all data for
  // the channel, sort it, and then do the sequence of hashing to see if it
  // produces the same root. req.root should be the root we are checking
  // against, and req.from should be the impression # to start, and req.end
  // should be the impression # to end at.
  //
  // req: { supplyId, demandId, root, from, to }
  // const saved = await impressionDB.find({ supplyId: req.supplyId, demandId: req.demandId})

  const {supplyId, demandId} = req.body
  const saved = await impressionDB.find({supplyId, demandId})

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

app.post('/request_update', async function (req, res) {
  const impression = req.body

  console.log('Channel Update Requested')

  // TODO verify the signature from the admarket...
  if (impression.signature) {
    console.log('AdMarket signature verified')

    await impressionDB.insert(impression)

    // TODO Before we dispatch, verify the inputs.
    // new channel states are signed within the reducer
    // TODO add flag to skip sigining?
    // supply will need to call roughly the same function but without signing

    dispatch({ type: 'IMPRESSION_SERVED', payload: impression })

    // console.log(store.getState().get(0))
    const channelState = store.getState().toJS()[0]

    await channelDB.update(
      { channelId: CHANNEL_ID },
      channelState,
      { multi: true }
    )

    // no timeout for impressions=2, 100ms timeout for impressions=1
    // const timeout = channelState.impressions == 1 ? 100 : 0
    const timeout = 0

    console.log('\nChannel Update Sent\n')
    console.log(formatState(channelState))

    const payload = { impression, update: channelState }

    request.post({
      url: `${supplyHostUrl}/channel_update`,
      body: payload,
      json: true
    }, () => ({}))

    request.post({
      url: `${adMarketHostUrl}/channel_update`,
      body: payload,
      json: true
    }, () => ({}))

    res.sendStatus(200)

  } else {
    console.log('AdMarket ')
    res.json([])
  }


})

app.post('/', async function (req, res) {
  const impression = req.body

  console.log('\nImpression Received:\n', impression)

  await impressionDB.insert(impression)

  // TODO Before we dispatch, verify the inputs.
  // new channel states are signed within the reducer
  // TODO add flag to skip sigining?
  // supply will need to call roughly the same function but without signing

  dispatch({ type: 'IMPRESSION_SERVED', payload: impression })

  // console.log(store.getState().get(0))
  const channelState = store.getState().toJS()[0]

  await channelDB.update(
    { channelId: CHANNEL_ID },
    channelState,
    { multi: true }
  )

  // no timeout for impressions=2, 100ms timeout for impressions=1
  // const timeout = channelState.impressions == 1 ? 100 : 0
  const timeout = 0

  console.log('\nChannel Update Sent\n')
  console.log(formatState(channelState))

  const payload = { impression, update: channelState }

  setTimeout(() => {
    if (channelState.impressions == 1) {
      request.post({
        url: `${supplyHostUrl}/channel_update`,
        body: payload,
        json: true
      }, () => ({}))

      request.post({
        url: `${adMarketHostUrl}/channel_update`,
        body: payload,
        json: true
      }, () => ({}))
    }
  }, timeout)

  // const saved = await channelDB.find({channelId: CHANNEL_ID})

  res.sendStatus(200)
})

app.get('/state', (req, res) => {
  res.json(store.getState())
})

app.listen(3000, () => {
  console.log('Demand listening on 3000')
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
