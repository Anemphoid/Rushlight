// Density and icon size are remembered, and a bad stored value falls back to the default.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v))
}
const p = await import('../src/renderer/src/displayPrefs.js')

test('defaults when nothing is stored', () => {
  store.clear()
  assert.equal(p.loadDensity(), 'cozy')
  assert.equal(p.loadIconSize(), 'medium')
})

test('a saved choice comes back', () => {
  store.clear()
  p.saveDensity('compact')
  p.saveIconSize('large')
  assert.equal(p.loadDensity(), 'compact')
  assert.equal(p.loadIconSize(), 'large')
})

test('an unknown stored value falls back, and the two are kept apart', () => {
  store.clear()
  store.set('rushlight-density', 'huge')
  store.set('rushlight-icon-size', 'compact')
  assert.equal(p.loadDensity(), 'cozy')
  assert.equal(p.loadIconSize(), 'medium')
})

test('storage that throws does not break loading or saving', () => {
  const real = globalThis.localStorage
  globalThis.localStorage = {
    getItem() { throw new Error('blocked') },
    setItem() { throw new Error('blocked') }
  }
  assert.equal(p.loadDensity(), 'cozy')
  assert.doesNotThrow(() => p.saveDensity('compact'))
  globalThis.localStorage = real
})

test('the Settings choices match what can be stored', () => {
  assert.deepEqual(p.DENSITIES, ['compact', 'cozy', 'comfortable'])
  assert.deepEqual(p.ICON_SIZES, ['small', 'medium', 'large'])
})
