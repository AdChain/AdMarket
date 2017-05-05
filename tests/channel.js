import { assert } from 'chai'
import p from 'es6-promisify'
import Web3 from 'web3'
import MerkleTree, { checkProof, merkleRoot } from 'merkle-tree-solidity'
import { sha3 } from 'ethereumjs-util'
import setup from './setup'
import { parseChannel, getFingerprint, getRoot, solSha3, parseLogAddress,
  verifySignature, makeUpdate, verifyUpdate, parseBN } from './channel'
import { wait } from './utils'

describe('channel', async () => {
  it('getRoot', () => {
    const channel = {
      contractId: '0x12345123451234512345',
      channelId: web3.sha3('foo'),
      demand: '0x11111111111111111111',
      supply: '0x22222222222222222222',
      root: web3.sha3('foo'),
    }

    const root = '0x'+merkleRoot([
      `impId:${channel.impressionId}`,
      `impPrice:${channel.impressionPrice}`,
      `impCount:${channel.impressions}`,
      `balance:${channel.balance}`,
      `prevRoot:${channel.root}`
    ].map(e => sha3(e))).toString('hex')

    assert.equal(root, getRoot(channel, channel.root))
  })


  it('makeUpdate', () => {
    const channel = {
      contractId: '0x12345123451234512345',
      channelId: web3.sha3('foo'),
      demand: '0x11111111111111111111',
      supply: '0x22222222222222222222',
      impressionId: 'foo',
      impressionPrice: 1,
      impressions: 1000,
      balance: 1000
    }

    channel.root = getRoot(channel, web3.sha3('foo'))

    const input = {
      impressionId: web3.sha3('bar'),
      impressionPrice: 2
    }

    const update = makeUpdate(channel, input)

    assert.equal(update.impressionId, web3.sha3('bar'))
    assert.equal(update.impressionPrice, 2)
    assert.equal(update.impressions, 1001)
    assert.equal(update.balance, 1002)
    assert.equal(update.root, getRoot(update, channel.root))
    assert.equal(update.prevRoot, channel.root)
    assert.equal(update.contractId, channel.contractId)
    assert.equal(update.channelId, channel.channelId)
    assert.equal(update.demand, channel.demand)
    assert.equal(update.supply, channel.supply)
  })

  it('verifyUpdate', () => {
    const channel = {
      contractId: '0x12345123451234512345',
      channelId: web3.sha3('foo'),
      demand: '0x11111111111111111111',
      supply: '0x22222222222222222222',
      impressionId: 'foo',
      impressionPrice: 1,
      impressions: 1000,
      balance: 1000
    }

    channel.root = getRoot(channel, web3.sha3('foo'))

    const input = {
      impressionId: web3.sha3('bar'),
      impressionPrice: 2
    }

    const update = makeUpdate(channel, input)
    assert.ok(verifyUpdate(channel, update))
  })
})
