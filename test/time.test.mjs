import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatExpiry, formatAge } from '../src/renderer/src/time.js'

const min = 60 * 1000

test('formatExpiry', () => {
  assert.equal(formatExpiry(null), null)
  assert.equal(formatExpiry(Date.now() - 1000), 'expiring now')
  assert.equal(formatExpiry(Date.now() + 30 * min + 5000), '30m left')
  assert.equal(formatExpiry(Date.now() + 5 * 60 * min), '5h left')
  assert.equal(formatExpiry(Date.now() + 72 * 60 * min), '3d left')
})

test('formatAge', () => {
  assert.equal(formatAge(null), '')
  assert.equal(formatAge(Date.now() - 5000), 'just now')
  assert.equal(formatAge(Date.now() - 12 * min - 1000), '12m ago')
  assert.equal(formatAge(Date.now() - 5 * 60 * min - 1000), '5h ago')
  assert.equal(formatAge(Date.now() - 72 * 60 * min - 1000), '3d ago')
})
