// The voice side of encryption that can be checked without a call: which key goes in which slot of LiveKit's ring,
// which key a computer sends with, and which epochs' keys it loads. (Real audio is checked by
// scripts/e2ee-voice-check.mjs against a real LiveKit server.)
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { KeyProviderEvent } from 'livekit-client'
import { VoiceKeyProvider, slotFor, KEY_SLOTS } from '../src/renderer/src/e2ee/voiceKeys.js'
import { deriveVoiceKey, newServerKey } from '../src/renderer/src/e2ee/crypto.js'
import { createKeyManager } from '../src/renderer/src/e2ee/keys.js'
import { memoryStore } from '../src/renderer/src/e2ee/keystore.js'
import { startServer, installBridge, openServerDb } from './helpers.mjs'

const bytes = (n) => new Uint8Array(32).fill(n)
function record(provider) {
  const seen = []
  provider.on(KeyProviderEvent.SetKey, (info, updateCurrent) => seen.push({ index: info.keyIndex, shared: info.participantIdentity === undefined, updateCurrent }))
  return seen
}

test('each epoch goes in its own slot of the ring of 16, wrapping around', () => {
  assert.equal(KEY_SLOTS, 16)
  assert.deepEqual([1, 2, 15, 16, 17, 33].map(slotFor), [1, 2, 15, 0, 1, 1])
})

test('keys are loaded oldest first, so the newest is the one this computer sends with', async () => {
  const p = new VoiceKeyProvider()
  const seen = record(p)
  assert.equal(p.sendingSlot, null)
  await p.setEpochKeys([
    { epoch: 3, bytes: bytes(3) },
    { epoch: 1, bytes: bytes(1) },
    { epoch: 2, bytes: bytes(2) }
  ])
  assert.deepEqual(seen.map((s) => s.index), [1, 2, 3], 'sorted whatever order they came in')
  assert.ok(seen.every((s) => s.shared && s.updateCurrent), 'one shared key for the room, and each one moves the sending slot')
  assert.equal(p.sendingSlot, 3)
  assert.equal(p.getKeys().length, 3, 'older epochs stay loaded so people not yet on the new key can still be heard')
})

test('a later epoch moves the sending slot and keeps the old key loaded', async () => {
  const p = new VoiceKeyProvider()
  await p.setEpochKeys([{ epoch: 1, bytes: bytes(1) }])
  assert.equal(p.sendingSlot, 1)
  await p.setEpochKeys([{ epoch: 2, bytes: bytes(2) }])
  assert.equal(p.sendingSlot, 2)
  assert.deepEqual(p.getKeys().map((k) => k.keyIndex).sort(), [1, 2])
  await p.setEpochKeys([{ epoch: 17, bytes: bytes(9) }]) // wraps onto epoch 1's slot
  assert.equal(p.sendingSlot, 1)
})

test('a newer key can be loaded without being sent with yet, and sent with later', async () => {
  const p = new VoiceKeyProvider()
  await p.setEpochKeys([{ epoch: 1, bytes: bytes(1) }])
  // epoch 2 arrives: loaded, but still sending with epoch 1
  await p.setEpochKeys([{ epoch: 1, bytes: bytes(1) }, { epoch: 2, bytes: bytes(2) }], 1)
  assert.equal(p.sendingSlot, 1)
  assert.deepEqual(p.getKeys().map((k) => k.keyIndex).sort(), [1, 2], 'both loaded')
  // a few seconds later: switch
  await p.setEpochKeys([{ epoch: 2, bytes: bytes(2) }], 2)
  assert.equal(p.sendingSlot, 2)
  // naming an epoch that is not in the list changes nothing about the order
  await p.setEpochKeys([{ epoch: 3, bytes: bytes(3) }], 99)
  assert.equal(p.sendingSlot, 3)
})

test('the provider is a shared-key one that never ratchets or gives up on a key', () => {
  const o = new VoiceKeyProvider().getOptions()
  assert.equal(o.sharedKey, true)
  assert.equal(o.ratchetWindowSize, 0)
  assert.equal(o.failureTolerance, -1)
})

// --- the key manager's voice keys, against a real server ---
let srv
let api
before(async () => {
  srv = await startServer({ ACCOUNT_LIMIT: '1000', DEVICE_LIMIT: '1000' })
  installBridge(srv.url, { version: '0.25.0' })
  api = await import('../src/renderer/src/api.js')
})
after(async () => {
  if (srv) await srv.stop()
})

test('a computer derives the voice key of a space for every epoch it holds, oldest first, the same as everyone else', async () => {
  const owner = await api.register('voiceowner1x', 'password123')
  const server = await api.createServer(owner.token, 'V')
  const channel = await api.createChannel(owner.token, server.id, { name: 'lounge', mode: 'both', persistent: true })
  const joiner = await api.register('voicejoin1x', 'password123')
  const code = await api.createServerCode(owner.token, server.id, { singleUse: false, expiresInMinutes: null })
  await api.joinServerWithCode(joiner.token, code.code)
  const db = openServerDb(srv.dbPath)
  db.prepare('UPDATE servers SET e2ee_enabled = 1 WHERE id = ?').run(server.id)
  db.close()
  const mk = (a) => createKeyManager({ api, store: memoryStore(), scope: `${srv.url}|${a.id}` })
  const A = mk(owner)
  const B = mk(joiner)
  await A.ensureDevice(owner.token)
  await B.ensureDevice(joiner.token)
  await A.startEpoch(owner.token, server.id)
  await B.syncKeys(joiner.token, server.id)
  await api.kickMember(owner.token, server.id, 9999).catch(() => {}) // no such member: harmless
  await A.startEpoch(owner.token, server.id) // a second epoch
  await B.syncKeys(joiner.token, server.id)

  const ctx = { type: 'channel', spaceId: channel.id }
  const a = await A.voiceKeys(server.id, ctx)
  const b = await B.voiceKeys(server.id, ctx)
  assert.deepEqual(a.map((k) => k.epoch), [1, 2])
  assert.deepEqual(b.map((k) => k.epoch), [1, 2])
  for (let i = 0; i < 2; i++) assert.deepEqual(new Uint8Array(a[i].bytes), new Uint8Array(b[i].bytes), 'both computers derive the same key')
  assert.notDeepEqual(new Uint8Array(a[0].bytes), new Uint8Array(a[1].bytes), 'a new epoch is a new key')
  const other = await A.voiceKeys(server.id, { type: 'channel', spaceId: channel.id + 1 })
  assert.notDeepEqual(new Uint8Array(other[0].bytes), new Uint8Array(a[0].bytes), 'another room has another key')
  assert.equal(new Uint8Array(a[0].bytes).length, 32)
})

test('a computer with no keys gets no voice keys', async () => {
  const mk = createKeyManager({ api, store: memoryStore(), scope: 'nobody' })
  assert.deepEqual(await mk.voiceKeys(1, { type: 'channel', spaceId: 1 }), [])
})

test('only the newest 8 epochs are loaded', async () => {
  const store = memoryStore()
  const mk = createKeyManager({ api, store, scope: 'many' })
  for (let e = 1; e <= 11; e++) await store.putServerKey('many', 5, e, newServerKey())
  const keys = await mk.voiceKeys(5, { type: 'room', spaceId: 2, channelId: 1 })
  assert.deepEqual(keys.map((k) => k.epoch), [4, 5, 6, 7, 8, 9, 10, 11])
  // and they are the real derived keys
  const direct = await deriveVoiceKey((await store.getServerKeys('many', 5)).get(11), { serverId: 5, type: 'room', spaceId: 2, channelId: 1, epoch: 11 })
  assert.deepEqual(new Uint8Array(keys.at(-1).bytes), new Uint8Array(direct))
})
