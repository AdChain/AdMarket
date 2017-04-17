// script.js
// Helper script to hit servers as I develop
// will eventually become api clients

var each = require('async/each')
var request = require('request');

var generateImpressions = function(count, price, supplyId, demandId) {
  const impressions = []
  for (let i = 0; i < count; i++) {
    impressions.push({ price, supplyId, demandId, impressionId: (i+1).toString(), time: new Date().getTime() / 1000 })
  }
  return impressions
}

const demandId = '0x11111111111111111111'
const supplyId = '0x22222222222222222222'

const impressions = generateImpressions(2, 1, supplyId, demandId)
console.log(impressions)

function openChannel(cb) {
  request.get({ url: 'http://localhost:3000/open'}, function(err, res, body) {
    if (err) { throw err }
    console.log('Opened Demand')
    request.get({ url: 'http://localhost:3001/open'}, function(err, res, body) {
      if (err) { throw err }
      console.log('Opened Supply')
      request.get({ url: 'http://localhost:3002/open'}, function(err, res, body) {
        if (err) { throw err }
        console.log('Opened AdMarket')
        cb()
      })
    })
  })
}

openChannel(function () {
  each(impressions, function(impression, cb) {
    let count = 0
    request.post({ url: 'http://localhost:3000', body: impression, json: true }, function(err, res, body) {
      if (err) { throw err }
      // console.log('Sent Impression to Demand')
      count++
      if (count == 3) { cb() }
    });

    request.post({ url: 'http://localhost:3001', body: impression, json: true }, function(err, res, body) {
      if (err) { throw err }
      // console.log('Sent Impression to Supply')
      count++
      if (count == 3) { cb() }
    });

    request.post({ url: 'http://localhost:3002', body: impression, json: true }, function(err, res, body) {
      if (err) { throw err }
      // console.log('Sent Impression to AdMarket')
      count++
      if (count == 3) { cb() }
    });

  }, function(err) {
      if (err) {
        console.log(err)
      } else {
        console.log('done')
      }
      setTimeout(function() {
        request('http://localhost:3001/state', function(err, res, body) {
          // console.log(JSON.stringify(JSON.parse(body), null, 2))
          // const root = JSON.parse(body)[0].root
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
        });
      }, 1000)
  });
})



