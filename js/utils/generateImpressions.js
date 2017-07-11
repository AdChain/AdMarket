module.exports = (count, price, supplyId, demandId) => {
  const impressions = []
  for (let i = 1; i <= count; i++) {
    impressions.push({
      price,
      supplyId,
      demandId,
      impressionId: `${i}`,
      time: (Date.now() / 1e3)|0
    })
  }
  return impressions
}
