import { assert } from 'chai'
import p from 'es6-promisify'
import Web3 from 'web3'
import MerkleTree, { checkProofOrdered, merkleRoot, getProof } from 'merkle-tree-solidity'
import { sha3 } from 'ethereumjs-util'

import setup from '../../js/setup'
import {
  makeChannel,
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
  parseChallenge
} from '../../js/channel'
import wait from '../../js/utils/wait'

const web3 = new Web3()

describe('AdMarket', () => {

  let adMarket, eth, accounts, web3
  let filter
  let snapshots = []

  let CHANNEL_TIMEOUT = 20
  let CHALLENGE_PERIOD = 10

  const takeSnapshot = () => {
    return new Promise(async (accept) => {
      let res = await p(web3.currentProvider.sendAsync.bind(web3.currentProvider))({
        jsonrpc: '2.0',
        method: 'evm_snapshot',
        id: new Date().getTime()
      })
      accept(res.result)
    })
  }

  const revertSnapshot = (snapshotId) => {
    return new Promise(async (accept) => {
      await p(web3.currentProvider.sendAsync.bind(web3.currentProvider))({
        jsonrpc: '2.0',
        method: 'evm_revert',
        params: [snapshotId],
        id: new Date().getTime()
      })
      accept()
    })
  }

  const mineBlock = () => {
    return new Promise(async (accept) => {
      await p(web3.currentProvider.sendAsync.bind(web3.currentProvider))({
        jsonrpc: '2.0',
        method: 'evm_mine',
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

  describe('[with contract deployed]', () => {

    before(async () => {
      snapshots.push(await takeSnapshot())
    })

    beforeEach(async () => {
      snapshots.push(await takeSnapshot())
      filter = web3.eth.filter({ address: adMarket.address, fromBlock: 0 })
    })

    afterEach(async () => {
      await p(filter.stopWatching.bind(filter))()
      await revertSnapshot(snapshots.pop())
    })

    after(async () => {
      await revertSnapshot(snapshots.pop())
    })

    it('setup', async () => {
      // channelCount should start at 0
      const channelCount = await adMarket.channelCount()
      assert.equal(channelCount[0].toNumber(), 0)
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
    })
  })

  describe('[with channel open]', () => {
    let demand, supply, demandUrl, supplyUrl, channelId, channel

    before(async () => {
      snapshots.push(await takeSnapshot())
      demand = accounts[1]
      supply = accounts[2]
      demandUrl = 'foo'
      supplyUrl = 'bar'
      channelId = solSha3(0)
      await adMarket.registerDemand(demand, demandUrl)
      await adMarket.registerSupply(supply, supplyUrl)
      await adMarket.openChannel(supply, { from: demand })
    })

    beforeEach(async () => {
      snapshots.push(await takeSnapshot())
      channel = parseChannel(await adMarket.getChannel(channelId))
      filter = web3.eth.filter({ address: adMarket.address, fromBlock: 0 })
    })

    afterEach(async () => {
      await p(filter.stopWatching.bind(filter))()
      await revertSnapshot(snapshots.pop())
    })

    after(async () => {
      await revertSnapshot(snapshots.pop())
    })

    it('proposeCheckpoint -- renew', async () => {
      const blockNumber = await p(web3.eth.getBlockNumber.bind(web3.eth))()
      const challengePeriod = parseBN((await p(adMarket.challengePeriod)())[0])
      const challengeTimeout = blockNumber + challengePeriod + 1

      const proposedRoot = solSha3('wut')
      channel.root = proposedRoot
      const fingerprint = getFingerprint(channel)
      const sig = await p(web3.eth.sign)(demand, fingerprint)
      await adMarket.proposeCheckpoint(
        channelId, proposedRoot, sig, true, { from: demand }
      )

      const updatedChannel = parseChannel(await adMarket.getChannel(channelId))
      assert.equal(updatedChannel.state, 1)
      assert.equal(updatedChannel.challengeTimeout, challengeTimeout)
      assert.equal(updatedChannel.proposedRoot, proposedRoot)
    })

    it('proposeCheckpoint -- close', async () => {
      const blockNumber = await p(web3.eth.getBlockNumber.bind(web3.eth))()
      const challengePeriod = parseBN((await p(adMarket.challengePeriod)())[0])
      const challengeTimeout = blockNumber + challengePeriod + 1

      const proposedRoot = solSha3('wut')
      channel.root = proposedRoot
      const fingerprint = getFingerprint(channel)
      const sig = await p(web3.eth.sign)(demand, fingerprint)
      await adMarket.proposeCheckpoint(
        channelId, proposedRoot, sig, false, { from: demand }
      )

      const updatedChannel = parseChannel(await adMarket.getChannel(channelId))
      assert.equal(updatedChannel.state, 2)
      assert.equal(updatedChannel.challengeTimeout, challengeTimeout)
      assert.equal(updatedChannel.proposedRoot, proposedRoot)
    })

    it('checkpointChannel -- renew', async () => {
      const proposedRoot = solSha3('wut')
      channel.root = proposedRoot
      const fingerprint = getFingerprint(channel)
      const sig = await p(web3.eth.sign)(demand, fingerprint)
      await adMarket.proposeCheckpoint(
        channelId, proposedRoot, sig, true, { from: demand }
      )

      await mineBlocks(CHALLENGE_PERIOD)

      await adMarket.checkpointChannel(channelId, { from: demand })

      const blockNumber = await p(web3.eth.getBlockNumber.bind(web3.eth))()
      const expiration = blockNumber + CHANNEL_TIMEOUT

      const updatedChannel = parseChannel(await adMarket.getChannel(channelId))

      assert.equal(updatedChannel.state, 0)
      assert.equal(updatedChannel.challengeTimeout, 0)
      assert.equal(updatedChannel.expiration, expiration)
      assert.equal(updatedChannel.root, proposedRoot)
      assert.equal(updatedChannel.proposedRoot, 0)
    })

    it('checkpointChannel -- close', async () => {
      const proposedRoot = solSha3('wut')
      channel.root = proposedRoot
      const fingerprint = getFingerprint(channel)
      const sig = await p(web3.eth.sign)(demand, fingerprint)
      await adMarket.proposeCheckpoint(
        channelId, proposedRoot, sig, false, { from: demand }
      )

      await mineBlocks(CHALLENGE_PERIOD)

      await adMarket.checkpointChannel(channelId, { from: demand })

      const blockNumber = await p(web3.eth.getBlockNumber.bind(web3.eth))()
      const expiration = blockNumber + CHANNEL_TIMEOUT

      const updatedChannel = parseChannel(await adMarket.getChannel(channelId))

      assert.equal(updatedChannel.state, 3)
      assert.equal(updatedChannel.challengeTimeout, 0)
      assert.equal(updatedChannel.expiration, channel.expiration)
      assert.equal(updatedChannel.root, proposedRoot)
      assert.equal(updatedChannel.proposedRoot, 0)
    })

    it('challengeCheckpoint', async () => {
      const update = {
        impressionId: web3.sha3('bar'),
        price: 2
      }

      const updatedChannel = makeUpdate(makeChannel(channel), update)
      const proposedRoot = updatedChannel.get('root')
      const fingerprint = getFingerprint(updatedChannel)
      const sig = await p(web3.eth.sign)(demand, fingerprint)
      await adMarket.proposeCheckpoint(
        channelId, proposedRoot, sig, true, { from: demand }
      )

      const proposedCheckpointChannel = parseChannel(await adMarket.getChannel(channelId))
      assert.equal(proposedCheckpointChannel.proposedRoot, proposedRoot)

      const update2 = {
        impressionId: web3.sha3('bar'),
        price: 2
      }

      const updatedChannel2 = makeUpdate(updatedChannel, update2)
      const fingerprint2 = getFingerprint(updatedChannel2)
      const sig2 = await p(web3.eth.sign)(demand, fingerprint2)

      const root = updatedChannel2.get('root')
      const leaves = getLeaves(updatedChannel2, updatedChannel2.get('prevRoot'))
      const impressionsLeaf = leaves[2]
      const tree = new MerkleTree(leaves, true)
      const index = 3
      const proof = tree.getProofOrdered(impressionsLeaf, index, true)

      await adMarket.challengeCheckpoint(
        channelId, root, 2, 3, proof, sig2, { from: supply }
      )

      const blockNumber = await p(web3.eth.getBlockNumber.bind(web3.eth))()
      const challengeTimeout = blockNumber + CHALLENGE_PERIOD

      const challenge = parseChallenge(await adMarket.getChallenge(channelId))
      const challengedChannel = parseChannel(await adMarket.getChannel(channelId))
      assert.equal(challenge.challengeRoot, root)
      assert.equal(challenge.impressions, 2)
      assert.equal(challengedChannel.challengeTimeout, challengeTimeout)
    })

    it('acceptChallenge', async () => {
      // proposeCheckpoint with 2 impressions
      // challengeCheckpoint with 1 impression
      // acceptChallenge with 2 impressions

      const index = 3 // index of impressions # in the leaves array

      // create update1, use for challengeCheckpoint
      const update1 = {
        impressionId: web3.sha3('bar'),
        price: 2
      }
      const updatedChannel1 = makeUpdate(makeChannel(channel), update1)
      const root1 = updatedChannel1.get('root')
      const fingerprint1 = getFingerprint(updatedChannel1)
      const sig1 = await p(web3.eth.sign)(demand, fingerprint1)

      // proposeCheckpoint with update2
      const update2 = {
        impressionId: web3.sha3('bar'),
        price: 3
      }
      const updatedChannel2 = makeUpdate(updatedChannel1, update2)
      const root2 = updatedChannel2.get('root')
      const fingerprint2 = getFingerprint(updatedChannel2)
      const sig2 = await p(web3.eth.sign)(demand, fingerprint2)

      await adMarket.proposeCheckpoint(
        channelId, root2, sig2, true, { from: supply }
      )

      // challengeCheckpoint with update1
      const leaves1 = getLeaves(updatedChannel1, updatedChannel1.get('prevRoot'))
      const impressionsLeaf1 = leaves1[2]
      const tree1 = new MerkleTree(leaves1, true)
      const proof1 = tree1.getProofOrdered(impressionsLeaf1, index, true)

      await adMarket.challengeCheckpoint(
        channelId, root1, 1, index, proof1, sig1, { from: demand }
      )

      // acceptChallenge with update2
      const leaves2 = getLeaves(updatedChannel2, updatedChannel2.get('prevRoot'))
      const impressionsLeaf2 = leaves2[2]
      const tree2 = new MerkleTree(leaves2, true)
      const proof2 = tree2.getProofOrdered(impressionsLeaf2, index, true)

      await adMarket.acceptChallenge(
        channelId, 2, index, proof2, { from: supply }
      )

      const blockNumber = await p(web3.eth.getBlockNumber.bind(web3.eth))()
      const expiration = blockNumber + CHANNEL_TIMEOUT

      const finalChannel = parseChannel(await adMarket.getChannel(channelId))
      const finalChallenge = parseChallenge(await adMarket.getChallenge(channelId))

      assert.equal(finalChannel.state, 0)
      assert.equal(finalChannel.expiration, expiration)
      assert.equal(finalChannel.root, root2)
      assert.equal(finalChannel.proposedRoot, 0)
      assert.equal(finalChannel.challengeTimeout, 0)
      assert.equal(finalChallenge.challengeRoot, 0)
      assert.equal(finalChallenge.impressions, 0)
    })

    it('checkpointChannel -- after a valid challenge', async () => {
      // TODO get rid of the unhandled promise rejection warning
      // proposeCheckpoint with 1 impressions
      // challengeCheckpoint with 2 impression
      // acceptChallengeCheckpoint with 1 impression (fails)
      // checkpointChannel with the challenge unanswered

      const index = 3 // index of impressions # in the leaves array

      // proposeCheckpoint with update1
      const update1 = {
        impressionId: web3.sha3('bar'),
        price: 2
      }
      const updatedChannel1 = makeUpdate(makeChannel(channel), update1)
      const root1 = updatedChannel1.get('root')
      const fingerprint1 = getFingerprint(updatedChannel1)
      const sig1 = await p(web3.eth.sign)(demand, fingerprint1)

      await adMarket.proposeCheckpoint(
        channelId, root1, sig1, true, { from: demand }
      )

      // challengeCheckpoint with update2
      const update2 = {
        impressionId: web3.sha3('bar'),
        price: 3
      }
      const updatedChannel2 = makeUpdate(updatedChannel1, update2)
      const root2 = updatedChannel2.get('root')
      const fingerprint2 = getFingerprint(updatedChannel2)
      const sig2 = await p(web3.eth.sign)(demand, fingerprint2)

      const leaves2 = getLeaves(updatedChannel2, updatedChannel2.get('prevRoot'))
      const impressionsLeaf2 = leaves2[2]
      const tree2 = new MerkleTree(leaves2, true)
      const proof2 = tree2.getProofOrdered(impressionsLeaf2, index, true)

      await adMarket.challengeCheckpoint(
        channelId, root2, 2, index, proof2, sig2, { from: supply }
      )

      // acceptChallenge with update1 (fails)
      const leaves1 = getLeaves(updatedChannel1, updatedChannel1.get('prevRoot'))
      const impressionsLeaf1 = leaves1[2]
      const tree1 = new MerkleTree(leaves1, true)
      const proof1 = tree1.getProofOrdered(impressionsLeaf1, index, true)

      try {
        await adMarket.acceptChallenge(
          channelId, 2, index, proof1, { from: demand }
        )
      } catch (err) {
        assert.equal(err.value.message, 'VM Exception while processing transaction: invalid opcode')
        assert.equal(err.value.code, -32000)
      }

      await mineBlocks(CHALLENGE_PERIOD)

      // checkpointChannel after challenge period expires
      await adMarket.checkpointChannel(channelId, { from: supply })

      const blockNumber = await p(web3.eth.getBlockNumber.bind(web3.eth))()
      const expiration = blockNumber + CHANNEL_TIMEOUT

      const finalChannel = parseChannel(await adMarket.getChannel(channelId))
      const finalChallenge = parseChallenge(await adMarket.getChallenge(channelId))

      assert.equal(finalChannel.state, 0)
      assert.equal(finalChannel.challengeTimeout, 0)
      assert.equal(finalChannel.expiration, expiration)
      assert.equal(finalChannel.root, root2)
      assert.equal(finalChannel.proposedRoot, 0)
      assert.equal(finalChallenge.challengeRoot, 0)
      assert.equal(finalChallenge.impressions, 0)
    })
  })
})
