// script.js
// Helper script to hit servers as I develop
// will eventually become api clients

const request = require('request-promise')

const mode = process.env.mode

const wait = timeout => new Promise(resolve => setTimeout(resolve, timeout))

function generateImpressions (count, price, supplyId, demandId) {
  const impressions = []
  for (let i = 0; i < count; i++) {
    impressions.push({ price, supplyId, demandId, impressionId: (i + 1).toString(), time: new Date().getTime() / 1000 })
  }
  return impressions
}

const demandId = '0x11111111111111111111'
const supplyId = '0x22222222222222222222'

const impressions = generateImpressions(2, 1, supplyId, demandId)
console.log(impressions)

async function openChannel () {
  // Supply
  await request('http://localhost:3000/open')

  // Demand
  await request('http://localhost:3001/open')

  // AdMarket
  await request('http://localhost:3002/open')

  console.log('Connected to all adservers')
}

async function sendImpression (impression) {
  await request.post({
    url: 'http://localhost:3000',
    body: impression,
    json: true
  })

  await request.post({
    url: 'http://localhost:3001',
    body: impression,
    json: true
  })

  await request.post({
    url: 'http://localhost:3002',
    body: impression,
    json: true
  })
}

async function main () {
  await openChannel()

  for (let impression of impressions) {
    await sendImpression(impression)
  }

  await wait(1000)

  const body = await request('http://localhost:3001/state')

  console.log(JSON.parse(body)[0])

  /*
  request.get({ url: 'http://localhost:3000/verify', body: {
    supplyId: supplyId,
    demandId: demandId,
    root: root,
    start: 0,
    end: 2
  }, json: true }, function(err, res, body) {
    console.log('PEWPEWPEW')
    console.log(body)
  });
  */
}

main().catch((err) => {
  console.error(err.stack)
  process.exit(1)
})
