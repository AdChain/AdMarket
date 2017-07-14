import { List, Map } from 'immutable'
import { combineReducers } from 'redux-immutable'
import { createStore } from 'redux'
import Web3 from 'web3'

import { makeChannel, parseChannel, makeUpdate } from './channel'

const web3 = new Web3()

const findChannel = (channels, payload) => {
  const result = channels.findEntry((channel) => {
    return channel.get('demand') == payload.demandId &&
    channel.get('supply') == payload.supplyId
  })
  return result || [undefined, undefined]
}

/**
 * getReadyUpdates
 * @desc
 * TODO: use a Map instead of a List for the channels? Because I query them by
 * supplyId + demandId every time anyways
 * I have to handle the edge case of multiple contracts with the same demand
 * + supply, meaning I have to create a unique channel ID
 * This could be the hash of channel + supply + demand, but then I have to hash
 * every time...
 *
 * @param {number} start - impressions count to start
 * @param {object} pendingUpdates - immutablejs array of impressions to apply
 * @returns
 * returns two values:
 * 1. the array of impressions to apply
 * 2. the remaining pendingImpressions
 */
function getReadyUpdates (start, pendingUpdates) {
  const sorted = pendingUpdates.sort((a, b) => {
    return a.impressions - b.impressions
  })

  const stop = sorted.findIndex((update, index) => {
    return update.impressions != (index + start + 1)
  })

  return stop == -1 ? [sorted, List([])] : [sorted.slice(0, stop), sorted.slice(stop)]
}

// IMPRESSION_SERVED should mean the same thing on supply and demand. It is the
// event fired in response to receiving the impression served beacon from the
// browser.
//
// CHANNEL_UPDATE should mean the state channel update event
//
// That said, the Supply and Demand IMPRESSION_SERVED resposnes are still
// different. The Demand and Supply should both save, but the Demand will
// message supply and the Supply will create a timeout waiting for that
// message.
//
// Neither do Supply and Demand do the same thing for CHANNEL_UPDATE, because
// the Supply has timeouts to clear.
//
// It is probably best to factor them by entity.
//
// TODO By default, send the whole impression object from Demand to Supply.
// Later on, optimize for bandwidth by only sending the whole impression event

// I wasn't going to use gun but they have PANIC...

export function supplyChannelsReducer (channels = List([]), { type, payload }) {
  let index, channel
  switch (type) {
    case 'IMPRESSION_SERVED':
      // So here, we will add the impression to pendingImpressions queue
      //  - some chance of receiving the channelUpdate on the impression before the
      //  impression?
      //  - idempotent updating, store the channelUpdate anyway, trigger when we receive
      //  impression.
      //
      // when we restart the process, we should also restart timeouts
      // - and if any timeouts are already passed, we should immediately
      // trigger those requests (this can be handled in a restart bootstrap
      // script)

      [index, channel] = findChannel(channels, payload)
      if (channel) {
        return channels.update(index, (channel) => {
          return channel.update('pendingImpressions', pending => pending.push(payload))
        })
      }

    /**
     * {object} payload - new channel state
     */
    case 'CHANNEL_UPDATE':
      [index, channel] = findChannel(channels, payload)
      if (channel) {
        // TODO efficiency - combine with other mutations?
        // remove impression from pendingImpressions
        channel = channel.update('pendingImpressions', pendingImpressions => {
          return pendingImpressions.filter(impression => impression.impressionId != payload.impressionId)
        })

        // impression is next in order
        if (payload.impressions == channel.get('impressions') + 1) {
          //  - compute the state transition with the impression
          //  - sort the pending impressions
          //  - loop over the pending impressions and apply them until one is out
          //  of order
          //  - remove applied impressions from pool
          //  - also cancel the setTimeout functions
          const final = channel.withMutations(channel => {

            // merge pending channel updates to new channel update
            const [toMerge, pending] = getReadyUpdates(payload.impressions, channel.get('pendingUpdates'))
            toMerge.reduce((channel, impression) => {
              return makeUpdate(channel, impression)
            }, makeUpdate(channel, payload))
            channel.set('pendingUpdates', pending)
          })
          return channels.set(index, final)
        } else {
          //  - add it to the list of pending impressions
          //  - start a setTimeout (10s) and if the impression event isn't received by supply
          //  - this setTimeout should not cancel until either the demand responds
          //  with the impression or the arbiter responds that it is invalid.
          //  - the setTimeout should dispatch which replaces existing timeout with
          //  the new one
          const final = channel.update('pendingUpdates', pending => pending.push(payload))
          return channels.set(index, final)
        }
      }
      return channels

    case 'SIGNATURES_RECEIVED':
      // TODO multiple channels - for now just do it for one
      // hack - we get to assume all impressions are for the same channel
      // future - we have to separate out impressions by channels, loop through
      //  each channel separately
      //
      // payload is an array of impressions
      // [ { impressionId, signature, price, ... } ... ]

      let impression = payload[0]
      // remove the impressions from the pendingImpressions queue
      // add the impressions to the pendingUpdateRequests queue

      return channels.deleteIn([0, 'pendingImpressions', 0]).setIn([0, 'pendingUpdateRequests', 0], impression)

    case 'IMPRESSION_NOT_FOUND':
      // TOTAL HACK

      // for each id in the impressionIds array,
      // remove the impression from the pendingImpressions array

      return channels.deleteIn([0, 'pendingImpressions', 0])

    case 'CHANNEL_OPENED':
      // TODO allow for multiple channels, right now just create a new list
      return List([makeChannel(parseChannel(payload))])
    case 'CHANNEL_CHECKPOINT_PROPOSED':
      [index, channel] = findChannel(channels, payload)
      return channels.setIn([index, 'state'], 1)
    case 'CHANNEL_CHECKPOINT_CHALLENGED':

    case 'CHANNEL_CHECKPOINT_CHALLENGE_ACCEPTED':

    case 'CHANNEL_CLOSE_PROPOSED':

    case 'CHANNEL_CLOSE_CHALLENGED':

    case 'CHANNEL_CLOSE_CHALLENGE_ACCEPTED':

    case 'CHANNEL_CLOSED':

    default:
      return channels
  }
}

export function admarketChannelsReducer (channels = List([]), { type, payload }) {
  let index, channel
  switch (type) {
    case 'IMPRESSION_SERVED':
      // Is there any reason to update state when an impression is received?
      // Don't think so. Maybe to track impressions that were never included in
      // the channel state, to delete them? We need to make sure to prune
      // impressions on all nodes, actually.
      return channels

    case 'CHANNEL_UPDATE':
      [index, channel] = findChannel(channels, payload)
      if (channel) {
        // impression is next in order
        if (payload.impressions == channel.get('impressions') + 1) {
          //  - compute the state transition with the impression
          //  - sort the pending impressions
          //  - loop over the pending impressions and apply them until one is out
          //  of order
          //  - remove applied impressions from pool
          //  - also cancel the setTimeout functions
          const final = channel.withMutations(channel => {
            const [toMerge, pending] = getReadyUpdates(payload.impressions, channel.get('pendingUpdates'))
            toMerge.reduce((channel, impression) => {
              return makeUpdate(channel, impression)
            }, makeUpdate(channel, payload))
            channel.set('pendingUpdates', pending)
          })
          return channels.set(index, final)
        } else {
          //  - add it to the list of pending impressions
          //  - start a setTimeout (10s) and if the impression event isn't received by supply
          //  - this setTimeout should not cancel until either the demand responds
          //  with the impression or the arbiter responds that it is invalid.
          //  - the setTimeout should dispatch which replaces existing timeout with
          //  the new one
          const final = channel.update('pendingUpdates', pending => pending.push(payload))
          return channels.set(index, final)
        }
      }
      return channels

    case 'CHANNEL_OPENED':
      // TODO allow for multiple channels, right now just create a new list
      return List([makeChannel(parseChannel(payload))])
    case 'CHANNEL_CHECKPOINT_PROPOSED':
      [index, channel] = findChannel(channels, payload)
      return channels.setIn([index, 'state'], 1)
    case 'CHANNEL_CHECKPOINT_CHALLENGED':

    case 'CHANNEL_CHECKPOINT_CHALLENGE_ACCEPTED':

    case 'CHANNEL_CLOSE_PROPOSED':

    case 'CHANNEL_CLOSE_CHALLENGED':

    case 'CHANNEL_CLOSE_CHALLENGE_ACCEPTED':

    case 'CHANNEL_CLOSED':

    default:
      return channels
  }
}

export function channelsReducer (channels = List([]), { type, payload }) {
  let index, channel
  switch (type) {
    case 'IMPRESSION_SERVED':
      [index, channel] = findChannel(channels, payload)
      if (channel) {
        channels = channels.set(index, makeUpdate(channel, payload, true))
      }
      return channels
    case 'CHANNEL_OPENED':
      // TODO allow for multiple channels, right now just create a new list
      return List([makeChannel(parseChannel(payload))])
    case 'CHANNEL_CHECKPOINT_PROPOSED':
      [index, channel] = findChannel(channels, payload)
      return channels.setIn([index, 'state'], 1)
    case 'CHANNEL_CHECKPOINT_CHALLENGED':

    case 'CHANNEL_CHECKPOINT_CHALLENGE_ACCEPTED':

    case 'CHANNEL_CLOSE_PROPOSED':

    case 'CHANNEL_CLOSE_CHALLENGED':

    case 'CHANNEL_CLOSE_CHALLENGE_ACCEPTED':

    case 'CHANNEL_CLOSED':

    default:
      return channels
  }
}

// How do I open a channel? I call the API method, either through CLI or Web.
// This triggers the transaction to be sent to Ethereum. Do I store it locally?
// Yes. The state should include that my transaction is pending.
// In fact this is true for all transactions and should be considered a pattern.
// How do we represent pending transactions? I could create a top level reducer
// just for blockchain interaction. This would prevent duplicate calls.
// I would query it before I sent the TX to see if I can (api middleware).
// The store of pending requests can also have a timeout which dispatches to
// clear the TX after too long (could be a problem in case of DDOS on ethereum)

const init = Map({ Demand: Map({}), Supply: Map({}), Arbiter: Map({}) })

export function registryReducer (registry = init, { type, payload: { address, url } }) {
  switch (type) {
    case 'DEMAND_REGISTERED':
    case 'DEMAND_UPDATED':
      return registry.setIn(['Demand', address], url)
    case 'SUPPLY_REGISTERED':
    case 'SUPPLY_UPDATED': // TODO - if supply has a url
      return registry.setIn(['Supply', address], url)
    case 'ARBITER_REGISTERED':
    case 'ARBITER_UPDATED':
      return registry.setIn(['Arbiter', address], url)
    case 'DEMAND_DEREGISTERED':
      return registry.deleteIn(['Demand', address])
    case 'SUPPLY_DEREGISTERED':
      return registry.deleteIn(['Supply', address])
    case 'ARBITER_DEREGISTERED':
      return registry.deleteIn(['Arbiter', address])
    default:
      return registry
  }
}

/*
case 'SUPPLY_REGISTERED':
  reducer.Supply.push(payload)
case 'ARBITER_REGISTERED':
  reducer.Arbiter.push(action.payload)
case 'DEMAND_DEREGISTERED':
  reducer.Demand.push(action.payload)
case 'SUPPLY_DEREGISTERED':
  reducer.Demand.push(action.payload)
case 'ARBITER_DEREGISTERED':
  reducer.Demand.push(action.payload)
case 'DEMAND_UPDATED':
  reducer.Demand.push(action.payload)
case 'SUPPLY_UPDATED':
  reducer.Demand.push(action.payload)
  return
  */

export function blocks () {}
