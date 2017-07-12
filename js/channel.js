import leftPad from 'left-pad'
import Web3 from 'web3'
import ethUtils from 'ethereumjs-util'
import { merkleRoot } from 'merkle-tree-solidity'
import { Map } from 'immutable'

const web3 = new Web3()
const sha3 = ethUtils.sha3

// TODO
// get private key from config file or unlock account?
// This server is intended to run on its own for a long period.
// private key can be in memory, part of env (typed in to start server) or
// file.
const privKey = Buffer.alloc(32, 'e331b6d69882b4cb4ea581d88e0b604039a3de5967688d3dcffdd2270c0fd109', 'hex')

// TODO separate util functions
// channel specific
// eth specific (needs web3)
// general, about eth (doesn't need web3)
// general, not about eth

const makeChannel = (channelObj, impressionObj) => {
  impressionObj = impressionObj || {
    impressionId: 0,
    price: 0,
    impressions: 0,
    balance: 0,
    prevRoot: 0
  }
  return Map({ ...channelObj, ...impressionObj })
}

const sign = (msgHash, privKey) => {
  if (typeof msgHash === 'string' && msgHash.slice(0, 2) === '0x') {
    msgHash = Buffer.alloc(32, msgHash.slice(2), 'hex')
  }
  const sig = ethUtils.ecsign(msgHash, privKey)
  return `0x${sig.r.toString('hex')}${sig.s.toString('hex')}${sig.v.toString(16)}`
}

const parseChannel = (channel) => {
  return Object.assign({}, channel, {
    state: +channel.state.toString(),
    expiration: +channel.expiration.toString(),
    challengeTimeout: +channel.challengeTimeout.toString()
  })
}

const parseChallenge = (challenge) => {
  return Object.assign({}, challenge, {
    impressions: +challenge.impressions.toString()
  })
}

const getFingerprint = (channel) => {
  if (typeof channel.toJS === 'function') {
    channel = channel.toJS()
  }
  return solSha3(
    channel.contractId,
    channel.channelId,
    channel.demand,
    channel.supply,
    channel.root
  )
}

const hashLeaf = (leaf) => {
  if (typeof leaf === 'number') {
    return Buffer.alloc(32, solSha3(leaf).slice(2), 'hex')
  }
  return sha3(leaf)
}

const getLeaves = (channel, prevRoot) => {
  if (typeof channel.toJS === 'function') {
    channel = channel.toJS()
  }
  return [
    channel.impressionId,
    channel.price,
    channel.impressions,
    channel.balance,
    prevRoot
  ].map(hashLeaf)
}

const getRoot = (channel, prevRoot) => {
  return '0x' + merkleRoot(getLeaves(channel, prevRoot), true).toString('hex')
}

const verifySignature = (channel, sig, address) => {
  const fingerprint = getFingerprint(channel)
  return ecrecover(fingerprint, sig) === address
}

// TODO make a real implementation of solSha3 in JS which captures all
// complexity (expanding arrays, recursion, uint sizes, etc...)
// https://github.com/raineorshine/solidity-sha3/blob/master/src/index.js
// http://ethereum.stackexchange.com/questions/2632/how-does-soliditys-sha3-keccak256-hash-uints
const solSha3 = (...args) => {
  args = args.map(arg => {
    if (typeof arg === 'string') {
      if (arg.substring(0, 2) === '0x') {
        return arg.slice(2)
      } else {
        return web3.toHex(arg).slice(2)
      }
    }

    if (typeof arg === 'number') {
      return leftPad((arg).toString(16), 64, 0)
    }
  })

  args = args.join('')

  return web3.sha3(args, { encoding: 'hex' })
}

const isValidUpdate = (update) => {
  return typeof update.price === 'number' && update.price > 0 &&
    typeof update.impressionId === 'string'
}

const makeUpdate = (channel, update, doSign) => {
  if (!isValidUpdate(update)) { throw new Error('Invalid Update') }
  // Assume impressionId and price are set on update
  update.impressions = channel.get('impressions') + 1
  update.balance = channel.get('balance') + update.price
  update.root = getRoot(update, channel.get('root'))
  update.prevRoot = channel.get('root')
  if (doSign) { update.signature = sign(getFingerprint(update), privKey) }
  return channel.merge(update)
}

// Different ways a channel gets constructed:
// 1. Built entirely from offchain state, then deployed
//  - this is wrong -> there are only deployed channels
//  - deployed channels can *also* have offchain state extending onchain
//  - deployed channels can *also* need to extend offchain state with onchain
// I have to think through state and storage now.

const verifyUpdate = (channel, update) => {
  return channel.get('contractId') === update.contractId &&
      channel.get('channelId') === update.channelId &&
      channel.get('demand') === update.demand &&
      channel.get('supply') === update.supply &&
      channel.get('impressions') === (update.impressions - 1) &&
      channel.get('balance') === (update.balance - update.price) &&
      update.root === getRoot(update, channel.get('root'))
}

// converts a 0x[10 0's][address] -> 0x[address]
const parseLogAddress = (logAddress) => {
  return '0x' + logAddress.slice(26)
}

// only use on bigNumbers that I know are actually small
const parseBN = (bigNumber) => {
  return +bigNumber.toString()
}

const ecrecover = (msg, sig) => {
  if (typeof sig === 'string') {
    sig = ethUtils.fromRpcSig(sig)
  }

  const msgBuf = new Buffer(msg)
  const prefix = new Buffer('\x19Ethereum Signed Message:\n');
  const h = ethUtils.sha3(
    Buffer.concat([prefix, new Buffer(String(msgBuf.length)), msgBuf])
  );

  const r = sig.r
  const s = sig.s
  const v = sig.v

  const pubkey = ethUtils.ecrecover(h, v, r, s)
  const addrBuf = ethUtils.pubToAddress(pubkey)
  const addr = ethUtils.bufferToHex(addrBuf)

  return addr
}

export {
  parseChannel,
  getFingerprint,
  getLeaves,
  getRoot,
  solSha3,
  parseLogAddress,
  verifySignature,
  makeUpdate,
  verifyUpdate,
  parseBN,
  makeChannel,
  sign,
  ecrecover,
  parseChallenge
}

/*
 * Punt on validation - data coming from blockchain is assumed to be valid
 *
function isValidState(state) {
  return isValidAddress(state.contractId) &&
         isValidAddress(state.demand) &&
         isValidAddress(state.supply) &&
         isValidBytes32(state.channelId) &&
         isValidBytes32(state.root)
}

function isValidBytes32(bytes32) {
  return Buffer(bytes32.slice(2), 'hex').length === 32
}

function isValidAddress(address) {
  return typeof address === 'string' && address.length === '22' &&
    address.slice(0, 2) === '0x' && Buffer(address.slice(2), 'hex').length === 20
}
*/
