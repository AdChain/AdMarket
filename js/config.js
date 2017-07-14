const demandPort = process.env.DEMAND_PORT || 3000
const supplyPort = process.env.SUPPLY_PORT || 3001
const adMarketPort = process.env.ADMARKET_PORT || 3002

const config = {
  demand: {
    address: '0x3055a99a7faf398c57483df87826366acdbe62c7',
    privKey: 'a05fc3b43673fce3cfbfe92e30be397e293728d3f314d37ae21489b6a4cfc1e4',
    port: demandPort,
    hostUrl: `http://localhost:${demandPort}`
  },
  supply: {
    address: '0x43dcbf684ed06db394186624d2a1600f99c14e69',
    privKey: 'c3bc97034d7e7076dfb0cad842a899cb6e3b9964e8eb56148762042e2b43ad10',
    port: supplyPort,
    hostUrl: `http://localhost:${supplyPort}`
  },
  adMarket: {
    address: '0x880f6d91e462a06c5ba6007aaae4f0a700d428c9',
    privKey: '19fdeb280ed2eda8d5fafa93cbc1638e3d99c22b1509aaa4ef29dab2227b3fbd',
    port: adMarketPort,
    hostUrl: `http://localhost:${adMarketPort}`
  }
}

module.exports = config
