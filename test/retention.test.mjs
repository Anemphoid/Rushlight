// The wording about how long history is kept, and the day dividers in chat (Today, Yesterday, then the date,
// in the viewer's own timezone). Dates are built from local parts, so the tests hold in any timezone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayKey, dayLabel } from '../src/renderer/src/time.js'
import { keptNotice, retentionLabel, RETENTION_CHOICES } from '../src/renderer/src/retention.js'

const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime()

test('the notice says plainly how long history is kept and that old messages are deleted', () => {
  assert.equal(keptNotice(12), 'History is kept for 12 months, then the oldest messages are deleted.')
  assert.equal(keptNotice(3), 'History is kept for 3 months, then the oldest messages are deleted.')
  assert.equal(retentionLabel(6), '6 months')
  assert.deepEqual(RETENTION_CHOICES, [3, 6, 9, 12])
})

test('messages from today are Today and yesterday are Yesterday, whatever the hour', () => {
  const now = at(2026, 10, 12, 0, 5) // just after midnight
  assert.equal(dayLabel(at(2026, 10, 12, 0, 1), now), 'Today')
  assert.equal(dayLabel(at(2026, 10, 12, 23, 59), now), 'Today')
  assert.equal(dayLabel(at(2026, 10, 11, 23, 59), now), 'Yesterday')
  assert.equal(dayLabel(at(2026, 10, 11, 0, 0), now), 'Yesterday')
  assert.notEqual(dayLabel(at(2026, 10, 10, 23, 59), now), 'Yesterday')
})

test('older days show the date, with the year only once it is not this year', () => {
  const now = at(2026, 10, 12)
  assert.equal(dayLabel(at(2026, 10, 5), now, 'en-US'), 'Mon, Oct 5')
  assert.equal(dayLabel(at(2026, 1, 2), now, 'en-US'), 'Fri, Jan 2')
  assert.equal(dayLabel(at(2025, 12, 31), now, 'en-US'), 'Wed, Dec 31, 2025')
})

test('yesterday works across a month and a year boundary', () => {
  assert.equal(dayLabel(at(2026, 2, 28), at(2026, 3, 1), 'en-US'), 'Yesterday')
  assert.equal(dayLabel(at(2025, 12, 31), at(2026, 1, 1), 'en-US'), 'Yesterday')
  assert.equal(dayLabel(at(2024, 2, 29), at(2024, 3, 1), 'en-US'), 'Yesterday')
})

test('two times on the same local day share a key, and different days do not', () => {
  assert.equal(dayKey(at(2026, 10, 12, 0, 0)), dayKey(at(2026, 10, 12, 23, 59)))
  assert.notEqual(dayKey(at(2026, 10, 12, 23, 59)), dayKey(at(2026, 10, 13, 0, 0)))
  // the same month and day in another year is another day
  assert.notEqual(dayKey(at(2025, 10, 12)), dayKey(at(2026, 10, 12)))
})
