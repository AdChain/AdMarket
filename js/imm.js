var I = require('immutable')
var map1 = I.Map({ a: 1, b: 2, c: 3 })
var map2 = map1.set('b', 50)
console.log(map1.get('b'))
console.log(map2.get('b'))

var list1 = I.List.of(1, 2)
var list2 = list1.push(3, 4, 5)
var list3 = list2.unshift(0)
var list4 = list1.concat(list2, list3)
console.log(list1.size === 2)
console.log(list2.size === 5)
console.log(list3.size === 6)
console.log(list4.size === 13)
console.log(list4.get(0) === 1)

var alpha = I.Map({ a: 1, b: 2, c: 3, d: 4 })
console.log(alpha.map((v, k) => k.toUpperCase()).join())

var map1 = I.Map({ a: 1, b: 2, c: 3, d: 4 })
var map2 = I.Map({ c: 10, a: 20, t: 30 })
var obj = { d: 100, o: 200, g: 300 }
var map3 = map1.merge(map2, obj)
console.log(map3)

var myObject = { a: 1, b: 2, c: 3}
console.log(I.Seq(myObject).map(x => x * x).toObject())

var obj = { 1: 'one' }
console.log(Object.keys(obj))
console.log(obj['1'])
console.log(obj[1])

var map = I.fromJS(obj)
console.log(map.get('1'))
console.log(map.get(1))

var deep = I.Map({ a: 1, b: 2, c: I.List.of(3, 4, 5) })
console.log(deep.toObject()) // shallow convert object (preserve nested Immutable objects)
console.log(deep.toArray()) // shallow convert to array (remove keys)
console.log(deep.toJS()) // deep conversion back to JS
console.log(JSON.stringify(deep))

var nested = I.fromJS({a: {b: {c: [3, 4, 5]}}})
console.log(nested) // objects -> Maps ; arrays -> Lists

var nested2 = nested.mergeDeep({ a: { b: { d: 6}}})
console.log(nested2.getIn(['a', 'b', 'd']))

var nested3 = nested2.updateIn(['a', 'b', 'd'], value => value + 1)
console.log(nested3)

var nested4 = nested3.updateIn(['a', 'b', 'c'], list => list.push(6))
console.log(nested4)

var oddSquares = I.Seq.of(1, 2, 3, 4, 5, 6, 7, 8).filter(x => x % 2).map(x => x * x)
console.log(oddSquares.get(1))

var seq = I.Map({ a: 1, b: 1, c: 1}).toSeq()
console.log(seq.get('a'))

console.log(seq.flip().map(key => key.toUpperCase()).flip().toObject())

var wut = I.Range(1, Infinity)
  .skip(1000)
  .map(n => -n)
  .filter(n => n % 2 === 0)
  .take(2)
  .reduce((r, n) => r * n, 1)

console.log(wut)

var map1 = I.Map({ a: 1, b: 1, c: 1 })
var map2 = I.Map({ a: 1, b: 1, c: 1 })
console.log(map1 !== map2)
console.log(I.is(map1, map2))
console.log(map1.equals(map2))

var list1 = I.List.of(1, 2, 3)
var list2 = list1.withMutations(function (list) {
  list.push(4).push(5).push(6)
})

console.log(list1.size === 3)
console.log(list2.size === 6)

var complex = I.List.of(1, I.Map({ 'a': 5 }))
console.log(complex.setIn(['1', 'a'], 6))
