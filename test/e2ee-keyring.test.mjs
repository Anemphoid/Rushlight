// The keyring backup and the lost-computer route, from the app's side, against a real server (needs server v0.20.0): the
// server keys are sealed under a key made from the recovery words, a computer that lost everything approves itself with
// the words (never sent) and gets the history back, and the backup keeps up as new keys arrive.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, installBridge, openServerDb } from './helpers.mjs'

let srv, api, createKeyManager, memoryStore, crypto, session
before(async () => {
  srv = await startServer({ ACCOUNT_LIMIT: '1000', DEVICE_LIMIT: '1000', ACCOUNT_SECRETS_LIMIT: '1000' })
  installBridge(srv.url, { version: '0.31.0' })
  api = await import('../src/renderer/src/api.js')
  await api.getMe('x').catch(() => {})
  ;({ createKeyManager } = await import('../src/renderer/src/e2ee/keys.js'))
  ;({ memoryStore } = await import('../src/renderer/src/e2ee/keystore.js'))
  crypto = await import('../src/renderer/src/e2ee/crypto.js')
  session = await import('../src/renderer/src/e2eeSession.js')
})
after(async () => {
  if (srv) await srv.stop()
})

let n = 0
const computer = (account, name) => createKeyManager({ api, store: memoryStore(), scope: `${name}-${++n}`, label: name, accountId: account.id })
// an account whose recovery key is confirmed, with an encrypted server it owns and a key for it
async function world() {
  const me = await api.register(`ring${++n}x`, 'password123')
  await api.ackRecoveryKey(me.token)
  const server = await api.createServer(me.token, 'S')
  const db = openServerDb(srv.dbPath)
  db.prepare('UPDATE servers SET e2ee_enabled = 1 WHERE id = ?').run(server.id)
  db.close()
  const desktop = computer(me, 'desktop')
  await desktop.deviceStatus(me.token)
  await desktop.startEpoch(me.token, server.id)
  await desktop.syncKeys(me.token, server.id)
  return { me, server, desktop, words: me.recoveryKey }
}

test('the words make two different secrets, the same every time, however they are typed', async () => {
  const w = 'zoo '.repeat(11) + 'yes'
  const a = await crypto.deriveKeyringSecrets(w)
  const b = await crypto.deriveKeyringSecrets(w.toUpperCase().replace(/ /g, ' - '))
  assert.equal(a.proof, b.proof)
  assert.equal(a.proofHash, b.proofHash)
  assert.match(a.proof, /^[A-Za-z0-9_-]{43}$/)
  assert.match(a.proofHash, /^[0-9a-f]{64}$/)
  assert.notEqual(a.proofHash, (await crypto.deriveKeyringSecrets('zoo '.repeat(11) + 'no')).proofHash)
  await assert.rejects(() => crypto.deriveKeyringSecrets('only three words'), (e) => e.code === 'bad_words')
  // the key is not extractable and the proof is not the key
  await assert.rejects(() => globalThis.crypto.subtle.exportKey('raw', a.kek))
  const blob = await crypto.sealKeyring(a.kek, { v: 1, servers: { 5: { 1: crypto.toB64u(new Uint8Array(32).fill(7)) } } }, 42)
  assert.match(blob, /^rlk1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/)
  assert.equal(blob.includes(a.proof), false)
  const opened = await crypto.openKeyring(a.kek, blob, 42)
  assert.deepEqual([...opened[5][1]], new Array(32).fill(7))
  await assert.rejects(() => crypto.openKeyring(a.kek, blob, 43), (e) => e.code === 'cannot_open', 'it is bound to the account')
  const other = await crypto.deriveKeyringSecrets('zoo '.repeat(11) + 'no')
  await assert.rejects(() => crypto.openKeyring(other.kek, blob, 42), (e) => e.code === 'cannot_open')
})

test('a backup made with the right words holds the keys; wrong words are refused and nothing is stored', async () => {
  const { me, desktop, words, server } = await world()
  assert.equal((await desktop.backupStatus(me.token)).exists, false)
  await assert.rejects(() => desktop.createBackup(me.token, 'abandon '.repeat(11) + 'ability'), (e) => e.reason === 'bad_recovery_key')
  assert.equal((await desktop.backupStatus(me.token)).exists, false)
  const made = await desktop.createBackup(me.token, words)
  assert.equal(made.version, 1)
  const status = await desktop.backupStatus(me.token)
  assert.deepEqual([status.exists, status.keptHere], [true, true])
  // what the server stores is opaque: not the key, not the words
  const row = openServerDb(srv.dbPath).prepare('SELECT keyring_blob, keyring_proof_hash FROM accounts WHERE id = ?').get(me.id)
  const key = await desktop.epochsHeld(server.id)
  assert.deepEqual(key, [1])
  assert.ok(row.keyring_blob.startsWith('rlk1.'))
  assert.equal(row.keyring_blob.includes(words.split(' ')[0]), false)
})

test('a computer that lost everything: waiting, then the words alone approve it and bring the history back', async () => {
  const { me, server, desktop, words } = await world()
  await desktop.createBackup(me.token, words)
  const sealed = await desktop.seal(server.id, { type: 'channel', spaceId: 1, authorId: me.id }, 'said before the computer was lost')
  // the desktop is gone: remove it, so there is no approved computer left to ask
  const dev = await desktop.ensureDevice(me.token)
  await api.removeDevice(me.token, dev.deviceId)

  const fresh = computer(me, 'new')
  const waiting = await fresh.deviceStatus(me.token)
  assert.equal(waiting.approved, false)
  assert.deepEqual(await fresh.epochsHeld(server.id), [])
  // wrong words do nothing, and are counted
  await assert.rejects(() => fresh.recoverComputer(me.token, 'abandon '.repeat(11) + 'ability'), (e) => e.reason === 'bad_proof')
  assert.equal((await fresh.deviceStatus(me.token)).approved, false)
  // the right words approve it and give it the keys
  const done = await fresh.recoverComputer(me.token, words)
  assert.equal(done.approved, true)
  assert.ok(done.added >= 1)
  assert.equal((await fresh.deviceStatus(me.token)).approved, true)
  assert.deepEqual(await fresh.epochsHeld(server.id), [1])
  assert.equal(await fresh.open(server.id, { type: 'channel', spaceId: 1, authorId: me.id }, sealed), 'said before the computer was lost')
})

test('the backup keeps up with new keys, and two computers updating at once end up with all of them', async () => {
  const { me, server, desktop, words } = await world()
  await desktop.createBackup(me.token, words)
  assert.deepEqual(await desktop.updateBackup(me.token), { skipped: 'unchanged' })
  // a second computer, approved the normal way, is given the words once (as the one-time step does) and so keeps a key too
  const laptop = computer(me, 'laptop')
  const w = await laptop.deviceStatus(me.token)
  const asked = await desktop.beginApproval(me.token, w.pairing.code)
  await desktop.confirmApproval(me.token, asked.approvalId, 'password123')
  await desktop.shareKeys(me.token, server.id)
  await laptop.syncKeys(me.token, server.id)
  await laptop.restoreBackup(me.token, words) // gives it the means to update; version 1

  // the desktop makes a new epoch and updates the backup (version 2); the laptop still believes version 1
  await desktop.startEpoch(me.token, server.id)
  const u = await desktop.updateBackup(me.token)
  assert.equal(u.version, 2)
  await laptop.syncKeys(me.token, server.id) // not shared yet: the laptop has no epoch 2
  await desktop.shareKeys(me.token, server.id)
  await laptop.syncKeys(me.token, server.id)
  const merged = await laptop.updateBackup(me.token) // stale version: read, merge, retry
  assert.ok(merged.version >= 3, JSON.stringify(merged))

  const third = computer(me, 'third')
  await third.deviceStatus(me.token)
  const rec = await third.recoverComputer(me.token, words)
  assert.equal(rec.approved, true)
  assert.deepEqual(await third.epochsHeld(server.id), [1, 2])
})

test('the session confirms a recovery key and makes the backup in one go, and says so when it cannot', async () => {
  const me = await api.register(`ring${++n}x`, 'password123')
  const done = await session.confirmRecoveryKey({ token: me.token, accountId: me.id, recoveryKey: me.recoveryKey })
  assert.deepEqual(done, { backedUp: true })
  assert.equal((await session.keyringStatus({ token: me.token, accountId: me.id })).exists, true)
  // a key that is not the account's: the key is still confirmed (that is the server's), the backup is reported missing
  const you = await api.register(`ring${++n}x`, 'password123')
  const bad = await session.confirmRecoveryKey({ token: you.token, accountId: you.id, recoveryKey: 'abandon '.repeat(11) + 'ability' })
  assert.equal(bad.backedUp, false)
  assert.match(bad.error, /recovery key/i)
})
