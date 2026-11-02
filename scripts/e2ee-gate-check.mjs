// Drives the real production build in Chromium against a real server (v0.19.0 or later) with encryption on, with one
// person on two "computers" (two separate browser profiles, so two device keys) and a second member whose app is
// online and holds the keys the whole time:
//   - the second computer is shown a pairing code and no messages, and is handed no key even though a member who holds
//     them is online (checked in the database: no envelope for it);
//   - the first computer shows a banner that a new computer is asking to join;
//   - Settings > Account > Add a computer: the code, the name and time of the new computer, the password, Approve;
//   - the second computer then gets its keys and reads the history, and the waiting banner goes away.
// Needs `npm run build`, Playwright's Chromium and RUSHLIGHT_SERVER_DIR. Not part of `npm test`.
// Run: node scripts/e2ee-gate-check.mjs [outDir]
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { setup } from './ui-shots/lib.mjs'

const outDir = process.argv[2] || mkdtempSync(join(tmpdir(), 'e2ee-gate-'))
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
  const reg = async (name) => {
    const a = await w.call('POST', '/api/register', { username: name, password: w.password })
    await w.call('POST', '/api/me/recovery-key/ack', {}, a.token)
    return a
  }
  const olive = await reg('Olive')
  const mia = await reg('Mia')
  const server = await w.call('POST', '/api/servers', { name: 'Gated' }, olive.token)
  const code = await w.call('POST', `/api/servers/${server.id}/codes`, { singleUse: false, expiresInMinutes: null }, olive.token)
  await w.call('POST', '/api/servers/join', { code: code.code }, mia.token)
  await w.call('POST', `/api/servers/${server.id}/channels`, { name: 'General', mode: 'text', persistent: true }, olive.token)
  {
    const Database = createRequire(join(w.dir, 'package.json'))('better-sqlite3')
    const db = new Database(w.dbPath)
    db.prepare('UPDATE servers SET e2ee_enabled = 1 WHERE id = ?').run(server.id)
    db.close()
  }
  const page = (token) => h.newPage({ session: token, width: 1100, height: 760, fixedClock: false, version: '0.30.0' })
  const open = async (p) => {
    await p.click('.rail-btn[title="Gated"]')
    await p.click('.channel-row:has-text("General")')
    await p.waitForSelector('.text-chat-composer')
  }
  const bodies = (p) => p.$$eval('.text-chat-message-body', (els) => els.map((e) => e.textContent.trim()))
  const say = async (p, text) => {
    await p.fill('.text-chat-composer input:not([type=file])', text)
    await p.click('.text-chat-composer button[type=submit]')
  }

  // computer 1 (approved, makes the first key) and Mia (holds the keys, online)
  const one = (pages.one = await page(olive.token))
  await open(one)
  await until(async () => (await one.$('.chat-encrypted')) && !(await one.$('.key-notice')), "the first computer's first key")
  const miaPage = (pages.mia = await page(mia.token))
  await open(miaPage)
  await until(async () => !(await miaPage.$('.key-notice')), "Mia's key")
  await say(miaPage, 'hello from before the new computer')
  await until(async () => (await bodies(one)).includes('hello from before the new computer'), 'computer 1 reading Mia')

  // computer 2: the same account, empty profile
  const two = (pages.two = await page(olive.token))
  await two.click('.rail-btn[title="Gated"]')
  await two.waitForSelector('.pairing-notice', { timeout: 30000 })
  const shown = (await two.textContent('.pairing-code')).match(/[0-9A-Z]{4}-[0-9A-Z]{4}/)[0]
  assert.ok(shown)
  await h.shot(two, 'gate-waiting')
  await two.click('.channel-row:has-text("General")')
  await two.waitForSelector('.key-notice')
  assert.match(await two.textContent('.key-notice'), /not been approved/)
  assert.equal(await two.isDisabled('.text-chat-composer input:not([type=file])'), true, 'cannot write while waiting')

  // it gets no key, although Mia (who holds it) stays online and shares every few seconds
  await sleep(14000)
  const devices = rows('SELECT id, approved_at FROM device_keys WHERE account_id = ? ORDER BY id', olive.id)
  assert.equal(devices.length, 2)
  assert.equal(devices[1].approved_at, null)
  assert.equal(rows('SELECT COUNT(*) AS n FROM key_envelopes WHERE recipient_device_id = ?', devices[1].id)[0].n, 0, 'no envelope for a waiting computer')
  assert.ok(!(await bodies(two)).some((t) => t.includes('hello from before')), 'the words are not shown (only a placeholder)')

  // computer 1 notices it
  await until(async () => (await one.$$('.device-notice')).length > 0 && (await one.textContent('.device-notices')).includes('asking to join your account'), 'the waiting banner')
  await h.shot(one, 'gate-banner')

  // approve: Settings > Account > Add a computer
  await one.click('button[title="Settings"]')
  await one.click('.rl-nav-item:has-text("Account")')
  await one.fill('#pair-code', shown.toLowerCase())
  await one.click('button:has-text("Look it up")')
  await one.waitForSelector('#pair-password')
  assert.match(await one.textContent('.settings-block:has(#pair-password)'), /asked to join your account at/)
  await one.fill('#pair-password', 'wrong-password')
  await one.click('button:has-text("Approve this computer")')
  await one.waitForSelector('.error-text:has-text("Incorrect password")')
  await one.fill('#pair-password', w.password)
  await one.click('button:has-text("Approve this computer")')
  await one.waitForSelector('text=is approved')
  await h.shot(one, 'gate-approved')

  // computer 2 now has its keys and the history
  await until(async () => !(await two.$('.pairing-notice')), 'the waiting notice to go', 40000)
  await two.click('.channel-row:has-text("General")').catch(() => {})
  await until(async () => (await bodies(two)).includes('hello from before the new computer'), 'computer 2 reading the history', 40000)
  assert.ok(rows('SELECT COUNT(*) AS n FROM key_envelopes WHERE recipient_device_id = ?', devices[1].id)[0].n > 0)
  await h.shot(two, 'gate-in')
  console.log('the new-computer gate in the real build: ok  (pictures in ' + outDir + ')')
} catch (err) {
  failed = true
  console.log('the new-computer gate: FAILED\n', err)
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
