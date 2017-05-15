import { assert } from 'chai'
import p from 'es6-promisify'
import Web3 from 'web3'
import MerkleTree, { checkProof, merkleRoot } from 'merkle-tree-solidity'
import { sha3 } from 'ethereumjs-util'
import setup from './setup'
import { makeChannel, parseChannel, getFingerprint, getLeaves, getRoot, solSha3, parseLogAddress, verifySignature, makeUpdate, verifyUpdate, parseBN } from './channel'
import { wait } from './utils'

const web3 = new Web3()

describe('AdMarket', async () => {

  let adMarket, eth, accounts, web3
  let snapshotId, filter

  // TODO snapshots should be an array which I can add to or pop off

  let params = [] // collection of params from some tests

  let CHANNEL_TIMEOUT = 20
  let CHALLENGE_PERIOD = 10

  before(async () => {
    let result = await setup({
      testRPCProvider: 'http://localhost:8545',
      channelTimeout: CHANNEL_TIMEOUT,
      challengePeriod: CHALLENGE_PERIOD
    })
    adMarket = result.adMarket
    eth = result.eth
    accounts = result.accounts
    web3 = result.web3
  })

  beforeEach(async () => {
    let res = await p(web3.currentProvider.sendAsync.bind(web3.currentProvider))({
      jsonrpc: '2.0',
      method: 'evm_snapshot',
      id: new Date().getTime()
    })
    snapshotId = res.result
    filter = web3.eth.filter({ address: adMarket.address, fromBlock: 0 })
  })

  afterEach(async () => {
    await p(filter.stopWatching.bind(filter))()
    await p(web3.currentProvider.sendAsync.bind(web3.currentProvider))({
      jsonrpc: '2.0',
      method: 'evm_revert',
      params: [snapshotId],
      id: new Date().getTime()
    })
  })

  const mineBlock = () => {
    return new Promise(async (accept) => {
      await p(web3.currentProvider.sendAsync.bind(web3.currentProvider))({
        jsonrpc: "2.0",
        method: "evm_mine",
        id: new Date().getTime()
      })
      accept()
    })
  }

  const mineBlocks = (count) => {
    return new Promise(async (accept) => {
      let i = 0
      while (i < count) {
        await mineBlock()
        i++
      }
      accept()
    })
  }

  it('setup', async () => {
    // channelCount should start at 0
    const channelCount = await adMarket.channelCount()
    assert.equal(+channelCount[0].toString(), 0)
  })

  it('registerDemand', async () => {
    const demand = accounts[1]
    const url = 'foo'
    await adMarket.registerDemand(demand, url)
    const result = await adMarket.registeredDemand(demand)
    assert.equal(result[0], url)

    const logs = await p(filter.get.bind(filter))()
    const logAddress = parseLogAddress(logs[0].topics[1])
    assert.equal(logAddress, demand)
  })

  it('registerSupply', async () => {
    const supply = accounts[1]
    const url = 'foo'
    await adMarket.registerSupply(supply, url)
    const result = await adMarket.registeredSupply(supply)
    assert.equal(result[0], url)

    const logs = await p(filter.get.bind(filter))()
    const logAddress = parseLogAddress(logs[0].topics[1])
    assert.equal(logAddress, supply)
  })

  it('deregisterDemand', async () => {
    const demand = accounts[1]
    const url = 'foo'
    await adMarket.registerDemand(demand, url)
    await adMarket.deregisterDemand(demand)
    const result = await adMarket.registeredDemand(demand)
    assert.equal(result[0], '')

    const logs = await p(filter.get.bind(filter))()
    const logAddress = parseLogAddress(logs[1].topics[1])
    assert.equal(logAddress, demand)
  })

  it('deregisterSupply', async () => {
    const supply = accounts[1]
    const url = 'foo'
    await adMarket.registerSupply(supply, url)
    await adMarket.deregisterSupply(supply)
    const result = await adMarket.registeredSupply(supply)
    assert.equal(result[0], '')

    const logs = await p(filter.get.bind(filter))()
    const logAddress = parseLogAddress(logs[1].topics[1])
    assert.equal(logAddress, supply)
  })

  it('updateDemandUrl', async () => {
    const demand = accounts[1]
    const url = 'foo'
    await adMarket.registerDemand(demand, url)
    await adMarket.updateDemandUrl('bar', { from: demand })
    const result = await adMarket.registeredDemand(demand)
    assert.equal(result[0], 'bar')

    const logs = await p(filter.get.bind(filter))()
    const logAddress = parseLogAddress(logs[1].topics[1])
    assert.equal(logAddress, demand)
  })

  it('updateSupplyUrl', async () => {
    const supply = accounts[1]
    const url = 'foo'
    await adMarket.registerSupply(supply, url)
    await adMarket.updateSupplyUrl('bar', { from: supply })
    const result = await adMarket.registeredSupply(supply)
    assert.equal(result[0], 'bar')

    const logs = await p(filter.get.bind(filter))()
    const logAddress = parseLogAddress(logs[1].topics[1])
    assert.equal(logAddress, supply)
  })

  it('openChannel', async () => {
    const demand = accounts[1]
    const supply = accounts[2]
    const demandUrl = 'foo'
    const supplyUrl = 'bar'
    const channelId = solSha3(0)
    await adMarket.registerDemand(demand, demandUrl)
    await adMarket.registerSupply(supply, supplyUrl)

    const blockNumber = await p(web3.eth.getBlockNumber.bind(web3.eth))()
    const channelTimeout = parseBN((await p(adMarket.channelTimeout)())[0])
    const expiration = blockNumber + channelTimeout + 1

    await adMarket.openChannel(supply, { from: demand })

    const channel = parseChannel(await adMarket.getChannel(channelId))

    assert.equal(channel.contractId, adMarket.address)
    assert.equal(channel.channelId, channelId)
    assert.equal(channel.demand, demand)
    assert.equal(channel.supply, supply)
    assert.equal(parseInt(channel.root, 16), 0)
    assert.equal(channel.state, 0)
    assert.equal(channel.expiration, expiration)
    assert.equal(channel.challengeTimeout, 0)
    assert.equal(parseInt(channel.proposedRoot, 16), 0)

    // Set a new snapshot -- after the channel has been opened
    let res = await p(web3.currentProvider.sendAsync.bind(web3.currentProvider))({
      jsonrpc: '2.0',
      method: 'evm_snapshot',
      id: new Date().getTime()
    })
    snapshotId = res.result

    params = [demand, supply, demandUrl, supplyUrl, channelId, channel]
  })

  it('[with channel open] proposeCheckpointChannel -- renew', async () => {
    let [demand, supply, demandUrl, supplyUrl, channelId, channel] = params

    const blockNumber = await p(web3.eth.getBlockNumber.bind(web3.eth))()
    const challengePeriod = parseBN((await p(adMarket.challengePeriod)())[0])
    const challengeTimeout = blockNumber + challengePeriod + 1

    const proposedRoot = solSha3('wut')
    channel.root = proposedRoot
    const fingerprint = getFingerprint(channel)
    const sig = await p(web3.eth.sign)(demand, fingerprint)
    await adMarket.proposeCheckpointChannel(
      channelId, proposedRoot, sig, true, { from: demand }
    )

    const updatedChannel = parseChannel(await adMarket.getChannel(channelId))
    assert.equal(updatedChannel.state, 1)
    assert.equal(updatedChannel.challengeTimeout, challengeTimeout)
    assert.equal(updatedChannel.proposedRoot, proposedRoot)
  })

  it('[with channel open] proposeCheckpointChannel -- close', async () => {
    let [demand, supply, demandUrl, supplyUrl, channelId, channel] = params

    const blockNumber = await p(web3.eth.getBlockNumber.bind(web3.eth))()
    const challengePeriod = parseBN((await p(adMarket.challengePeriod)())[0])
    const challengeTimeout = blockNumber + challengePeriod + 1

    const proposedRoot = solSha3('wut')
    channel.root = proposedRoot
    const fingerprint = getFingerprint(channel)
    const sig = await p(web3.eth.sign)(demand, fingerprint)
    await adMarket.proposeCheckpointChannel(
      channelId, proposedRoot, sig, false, { from: demand }
    )

    const updatedChannel = parseChannel(await adMarket.getChannel(channelId))
    assert.equal(updatedChannel.state, 2)
    assert.equal(updatedChannel.challengeTimeout, challengeTimeout)
    assert.equal(updatedChannel.proposedRoot, proposedRoot)
  })

  it('[with channel open] checkpointChannel -- renew', async () => {
    let [demand, supply, demandUrl, supplyUrl, channelId, channel] = params

    const proposedRoot = solSha3('wut')
    channel.root = proposedRoot
    const fingerprint = getFingerprint(channel)
    const sig = await p(web3.eth.sign)(demand, fingerprint)
    await adMarket.proposeCheckpointChannel(
      channelId, proposedRoot, sig, false, { from: demand }
    )

    // mine blocks until the challenge period expires
    await mineBlocks(CHALLENGE_PERIOD + 1)

    await adMarket.checkpointChannel(channelId, { from: demand })

    const blockNumber = await p(web3.eth.getBlockNumber.bind(web3.eth))()
    const expiration = blockNumber + CHANNEL_TIMEOUT + 1

    const updatedChannel = parseChannel(await adMarket.getChannel(channelId))

    assert.equal(updatedChannel.state, 0)
    assert.equal(updatedChannel.challengeTimeout, 0)
    assert.equal(updatedChannel.expiration, expiration)
    assert.equal(updatedChannel.root, proposedRoot)
    assert.equal(updatedChannel.proposedRoot, 0)
  })

  it.skip('checkpointChannel -- close', async () => {

  })

  it.skip('challengeCheckpointChannel', async () => {
    const demand = accounts[1]
    const supply = accounts[2]
    const demandUrl = 'foo'
    const supplyUrl = 'bar'
    const channelId = solSha3(0)
    await adMarket.registerDemand(demand, demandUrl)
    await adMarket.registerSupply(supply, supplyUrl)
    await adMarket.openChannel(supply, { from: demand })
    const channel = makeChannel(parseChannel(await adMarket.getChannel(channelId)))

    const update = {
      impressionId: web3.sha3('bar'),
      impressionPrice: 2
    }

    const updatedChannel = makeUpdate(channel, update)
    const fingerprint = getFingerprint(updatedChannel)
    const sig = await p(web3.eth.sign)(demand, fingerprint)
    await adMarket.proposeCheckpointChannel(
      channelId, proposedRoot, sig, { from: demand }
    )

    const proposedCheckpointChannel = parseChannel(await adMarket.getChannel(channelId))
    assert.equal(proposedCheckpointChannel.proposedRoot, updatedChanne.root)

    const update2 = {
      impressionId: web3.sha3('bar'),
      impressionPrice: 2
    }

    const updatedChannel2 = makeUpdate(updatedChannel, update2)
    const fingerprint2 = getFingerprint(updatedChannel2)
    const sig2 = await p(web3.eth.sign)(demand, fingerprint2)

    const leaves = getLeaves(updatedChannel2, updatedChannel2.prevRoot)
    const impressionsLeaf = leaves[2]
    const tree = MerkleTree(leaves, true)
    const proof = tree.getProof(impressionsLeaf)

    await adMarket.challengeCheckpointChannel(
      channelId, updatedChannel2.root, 2, proof, sig2
    )
    // generate merkle proof for impressions

  })

})
