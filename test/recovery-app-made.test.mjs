// Recovery keys made by the app, against a real server (needs v0.22.0): sign-up, a reset, a new key from Settings and the
// keyring backup under it, for accounts whose key the app made and ones an older server made. Every request body is recorded,
// and none may contain the words. Avatars are fetched with the token and only for people who share a server.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, installBridge } from './helpers.mjs'
import { keyWords } from '../src/renderer/src/recoveryKey.js'

let srv, api, session, avatars, realFetch
const sent = []
before(async () => {
  srv = await startServer({ ACCOUNT_LIMIT: '1000', RECOVER_LIMIT: '1000', DEVICE_LIMIT: '1000', ACCOUNT_SECRETS_LIMIT: '1000', JOIN_LIMIT: '1000' })
  installBridge(srv.url, { version: '0.33.0' })
  realFetch = globalThis.fetch
  globalThis.fetch = (url, init = {}) => {
    if (typeof init.body === 'string') sent.push({ url: String(url), body: init.body })
    return realFetch(url, init)
  }
  api = await import('../src/renderer/src/api.js')
  await api.getMe('x').catch(() => {})
  session = await import('../src/renderer/src/e2eeSession.js')
  avatars = await import('../src/renderer/src/avatarImage.js')
})
after(async () => {
  globalThis.fetch = realFetch
  if (srv) await srv.stop()
})
let n = 0
const name = () => `appkey${++n}x`
const PASSWORD = 'password123'
const sawWords = (words) => sent.some((s) => keyWords(words).slice(0, 4).every((w) => s.body.toLowerCase().includes(w)) && s.body.toLowerCase().includes(keyWords(words).join(' ')))

// what CreateAccountScreen does
async function signUp() {
  const username = name()
  const key = await session.newRecoveryKey()
  const account = await api.register(username, PASSWORD, key.proofHash)
  const words = key.adopt(account.recoveryKey)
  await session.confirmRecoveryKey({ token: account.token, accountId: account.id, recoveryKey: words })
  return { username, account, words }
}

test('sign-up: the app makes the words, the server is sent none, and the backup is made under them', async () => {
  const { account, words } = await signUp()
  assert.equal(account.recoveryKey, null)
  assert.equal(keyWords(words).length, 12)
  assert.equal(sawWords(words), false, 'the words were sent to the server')
  const me = await api.getMe(account.token)
  assert.equal(me.recoveryKeyAcked, true)
  assert.equal(me.recoveryKeyBy, 'app')
  assert.equal((await api.getKeyring(account.token)).exists, true)
})

test('a reset with the words sends only a proof, ends the old password, and the next key is the app\'s too', async () => {
  const { username, account, words } = await signUp()
  const wrongWords = keyWords(words).reverse().join(' ')
  await assert.rejects(session.resetWithWords(username, wrongWords, 'newpassword1'), (e) => e.status === 401)
  const { reset, words: next } = await session.resetWithWords(username, words, 'newpassword1')
  assert.equal(reset.recoveryKey, null)
  assert.notEqual(next, words)
  await session.confirmRecoveryKey({ token: reset.token, accountId: reset.id, recoveryKey: next })
  assert.equal(sawWords(words), false)
  assert.equal(sawWords(wrongWords), false)
  assert.equal(sawWords(next), false)
  await assert.rejects(api.login(username, PASSWORD), (e) => e.status === 401)
  assert.equal((await api.getMe(reset.token)).recoveryKeyBy, 'app')
  assert.equal(account.id, reset.id)
})

test('an account whose key an older server made: the app falls back to its words for the reset and moves it to an app-made key', async () => {
  const username = name()
  const old = await api.register(username, PASSWORD) // no proof: the server makes the words
  assert.equal(keyWords(old.recoveryKey).length, 12)
  await api.ackRecoveryKey(old.token)
  assert.equal((await api.getMe(old.token)).recoveryKeyBy, 'server')
  // the keyring backup under a key an older server made still works
  await session.createKeyringBackup({ token: old.token, accountId: old.id, words: old.recoveryKey })
  assert.equal((await api.getKeyring(old.token)).exists, true)
  const { reset, words } = await session.resetWithWords(username, old.recoveryKey, 'newpassword1')
  assert.equal(reset.recoveryKey, null)
  await session.confirmRecoveryKey({ token: reset.token, accountId: reset.id, recoveryKey: words })
  assert.equal((await api.getMe(reset.token)).recoveryKeyBy, 'app')
  // from here on the old words are no way in
  await assert.rejects(session.resetWithWords(username, old.recoveryKey, 'another-pass1'), (e) => e.status === 401)
})

test('a new key from Settings is made on this computer and replaces the old one once confirmed', async () => {
  const { username, account, words } = await signUp()
  const key = await session.newRecoveryKey()
  const made = await api.createRecoveryKey(account.token, PASSWORD, key.proofHash)
  assert.equal(made.recoveryKey, null)
  await session.confirmRecoveryKey({ token: account.token, accountId: account.id, recoveryKey: key.words })
  assert.equal(sawWords(key.words), false)
  await assert.rejects(session.resetWithWords(username, words, 'newpassword1'), (e) => e.status === 401, 'the old key stops working')
  assert.ok((await session.resetWithWords(username, key.words, 'newpassword1')).reset.token)
})

test('avatars are fetched with the token, only for people who share a server, and dropped when the sign-in changes', async () => {
  const a = await signUp()
  const b = await signUp()
  const c = await signUp()
  const server = await api.createServer(a.account.token, 'Hall')
  const code = await api.createServerCode(a.account.token, server.id, { singleUse: false, expiresInMinutes: null })
  await api.joinServerWithCode(b.account.token, code.code)
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  await api.uploadAvatar(a.account.token, png, 'image/png')
  const url = `${srv.url}/api/avatars/${a.account.id}?v=1`
  avatars.setAvatarAuth(null)
  assert.equal(await avatars.loadAvatar(url), null, 'nothing without a sign-in')
  avatars.setAvatarAuth(b.account.token)
  const mine = await avatars.loadAvatar(url)
  assert.match(mine, /^blob:/)
  assert.equal(await avatars.loadAvatar(url), mine, 'cached')
  avatars.setAvatarAuth(c.account.token)
  assert.equal(await avatars.loadAvatar(url), null, 'a stranger sees nothing')
  avatars.setAvatarAuth(a.account.token)
  assert.match(await avatars.loadAvatar(url), /^blob:/)
  avatars.setAvatarAuth(null)
})
