import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redactionBars } from '../src/renderer/src/redaction.js'

test('the same message id always gives the same bars', () => {
  for (const id of [1, 2, 99, 12345, 2 ** 31 - 1]) assert.deepEqual(redactionBars(id), redactionBars(id))
  assert.deepEqual(redactionBars('17'), redactionBars(17)) // an id that arrives as text is the same id
})

test('one to three bars, each a believable width, and a last bar that is shorter', () => {
  const counts = new Set()
  for (let id = 1; id <= 2000; id++) {
    const bars = redactionBars(id)
    counts.add(bars.length)
    assert.ok(bars.length >= 1 && bars.length <= 3, String(id))
    for (const w of bars) assert.ok(Number.isInteger(w) && w >= 25 && w <= 95, `${id}: ${w}`)
    if (bars.length > 1) assert.ok(bars[bars.length - 1] <= 65 && bars[0] >= 62, `${id}: ${bars}`)
  }
  assert.deepEqual([...counts].sort(), [1, 2, 3])
})

test('different ids look different, so a run of redacted messages is not a column of identical bars', () => {
  const seen = new Set()
  for (let id = 1; id <= 200; id++) seen.add(redactionBars(id).join(','))
  assert.ok(seen.size > 50, `only ${seen.size} different patterns in 200 ids`)
})
