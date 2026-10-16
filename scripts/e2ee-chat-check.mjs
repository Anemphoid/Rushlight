// Drives the real production build in Chromium against a real server whose server is switched to encrypted
// (in the database, since no route does it yet), with separate browser profiles for each person, and checks the
// chat the way a person would use it:
//   - the owner's first sign-in makes the first key; a member's window picks it up; both read each other;
//   - what the server stored is ciphertext (the database never contains the words typed);
//   - a command like /help is not echoed as a message, and the bot still answers;
//   - there is no picture button in an encrypted server;
//   - a member who has just joined sees the waiting notice and a disabled composer, then reads the whole history
//     once another member's window hands the key over;
//   - after the owner removes a member, the remaining ones carry on on a new key and the removed one reads nothing new.
// Needs `npm run build`, Playwright's Chromium and RUSHLIGHT_SERVER_DIR (v0.13.0 or later). Not part of `npm test`.
// Run: node scripts/e2ee-chat-check.mjs [outDir]
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { setup } from './ui-shots/lib.mjs'

const outDir = process.argv[2] || mkdtempSync(join(tmpdir(), 'e2ee-chat-'))
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
  const dad = await reg('Dad')
  const server = await w.call('POST', '/api/servers', { name: 'Sealed' }, owner.token)
  const code = await w.call('POST', `/api/servers/${server.id}/codes`, { singleUse: false, expiresInMinutes: null }, owner.token)
  await w.call('POST', '/api/servers/join', { code: code.code }, mia.token)
  await w.call('POST', `/api/channels`.replace('/channels', `/servers/${server.id}/channels`), { name: 'General', mode: 'text', persistent: true }, owner.token)
  {
    const Database = createRequire(join(w.dir, 'package.json'))('better-sqlite3')
    const db = new Database(w.dbPath)
    db.prepare('UPDATE servers SET e2ee_enabled = 1 WHERE id = ?').run(server.id)
    db.close()
  }

  const open = async (page) => {
    await page.click('.rail-btn[title="Sealed"]')
    await page.click('.channel-row:has-text("General")')
    await page.waitForSelector('.text-chat-composer')
  }
  const say = async (page, text) => {
    await page.fill('.text-chat-composer input:not([type=file])', text)
    await page.click('.text-chat-composer button[type=submit]')
  }
  const bodies = (page) => page.$$eval('.text-chat-message-body', (els) => els.map((e) => e.textContent.trim()))
  const until = async (fn, what, ms = 20000) => {
    const end = Date.now() + ms
    for (;;) {
      const v = await fn()
      if (v) return v
      if (Date.now() > end) throw new Error('timed out waiting for ' + what)
      await sleep(250)
    }
  }

  const olivePage = pages.olive = await h.newPage({ session: owner.token, width: 1100, height: 700, fixedClock: false, version: '0.22.0' })
  const miaPage = pages.mia = await h.newPage({ session: mia.token, width: 1100, height: 700, fixedClock: false, version: '0.22.0' })
  await open(olivePage)
  await until(async () => (await olivePage.$('.chat-encrypted')) && !(await olivePage.$('.key-notice')), "Olive's first key")
  assert.equal((await olivePage.$$('.composer-picture-btn')).length, 0, 'no picture button in an encrypted server')

  await open(miaPage)
  await until(async () => !(await miaPage.$('.key-notice')), "Mia's key (handed over by Olive's window)")
  await say(miaPage, 'the launch code is hunter2')
  await until(async () => (await bodies(olivePage)).includes('the launch code is hunter2'), 'Olive reading Mia')
  await say(olivePage, 'received, tidy emoji \u{1F9EA} and 日本語 work too')
  await until(async () => (await bodies(miaPage)).includes('received, tidy emoji \u{1F9EA} and 日本語 work too'), 'Mia reading Olive')
  await h.shot(olivePage, 'chat-encrypted')

  // the server never saw the words
  const stored = rows('SELECT text, enc_epoch FROM messages WHERE channel_id IS NOT NULL')
  assert.ok(stored.length >= 2 && stored.every((m) => m.enc_epoch === 1 && m.text.startsWith('rl1.')), JSON.stringify(stored))
  assert.ok(!JSON.stringify(stored).includes('hunter2'))

  // a command is not a message, and the bot answers
  const before = rows('SELECT COUNT(*) AS n FROM messages')[0].n
  await say(miaPage, '/help')
  await until(async () => (await bodies(miaPage)).some((b) => /Jellybox/i.test(b)), 'the bot answering /help')
  assert.equal(rows('SELECT COUNT(*) AS n FROM messages')[0].n, before + 1, 'only the bot reply was stored, not the command')
  assert.ok(!(await bodies(miaPage)).includes('/help'))

  // a newcomer waits for the key, then reads everything
  await w.call('POST', '/api/servers/join', { code: code.code }, dad.token)
  const dadPage = pages.dad = await h.newPage({ session: dad.token, width: 1100, height: 700, fixedClock: false, version: '0.22.0' })
  await open(dadPage)
  const sawNotice = await until(async () => dadPage.$('.key-notice'), "Dad's waiting notice", 8000).catch(() => null)
  // (his window may be handed the key within the first seconds; if it was quick the notice never showed)
  if (sawNotice) {
    assert.equal(await dadPage.$eval('.text-chat-composer input:not([type=file])', (e) => e.disabled), true)
    await h.shot(dadPage, 'chat-waiting-for-key')
  }
  await until(async () => !(await dadPage.$('.key-notice')), "Dad's key", 40000)
  await until(async () => (await bodies(dadPage)).includes('the launch code is hunter2'), 'Dad reading the history')

  // removing Mia: the rest move to a new key; she reads nothing new
  await w.call('POST', `/api/servers/${server.id}/members/${mia.id}/kick`, undefined, owner.token)
  await until(async () => rows('SELECT e2ee_epoch AS e FROM servers WHERE id = ?', server.id)[0].e === 2, 'the second key', 30000)
  await say(dadPage, 'after the kick')
  await until(async () => (await bodies(olivePage)).includes('after the kick'), 'Olive reading Dad on the new key')
  assert.ok(!JSON.stringify(rows('SELECT text FROM messages')).includes('after the kick'))
  assert.ok(!(await bodies(miaPage)).includes('after the kick'))

  const bad = h.log.filter((l) => !/Failed to load resource|401|403/.test(l))
  assert.deepEqual(bad, [], 'no unexpected console errors:\n' + bad.join('\n'))
  console.log('encrypted chat in the real build: ok  (pictures in ' + outDir + ')')
} catch (err) {
  failed = true
  console.error('encrypted chat check: FAILED\n', err)
  for (const [who, page] of Object.entries(pages)) console.error(`--- ${who}'s chat:\n` + (await page.$eval('.text-chat', (e) => e.innerText).catch(() => '(no chat open)')))
  console.error(h.log.join('\n'))
} finally {
  await h.close()
}
process.exit(failed ? 1 : 0)
