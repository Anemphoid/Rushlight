// Drives the real production build in Chromium against a real server (v0.20.0 or later):
//   - sign-up: the plain warning comes before the recovery key, the key is shown, the three-word check works, and the account
//     ends up with a keyring backup;
//   - an account on an encrypted server: Settings > Account > Key backup says "Not backed up" (and the tree says so), the
//     recovery key makes the backup, wrong words are refused;
//   - the lost computer: the first computer is removed, a fresh profile waits with a pairing code and no history, "Use your
//     recovery key instead" approves it with the words (a wrong key is refused first) and the old messages open.
// Needs `npm run build`, Playwright's Chromium and RUSHLIGHT_SERVER_DIR. Not part of `npm test`.
// Run: node scripts/e2ee-keyring-check.mjs [outDir]
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { setup } from './ui-shots/lib.mjs'

const outDir = process.argv[2] || mkdtempSync(join(tmpdir(), 'e2ee-keyring-'))
const h = await setup({ outDir, seedWorld: false })
const w = h.world
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rows = (sql, ...args) => {
  const Database = createRequire(join(w.dir, 'package.json'))('better-sqlite3')
  const db = new Database(w.dbPath, { readonly: true })
  try {
    return db.prepare(sql).all(...args)
  } finally {
    db.close()
  }
}
const until = async (fn, what, ms = 30000) => {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error('timed out waiting for ' + what)
    await sleep(250)
  }
}
let failed = false
const pages = {}
try {
  // ---- sign-up through the real screens ----
  const signup = (pages.signup = await h.newPage({ width: 1100, height: 760, fixedClock: false, version: '0.31.0' }))
  await signup.click('button:has-text("Create an account")')
  await signup.waitForSelector('#auth-new-username')
  await signup.fill('#auth-new-username', 'Newcomer')
  await signup.fill('#auth-new-password', w.password)
  await signup.fill('#auth-new-confirm', w.password)
  await signup.click('button.auth-primary')
  await signup.waitForSelector('.key-warning')
  const warning = await signup.textContent('.key-warning')
  assert.match(warning, /Nobody can recover it for you/)
  assert.equal((await signup.$$('.key-word')).length, 0, 'the key is not on screen before the warning is read')
  await h.shot(signup, 'keyring-warning')
  await signup.click('button:has-text("I understand, show my key")')
  await signup.waitForSelector('.key-word')
  const words = await signup.$$eval('.key-word', (els) => els.map((e) => e.textContent.replace(/^\d+/, '').trim()))
  assert.equal(words.length, 12)
  await signup.check('#keyUnderstood')
  const labels = await signup.$$eval('.key-check label', (els) => els.map((e) => Number(e.textContent.replace(/\D/g, ''))))
  const inputs = await signup.$$('.key-check input')
  for (let i = 0; i < inputs.length; i++) await inputs[i].fill(words[labels[i] - 1])
  await signup.click('button.auth-primary:has-text("I saved it")')
  await until(() => rows("SELECT keyring_blob FROM accounts WHERE username = 'Newcomer'")[0]?.keyring_blob, 'the sign-up backup')
  assert.ok(rows("SELECT keyring_blob FROM accounts WHERE username = 'Newcomer'")[0].keyring_blob.startsWith('rlk1.'))

  // ---- an account on an encrypted server ----
  const reg = async (name) => {
    const a = await w.call('POST', '/api/register', { username: name, password: w.password })
    await w.call('POST', '/api/me/recovery-key/ack', {}, a.token)
    return a
  }
  const olive = await reg('Olive')
  const server = await w.call('POST', '/api/servers', { name: 'Vault' }, olive.token)
  await w.call('POST', `/api/servers/${server.id}/channels`, { name: 'General', mode: 'text', persistent: true }, olive.token)
  {
    const Database = createRequire(join(w.dir, 'package.json'))('better-sqlite3')
    const db = new Database(w.dbPath)
    db.prepare('UPDATE servers SET e2ee_enabled = 1 WHERE id = ?').run(server.id)
    db.close()
  }
  const one = (pages.one = await h.newPage({ session: olive.token, width: 1100, height: 760, fixedClock: false, version: '0.31.0' }))
  await one.click('.rail-btn[title="Vault"]')
  await one.click('.channel-row:has-text("General")')
  await until(async () => (await one.$('.chat-encrypted')) && !(await one.$('.key-notice')), 'the first key')
  await one.fill('.text-chat-composer input:not([type=file])', 'written before the computer was lost')
  await one.click('.text-chat-composer button[type=submit]')
  await until(async () => (await one.$$eval('.text-chat-message-body', (e) => e.map((x) => x.textContent))).some((t) => t.includes('written before')), 'the message')
  await until(async () => ((await one.textContent('.device-notices').catch(() => '')) || '').includes('not backed up'), 'the not-backed-up notice')
  await h.shot(one, 'keyring-banner')

  await one.click('button[title="Settings"]')
  await one.click('.rl-nav-item:has-text("Account")')
  await one.waitForSelector('.settings-block strong:has-text("Not backed up")')
  await one.click('button:has-text("Back up my keys")')
  await one.fill('#backup-words', 'abandon '.repeat(11) + 'ability')
  await one.click('button[type=submit]:has-text("Back up")')
  await one.waitForSelector('.error-text:has-text("recovery key")')
  await one.fill('#backup-words', olive.recoveryKey)
  await one.click('button[type=submit]:has-text("Back up")')
  await one.waitForSelector('text=Your keys are backed up')
  await h.shot(one, 'keyring-backed-up')
  assert.ok(rows('SELECT keyring_blob FROM accounts WHERE id = ?', olive.id)[0].keyring_blob)

  // ---- the lost computer ----
  const dev = rows('SELECT id FROM device_keys WHERE account_id = ?', olive.id)[0]
  assert.equal((await w.call('DELETE', `/api/devices/${dev.id}`, undefined, olive.token)).removed, true)
  const fresh = (pages.fresh = await h.newPage({ session: olive.token, width: 1100, height: 760, fixedClock: false, version: '0.31.0' }))
  await fresh.click('.rail-btn[title="Vault"]')
  await fresh.waitForSelector('.pairing-notice', { timeout: 30000 })
  await h.shot(fresh, 'keyring-lost-waiting')
  await fresh.click('button:has-text("Use your recovery key instead")')
  await fresh.fill('#pair-words', 'abandon '.repeat(11) + 'ability')
  await fresh.click('button:has-text("Use this recovery key")')
  await fresh.waitForSelector('.pairing-notice .error-text')
  assert.match(await fresh.textContent('.pairing-notice .error-text'), /doesn't match/)
  await fresh.fill('#pair-words', olive.recoveryKey.toUpperCase().replace(/ /g, ', '))
  await fresh.click('button:has-text("Use this recovery key")')
  await until(async () => !(await fresh.$('.pairing-notice')), 'the computer to be approved', 40000)
  await fresh.click('.channel-row:has-text("General")').catch(() => {})
  await until(async () => (await fresh.$$eval('.text-chat-message-body', (e) => e.map((x) => x.textContent))).some((t) => t.includes('written before the computer was lost')), 'the history opening', 40000)
  await h.shot(fresh, 'keyring-restored')
  console.log('the keyring backup in the real build: ok  (pictures in ' + outDir + ')')
} catch (err) {
  failed = true
  console.log('the keyring backup: FAILED\n', err)
  for (const [name, p] of Object.entries(pages)) {
    try {
      console.log(`--- ${name}:\n` + (await p.textContent('body')).replace(/\s+/g, ' ').slice(0, 700))
    } catch {
      // page gone
    }
  }
} finally {
  await h.close()
}
process.exit(failed ? 1 : 0)
