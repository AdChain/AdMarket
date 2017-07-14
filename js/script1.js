// script1.js
// Generates 1 impression, sends to all participants

const request = require('request-promise')

const wait = require('./utils/wait')
const generateImpressions = require('./utils/generateImpressions')

const {
  demand: {hostUrl: demandHostUrl},
  supply: {hostUrl: supplyHostUrl},
  adMarket: {hostUrl: adMarketHostUrl}
} = require('./config')

const demandId = '0x11111111111111111111'
const supplyId = '0x22222222222222222222'

const impressions = generateImpressions(1, 1, supplyId, demandId)

console.log('\nImpression to send:\n', impressions, '\n')

async function openChannel () {
  await request(`${demandHostUrl}/open`)
  await request(`${supplyHostUrl}/open`)
  await request(`${adMarketHostUrl}/open`)

  console.log('Connected to all adservers')
}

async function sendImpression (impression) {
  request.post({
    url: `${adMarketHostUrl}`,
    body: impression,
    json: true
  })

  request.post({
    url: `${demandHostUrl}`,
    body: impression,
    json: true
  })

  request.post({
    url: `${supplyHostUrl}`,
    body: impression,
    json: true
  })
}

async function main () {
  await openChannel()

  for (let impression of impressions) {
    await sendImpression(impression)
  }

  console.log('Impressions sent')

  await wait(1e3)
  //const body = await request(`${supplyHostUrl}/state`)

  request.get({
    url: `${demandHostUrl}/verify`,
    body: {
      supplyId: supplyId,
      demandId: demandId,
      start: 0,
      end: 2
    },
    json: true
  })
  .then(body => {
    console.log('verify response', body)
  })
  .catch(error => {
    console.error(error)
  })
}

main()
.catch((err) => {
  console.error(err.stack)
  process.exit(1)
})
