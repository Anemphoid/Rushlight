import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keyWords, pickCheckPositions, checkAnswers, CHECK_COUNT } from '../src/renderer/src/recoveryKey.js'

const KEY = 'one two three four five six seven eight nine ten eleven twelve'

test('a key splits into its words, whatever the spacing', () => {
  assert.equal(keyWords(KEY).length, 12)
  assert.deepEqual(keyWords('  a   b\nc '), ['a', 'b', 'c'])
  assert.deepEqual(keyWords(null), [])
})

test('three different positions are asked for, in order, inside the key', () => {
  for (let i = 0; i < 200; i++) {
    const p = pickCheckPositions(12)
    assert.equal(p.length, CHECK_COUNT)
    assert.equal(new Set(p).size, CHECK_COUNT)
    assert.deepEqual(p, [...p].sort((a, b) => a - b))
    assert.ok(p.every((x) => Number.isInteger(x) && x >= 0 && x < 12))
  }
})

test('the positions follow the random source, and a short key never loops forever', () => {
  const seq = [0.0, 0.5, 0.99]
  let i = 0
  assert.deepEqual(pickCheckPositions(12, 3, () => seq[i++]), [0, 6, 11])
  assert.deepEqual(pickCheckPositions(2, 3), [0, 1])
})

test('only the right words, typed any way, pass the check', () => {
  const positions = [1, 6, 11]
  assert.equal(checkAnswers(KEY, positions, ['two', 'seven', 'twelve']), true)
  assert.equal(checkAnswers(KEY, positions, [' TWO ', 'Seven', 'twelve ']), true)
  assert.equal(checkAnswers(KEY, positions, ['two', 'seven', 'eleven']), false)
  assert.equal(checkAnswers(KEY, positions, ['two', 'seven', '']), false)
  assert.equal(checkAnswers(KEY, positions, ['two', 'seven']), false)
  assert.equal(checkAnswers(KEY, [], []), false)
  assert.equal(checkAnswers(KEY, [1], [undefined]), false)
})
