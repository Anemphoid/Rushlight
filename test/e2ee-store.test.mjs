// The key store contract, on the in-memory store (the IndexedDB store is checked in a real Chromium by
// scripts/e2ee-store-check.mjs, which needs Playwright). Keys are scoped per account and server, a stored key is
// a copy (changing the bytes you were given cannot change what is stored), and clear() forgets one account only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { memoryStore, defaultStore } from '../src/renderer/src/e2ee/keystore.js'

test('server keys come back per account and server, in a copy', async () => {
  const s = memoryStore()
  const bytes = new Uint8Array(32).fill(7)
  await s.putServerKey('a|1', 5, 2, bytes)
  await s.putServerKey('a|1', 5, 1, new Uint8Array(32).fill(8))
  await s.putServerKey('a|1', 50, 1, new Uint8Array(32).fill(9))
  await s.putServerKey('a|2', 5, 1, new Uint8Array(32).fill(1))
  bytes.fill(0) // changing what we handed over changes nothing stored
  const got = await s.getServerKeys('a|1', 5)
  assert.deepEqual([...got.keys()].sort(), [1, 2])
  assert.equal(got.get(2)[0], 7)
  got.get(2).fill(0) // nor does changing what we were given back
  assert.equal((await s.getServerKeys('a|1', 5)).get(2)[0], 7)
  assert.deepEqual([...(await s.getServerKeys('a|1', 50)).keys()], [1])
  assert.deepEqual([...(await s.getServerKeys('a|2', 5)).keys()], [1])
  assert.equal((await s.getServerKeys('a|3', 5)).size, 0)
})

test('clear forgets one account on one server address and no one else', async () => {
  const s = memoryStore()
  await s.putDevice('a|1', { deviceId: 1 })
  await s.putDevice('a|2', { deviceId: 2 })
  await s.putServerKey('a|1', 5, 1, new Uint8Array(32))
  await s.putServerKey('a|2', 5, 1, new Uint8Array(32))
  await s.clear('a|1')
  assert.equal(await s.getDevice('a|1'), null)
  assert.equal((await s.getServerKeys('a|1', 5)).size, 0)
  assert.equal((await s.getDevice('a|2')).deviceId, 2)
  assert.equal((await s.getServerKeys('a|2', 5)).size, 1)
})

test('without IndexedDB the app falls back to the memory store', () => {
  assert.equal(globalThis.indexedDB, undefined)
  assert.equal(defaultStore().kind, 'memory')
})
