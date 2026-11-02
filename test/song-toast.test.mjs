// When the song pop-up shows: for a song that starts while you are there, never for one already playing when you
// arrive, however late Jellybox's presence turns up (the bug: joining mid-song popped up the song already playing).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toastDecision, LATE_MS } from '../src/renderer/src/songToastRule.js'

// feeds a sequence of answers through the rule the way the component does, and returns when it said "show"
function run(answers, enabled = true) {
  let seen
  return answers.map((track) => {
    const d = toastDecision(seen, track, enabled)
    seen = d.seen
    return d.show
  })
}
const song = (id, positionMs = 0) => ({ id, positionMs })

test('the song already playing when you arrive is never announced', () => {
  assert.deepEqual(run([undefined, song('a', 90000), song('a', 93000)]), [false, false, false])
})

test('the reported bug: Jellybox looks absent for a moment, then turns up with a song 40 seconds in', () => {
  assert.deepEqual(run([undefined, null, song('a', 40000), song('a', 43000)]), [false, false, false, false])
})

test('a song that starts while you are there is announced, also the first one after a quiet room', () => {
  assert.deepEqual(run([undefined, song('a', 30000), song('b', 1200), song('b', 4200)]), [false, false, true, false])
  assert.deepEqual(run([undefined, null, song('a', 2500)]), [false, false, true])
})

test('a skip to the next song is announced, with a margin for the 3 second polling', () => {
  assert.equal(toastDecision('a', song('b', LATE_MS - 1), true).show, true)
  assert.equal(toastDecision('a', song('b', LATE_MS + 1), true).show, false)
})

test('nothing shows when the pop-up is switched off, or the song stops, and the song is still remembered', () => {
  assert.deepEqual(run([undefined, song('a'), song('b', 500)], false), [false, false, false])
  const off = toastDecision('a', song('b', 500), false)
  assert.equal(off.seen, 'b')
  assert.deepEqual(run([undefined, song('a'), null, song('a', 800)]), [false, false, false, true])
})
