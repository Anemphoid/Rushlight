// The new-computer gate, from the app's side, against a real server (needs server v0.19.0): a second computer of an
// account is handed no key until an approved one vouches for it. Each "computer" is its own key manager with its own
// store; the approving one opens the server's challenge with its private key, as the app does.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, installBridge, openServerDb } from './helpers.mjs'

let srv, api, createKeyManager, memoryStore, crypto
before(async () => {
  srv = await startServer({ ACCOUNT_LIMIT: '1000', DEVICE_LIMIT: '1000', ACCOUNT_SECRETS_LIMIT: '1000' })
  installBridge(srv.url, { version: '0.30.0' })
  api = await import('../src/renderer/src/api.js')
  await api.getMe('x').catch(() => {})
  ;({ createKeyManager } = await import('../src/renderer/src/e2ee/keys.js'))
  ;({ memoryStore } = await import('../src/renderer/src/e2ee/keystore.js'))
  crypto = await import('../src/renderer/src/e2ee/crypto.js')
})
after(async () => {
  if (srv) await srv.stop()
})

let n = 0
const computer = (name) => createKeyManager({ api, store: memoryStore(), scope: `${name}-${++n}`, label: name })
async function world() {
  const me = await api.register(`gate${++n}owner`, 'password123')
  const server = await api.createServer(me.token, 'S')
  const db = openServerDb(srv.dbPath)
  db.prepare('UPDATE servers SET e2ee_enabled = 1 WHERE id = ?').run(server.id)
  db.close()
  return { me, server }
}

test('a second computer waits with a code, gets no key, and is handed one only after an approved computer approves it', async () => {
  const { me, server } = await world()
  const desktop = computer('desktop')
  const laptop = computer('laptop')
  assert.equal((await desktop.deviceStatus(me.token)).approved, true)
  await desktop.startEpoch(me.token, server.id)
  await desktop.syncKeys(me.token, server.id)

  const waiting = await laptop.deviceStatus(me.token)
  assert.equal(waiting.approved, false)
  assert.match(waiting.pairing.code, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/)
  assert.ok(waiting.pairing.expiresAt > Date.now())
  // the desktop sees it asking
  assert.deepEqual((await desktop.deviceStatus(me.token)).waiting.map((d) => d.label), ['laptop'])

  // sharing does not reach it, and it finds no key
  await desktop.shareKeys(me.token, server.id)
  const before = await laptop.syncKeys(me.token, server.id)
  assert.equal(before.hasCurrent, false)

  // approving it
  const begin = await desktop.beginApproval(me.token, waiting.pairing.code.toLowerCase())
  assert.equal(begin.device.label, 'laptop')
  await assert.rejects(() => desktop.confirmApproval(me.token, begin.approvalId, 'not-the-password'), /Incorrect password/)
  // a wrong password does not use the approval up: the right one is tried on the same lookup
  const done = await desktop.confirmApproval(me.token, begin.approvalId, 'password123')
  assert.equal(done.approved, true)
  assert.equal((await laptop.deviceStatus(me.token)).approved, true)
  assert.deepEqual((await desktop.deviceStatus(me.token)).waiting, [])

  await desktop.shareKeys(me.token, server.id)
  const after = await laptop.syncKeys(me.token, server.id)
  assert.equal(after.hasCurrent, true, 'handed the key once approved')
})

test('a computer that is not approved cannot approve another, and cannot open a challenge made for someone else', async () => {
  const { me } = await world()
  const desktop = computer('desktop')
  await desktop.deviceStatus(me.token)
  const rogue = computer('rogue')
  const r = await rogue.deviceStatus(me.token)
  await assert.rejects(() => rogue.beginApproval(me.token, r.pairing.code), (e) => e.code === 'not_approved')
  // the attacker has the session, so it can begin an approval naming the real computer, but cannot open the challenge
  const real = await desktop.deviceStatus(me.token)
  const begin = await api.beginDeviceApproval(me.token, r.pairing.code, real.deviceId)
  const rogueDevice = await rogue.ensureDevice(me.token)
  await assert.rejects(
    () => crypto.openApprovalChallenge(begin.challenge, rogueDevice.privateKey, { approvalId: begin.approvalId, deviceId: real.deviceId }),
    (e) => e.code === 'cannot_open'
  )
  // and the genuine computer opens it
  const realDevice = await desktop.ensureDevice(me.token)
  const proof = await crypto.openApprovalChallenge(begin.challenge, realDevice.privateKey, { approvalId: begin.approvalId, deviceId: real.deviceId })
  assert.match(proof, /^[A-Za-z0-9_-]{43}$/)
  assert.equal((await rogue.deviceStatus(me.token)).approved, false)
})

test('a new code replaces the old one, a wrong code is refused, and the code is never kept on the computer', async () => {
  const { me } = await world()
  const desktop = computer('desktop')
  await desktop.deviceStatus(me.token)
  const store = memoryStore()
  const laptop = createKeyManager({ api, store, scope: 'laptop-x', label: 'laptop' })
  const first = (await laptop.deviceStatus(me.token)).pairing.code
  const kept = JSON.stringify(await store.getDevice('laptop-x'), (k, v) => (v instanceof Object && 'type' in v && 'algorithm' in v ? '[key]' : v))
  assert.equal(kept.includes(first), false, 'the code is not stored')
  const renewed = await laptop.renewPairingCode(me.token)
  assert.notEqual(renewed.code, first)
  await assert.rejects(() => desktop.beginApproval(me.token, first), (e) => e.reason === 'bad_code')
  await assert.rejects(() => desktop.beginApproval(me.token, 'ZZZZ-ZZZZ'), (e) => e.reason === 'bad_code')
  assert.equal((await desktop.beginApproval(me.token, renewed.code)).device.label, 'laptop')
})
