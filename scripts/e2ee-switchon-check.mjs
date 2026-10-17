// Drives the real production build in Chromium against a real server that is NOT encrypted yet: the owner opens Owner
// Tools > Encryption, reads what will be wiped, waits out (or skips) the 20 second countdown, types the password and
// switches encryption on. Then: the old history is gone from the screen and the database file, the owner's window
// makes the first key by itself, a new message is stored as ciphertext, and a member's window follows.
// Needs `npm run build`, Playwright's Chromium and RUSHLIGHT_SERVER_DIR (v0.18.0 or later). Not part of `npm test`.
// Run: node scripts/e2ee-switchon-check.mjs [outDir]
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { setup } from './ui-shots/lib.mjs'

const outDir = process.argv[2] || mkdtempSync(join(tmpdir(), 'e2ee-switchon-'))
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
const until = async (fn, what, ms = 25000) => {
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
  const reg = async (name) => {
    const a = await w.call('POST', '/api/register', { username: name, password: w.password })
    await w.call('POST', '/api/me/recovery-key/ack', {}, a.token)
    return a
  }
  const owner = await reg('Olive')
  const mia = await reg('Mia')
  const server = await w.call('POST', '/api/servers', { name: 'Switching' }, owner.token)
  const code = await w.call('POST', `/api/servers/${server.id}/codes`, { singleUse: false, expiresInMinutes: null }, owner.token)
  await w.call('POST', '/api/servers/join', { code: code.code }, mia.token)
  const channel = await w.call('POST', `/api/servers/${server.id}/channels`, { name: 'General', mode: 'text', persistent: true }, owner.token)
  const WORDS = 'the-old-plain-words-' + Date.now()
  await w.call('POST', `/api/channels/${channel.id}/messages`, { text: WORDS }, owner.token)

  const olive = (pages.olive = await h.newPage({ session: owner.token, width: 1100, height: 760, fixedClock: false, version: '0.28.0' }))
  await olive.click('.rail-btn[title="Switching"]')
  await olive.click('.channel-row:has-text("General")')
  await until(async () => (await olive.$$eval('.text-chat-message-body', (e) => e.map((x) => x.textContent))).some((t) => t.includes(WORDS)), 'the old words on screen')

  // Owner Tools > Encryption
  await olive.click('button[title="Owner Tools"]')
  await olive.click('text=Encryption')
  await olive.click('button:has-text("Switch on encryption")')
  await olive.waitForSelector('[role=dialog]')
  const text = await olive.textContent('[role=dialog]')
  assert.match(text, /deleted for good/)
  assert.match(text, /1 message/)
  assert.match(text, /older version cannot use this server/)
  await h.shot(olive, 'switchon-dialog')

  // the button does not work during the countdown; neither does it without a password
  await olive.fill('#enc-password', w.password)
  const submit = olive.locator('[role=dialog] button[type=submit]')
  assert.equal(await submit.isDisabled(), true, 'disabled while counting')
  assert.match(await submit.textContent(), /\(\d+\)/)
  await olive.click('[role=dialog] button:has-text("Confirm")')
  await until(async () => !(await submit.isDisabled()), 'Confirm skipping the wait')
  assert.equal((await olive.$$('[role=dialog] button:has-text("Confirm")')).length, 0, 'Confirm goes once the wait is over')

  await submit.click()
  await until(async () => (await olive.textContent('body')).includes('Encryption is on for this server'), 'the switch to take')
  assert.equal(rows('SELECT e2ee_enabled FROM servers WHERE id = ?', server.id)[0].e2ee_enabled, 1)
  assert.equal(rows('SELECT COUNT(*) AS n FROM messages')[0].n, 0, 'history wiped')
  assert.equal(readFileSync(w.dbPath).includes(Buffer.from(WORDS)), false, 'old words gone from the database file')
  await until(() => rows('SELECT e2ee_epoch FROM servers WHERE id = ?', server.id)[0].e2ee_epoch === 1, "the owner's window making the first key")
  await h.shot(olive, 'switchon-done')

  // back to the chat: empty, encrypted, and a new message goes through sealed
  await olive.click('button:has-text("Back")').catch(() => olive.keyboard.press('Escape'))
  await olive.waitForSelector('.chat-encrypted', { timeout: 20000 })
  await olive.fill('.text-chat-composer input:not([type=file])', 'first sealed words')
  await olive.click('.text-chat-composer button[type=submit]')
  await until(() => rows('SELECT text, enc_epoch FROM messages')[0], 'the stored message')
  const stored = rows('SELECT text, enc_epoch FROM messages')[0]
  assert.equal(stored.enc_epoch, 1)
  assert.ok(stored.text.startsWith('rl1.') && !stored.text.includes('sealed words'))

  // Mia's window (an up to date app) follows and reads it
  const miaPage = (pages.mia = await h.newPage({ session: mia.token, width: 1100, height: 700, fixedClock: false, version: '0.28.0' }))
  await miaPage.click('.rail-btn[title="Switching"]')
  await miaPage.click('.channel-row:has-text("General")')
  await until(async () => (await miaPage.$$eval('.text-chat-message-body', (e) => e.map((x) => x.textContent.trim()))).includes('first sealed words'), 'Mia reading the first sealed words', 40000)
  console.log('switching encryption on in the real build: ok  (pictures in ' + outDir + ')')
} catch (err) {
  failed = true
  console.log('switching encryption on: FAILED\n', err)
  for (const [name, page] of Object.entries(pages)) {
    try {
      console.log(`--- ${name}:\n` + (await page.textContent('body')).replace(/\s+/g, ' ').slice(0, 600))
    } catch {
      // page gone
    }
  }
} finally {
  await h.close()
}
process.exit(failed ? 1 : 0)
