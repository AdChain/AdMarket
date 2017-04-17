// servers/demand.js
//
// Receives impression beacon events from the browser.
// Receives impression clearing requests from supply.

import request from 'request'
import { createStore } from 'redux'
import { combineReducers } from 'redux-immutable'
import Promise from 'bluebird'
import Web3 from 'web3'
import { channelsReducer } from '../reducers'
import { impressionDB, channelDB } from '../storage'
import { makeChannel, makeUpdate } from '../channel'

// TODO should be API client for supply

const web3 = new Web3()

const p = Promise.promisify

// const rootReducer = combineReducers(channelsReducer)
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
  await p(channelDB.remove.bind(channelDB))({}, { multi: true })
  await p(impressionDB.remove.bind(impressionDB))({}, { multi: true })
  await p(channelDB.insert.bind(channelDB))(channel)
  dispatch({ type: 'CHANNEL_OPENED', payload: channel })
  // console.log(await p(channelDB.find.bind(channelDB))({ channelId: CHANNEL_ID}))
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

app.post('/', async function (req, res) {
  const impression = req.body

  await p(impressionDB.insert.bind(impressionDB))(impression)

  // TODO Before we dispatch, verify the inputs.
  // new channel states are signed within the reducer
  // TODO add flag to skip sigining?
  // supply will need to call roughly the same function but without signing

  dispatch({ type: 'IMPRESSION_SERVED', payload: impression })

  // console.log(store.getState().get(0))
  const channelState = store.getState().toJS()[0]

  console.log('\nCHANNEL STATE\n')
  console.log(channelState)

  await p(channelDB.update.bind(channelDB))(
    { channelId: CHANNEL_ID },
    channelState,
    { multi: true }
  )

  // no timeout for impressions=2, 100ms timeout for impressions=1
  // const timeout = channelState.impressions == 1 ? 100 : 0
  const timeout = 0

  setTimeout(function () {
    if (channelState.impressions == 1) {
      request.post({ url: 'http://localhost:3001/channel_update', body: { impression, update: channelState }, json: true}, function () {})
      request.post({ url: 'http://localhost:3002/channel_update', body: { impression, update: channelState }, json: true}, function () {})
    }
  }, timeout)

  // const saved = await p(channelDB.find.bind(channelDB))({ channelId: CHANNEL_ID})

  res.sendStatus(200)
})

app.get('/state', function (req, res) {
  res.json(store.getState())
})

app.listen(3000, function () {
  console.log('listening on 3000')
})
