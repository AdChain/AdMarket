// set up smart contract and web3 provider

import fs from 'fs'
import p from 'es6-promisify'
import TestRPC from 'ethereumjs-testrpc'
import solc from 'solc'
import Eth from 'ethjs-query'
import EthContract from 'ethjs-contract'
import Web3 from 'web3'
import HttpProvider from 'ethjs-provider-http'

import wait from './utils/wait'

const SOL_PATH = __dirname + '/../contracts/'
const TESTRPC_PORT = 8545
const MNEMONIC = 'elegant ability lawn fiscal fossil general swarm trap bind require exchange ostrich'

// opts
// testRPCServer - if true, starts a testRPC server
// mnemonic - seed for accounts
// port - testrpc port
// noDeploy - if true, skip adMarket contract deployment
// testRPCProvider - http connection string for console testprc instance
export default async function (opts) {
  opts = opts || {}
  const mnemonic = opts.mnemonic || MNEMONIC
  const testRPCServer = opts.testRPCServer
  const port = opts.port || TESTRPC_PORT
  const noDeploy = opts.noDeploy
  const defaultAcct = opts.defaultAcct ? opts.defaultAcct : 0

  // default: 30 days of 15s blocks on average
  const channelTimeout =  opts.channelTimeout || 172800

  // default: 1 day of 15s blocks on average
  const challengePeriod = opts.challengePeriod || 5760
  const ownerUrl = 'foo.net'

  // START TESTRPC PROVIDER
  let provider
  if (opts.testRPCProvider) {
    provider = new HttpProvider(opts.testRPCProvider)
  } else {
    provider = TestRPC.provider({
      mnemonic: mnemonic,
    })
  }

  // START TESTRPC SERVER
  if (opts.testRPCServer) {
    console.log('setting up testrpc server')
    await p(TestRPC.server({
      mnemonic: mnemonic
    }).listen)(port)
  }

  // BUILD ETHJS ABSTRACTIONS
  const eth = new Eth(provider)
  const contract = new EthContract(eth)
  const accounts = await eth.accounts()

  // COMPILE THE CONTRACT
  const input = {
    'AdMarket.sol': fs.readFileSync(SOL_PATH + 'AdMarket.sol').toString(),
    'ECVerify.sol': fs.readFileSync(SOL_PATH + 'ECVerify.sol').toString()
  }

  const output = solc.compile({ sources: input }, 1)
  if (output.errors) { console.log(Error(output.errors)) }

  const abi = JSON.parse(output.contracts['AdMarket.sol:AdMarket'].interface)
  const bytecode = output.contracts['AdMarket.sol:AdMarket'].bytecode

  // PREPARE THE ADMARKET ABSTRACTION OBJECT
  const AdMarket = contract(abi, bytecode, {
    from: accounts[defaultAcct],
    gas: 3e6
  })

  let adMarketTxHash, adMarketReceipt, adMarket

  if (!noDeploy) {
    // DEPLOY THE ADMARKET CONTRACT
    adMarketTxHash = await AdMarket.new(ownerUrl, channelTimeout, challengePeriod)
    await wait(1500)
    // USE THE ADDRESS FROM THE TX RECEIPT TO BUILD THE CONTRACT OBJECT
    adMarketReceipt = await eth.getTransactionReceipt(adMarketTxHash)
    adMarket = AdMarket.at(adMarketReceipt.contractAddress)
  }

  // MAKE WEB3
  const web3 = new Web3()
  web3.setProvider(provider)
  web3.eth.defaultAccount = accounts[0]

  return { adMarket, AdMarket, eth, accounts, web3 }
}
