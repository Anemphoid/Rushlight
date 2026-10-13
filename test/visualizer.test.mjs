// The visualizer's logic that does not need a screen: the frame governor that keeps a weak computer
// smooth, and the remembered choices. (Drawing itself was checked in a real browser, not here.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FrameGovernor, SCALES } from '../src/renderer/src/visualizer/governor.js'
import { loadPrefs, savePrefs, STYLES } from '../src/renderer/src/visualizer/prefs.js'

// feed `frames` frames spaced `gap` ms apart; returns the step-down events
function feed(g, frames, gap, t0 = 1000) {
  const events = []
  let t = t0
  for (let i = 0; i < frames; i++) {
    t += gap
    if (!g.shouldDraw(t)) continue
    const e = g.frameDrawn(t)
    if (e) events.push(e)
  }
  return events
}

test('a computer that keeps 60 fps is left alone', () => {
  const g = new FrameGovernor()
  assert.deepEqual(feed(g, 600, 16.7), [])
  assert.equal(g.scale, 1)
  assert.equal(g.fps, 60)
})

test('dropping frames lowers the render resolution first, one step at a time, and only then goes to 30', () => {
  const g = new FrameGovernor()
  const events = feed(g, 45 * 8, 40) // about 25 fps, so always slow
  assert.deepEqual(events.slice(0, SCALES.length - 1), ['scale', 'scale', 'scale'])
  assert.equal(g.scale, SCALES[SCALES.length - 1])
  assert.equal(events[SCALES.length - 1], 'fps')
  assert.equal(g.fps, 30)
})

test('it does not drop to 30 while a resolution step is still available', () => {
  const g = new FrameGovernor()
  feed(g, 46, 40)
  assert.equal(g.scale, SCALES[1])
  assert.equal(g.fps, 60)
})

test('once on target at 30 fps it stays there, and it never climbs back up', () => {
  const g = new FrameGovernor()
  feed(g, 45 * 6, 40)
  assert.equal(g.fps, 30)
  const scale = g.scale
  assert.deepEqual(feed(g, 600, 33.4, 100000), [])
  assert.equal(g.fps, 30)
  assert.equal(g.scale, scale)
})

test('at 30 fps a frame is only drawn every other tick', () => {
  const g = new FrameGovernor()
  feed(g, 45 * 6, 40)
  assert.equal(g.fps, 30)
  let drawn = 0
  let t = 500000
  g.resetClock()
  for (let i = 0; i < 120; i++) {
    t += 16.7
    if (g.shouldDraw(t)) {
      g.frameDrawn(t)
      drawn++
    }
  }
  assert.ok(drawn >= 55 && drawn <= 65, 'drew ' + drawn)
})

test('reduced motion draws at a calm 15 fps', () => {
  const g = new FrameGovernor({ reducedMotion: true })
  assert.equal(g.fps, 15)
  let drawn = 0
  let t = 1000
  for (let i = 0; i < 600; i++) {
    t += 16.7
    if (g.shouldDraw(t)) {
      g.frameDrawn(t)
      drawn++
    }
  }
  assert.ok(drawn >= 140 && drawn <= 160, 'drew ' + drawn)
  assert.equal(g.scale, 1) // 15 fps on purpose is not a slow computer
})

test('a pause (switched off, hidden) is not mistaken for a slow frame', () => {
  const g = new FrameGovernor()
  feed(g, 40, 16.7)
  g.resetClock()
  assert.deepEqual(feed(g, 10, 16.7, 600000), [])
  assert.equal(g.scale, 1)
})

const fakeStorage = (initial) => {
  const m = new Map(initial ? [['rushlight.visualizer', initial]] : [])
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), dump: () => m.get('rushlight.visualizer') }
}

test('the visualizer is off by default and the choices are remembered', () => {
  const s = fakeStorage()
  assert.deepEqual(loadPrefs(s), { enabled: false, style: 'bars', shuffle: false, favourites: [] })
  savePrefs({ enabled: true, style: 'radial', shuffle: true, favourites: ['a', 'b'] }, s)
  assert.deepEqual(loadPrefs(s), { enabled: true, style: 'radial', shuffle: true, favourites: ['a', 'b'] })
})

test('damaged or odd saved choices fall back safely', () => {
  assert.equal(loadPrefs(fakeStorage('{not json')).enabled, false)
  const odd = loadPrefs(fakeStorage(JSON.stringify({ enabled: 'yes', style: 'confetti', shuffle: 1, favourites: ['ok', 5, null] })))
  assert.deepEqual(odd, { enabled: false, style: 'bars', shuffle: false, favourites: ['ok'] })
  // blocked storage must not throw
  const blocked = { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') } }
  assert.equal(loadPrefs(blocked).enabled, false)
  assert.doesNotThrow(() => savePrefs({ enabled: true, style: 'bars', shuffle: false, favourites: [] }, blocked))
  assert.deepEqual(STYLES, ['bars', 'wave', 'radial'])
})
