// Motion rules that must keep holding: everything is switched off under reduced motion, and the movement lengths come
// from the shared tokens in the range the roadmap gives.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (f) => readFileSync(new URL(`../src/renderer/src/${f}`, import.meta.url), 'utf8')

test('reduced motion removes every animation and transition, last in the motion file', () => {
  const css = read('styles/motion.css')
  const block = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
  assert.match(block, /animation-duration:\s*0\.01ms\s*!important/)
  assert.match(block, /transition-duration:\s*0\.01ms\s*!important/)
  assert.match(block, /animation-iteration-count:\s*1\s*!important/)
  // nothing but the end of the file follows it
  assert.ok(css.slice(css.lastIndexOf('}') + 1).trim() === '')
})

test('the motion tokens are within the roadmap ranges (hover 120-180 ms, screens 250-350 ms, panels 300-400 ms)', () => {
  const css = read('index.css')
  const ms = (name) => Number(css.match(new RegExp(`${name}:\\s*(\\d+)ms`))[1])
  assert.ok(ms('--dur-fast') >= 120 && ms('--dur-fast') <= 180)
  assert.ok(ms('--dur-screen') >= 250 && ms('--dur-screen') <= 350)
  assert.ok(ms('--dur-panel') >= 300 && ms('--dur-panel') <= 400)
  assert.ok(ms('--dur-colour') >= 250 && ms('--dur-colour') <= 350)
})

test('a screen change slides no more than 12 px, and nothing in the motion file bounces or springs', () => {
  const css = read('styles/motion.css')
  for (const m of css.matchAll(/translateY\((-?\d+)px\)/g)) assert.ok(Math.abs(Number(m[1])) <= 12, m[0])
  assert.ok(!/cubic-bezier\([^)]*-\d/.test(css), 'no easing that overshoots')
  assert.ok(!/infinite/.test(css), 'no repeating loops')
})
