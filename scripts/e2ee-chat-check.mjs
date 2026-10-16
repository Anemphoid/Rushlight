// Drives the real production build in Chromium against a real server whose server is switched to encrypted
// (in the database, since no route does it yet), with separate browser profiles for each person, and checks the
// chat the way a person would use it:
//   - the owner's first sign-in makes the first key; a member's window picks it up; both read each other;
//   - what the server stored is ciphertext (the database never contains the words typed);
//   - a command like /help is not echoed as a message, and the bot still answers;
//   - a picture is sealed before it leaves, the other person sees it (and can open it larger), and the server's copy
//     is scrambled bytes with no trace of the picture; there is no picture button while the key is missing;
//   - a member who has just joined sees the waiting notice and a disabled composer, then reads the whole history
//     once another member's window hands the key over;
//   - after the owner removes a member, the remaining ones carry on on a new key and the removed one reads nothing new.
// Needs `npm run build`, Playwright's Chromium and RUSHLIGHT_SERVER_DIR (v0.13.0 or later). Not part of `npm test`.
// Run: node scripts/e2ee-chat-check.mjs [outDir]
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { deflateSync, crc32 } from 'node:zlib'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { setup } from './ui-shots/lib.mjs'

const outDir = process.argv[2] || mkdtempSync(join(tmpdir(), 'e2ee-chat-'))
const h = await setup({ outDir, seedWorld: false })
const w = h.world
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// a real PNG (200 x 120 gradient) made here, so the check does not depend on any file
function makePng(width = 200, height = 120) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const rows = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3)
    for (let x = 0; x < width; x++) row.set([(x * 255) / width, (y * 255) / height, 160], 1 + x * 3)
    rows.push(row)
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}
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
  assert.equal((await olivePage.$$('.composer-picture-btn')).length, 1, 'the picture button is there once the key is')

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

  // a picture: sealed before it leaves, seen by the other person, opened larger, scrambled on the server
  const png = makePng()
  await olivePage.setInputFiles('.text-chat-composer input[type=file]', { name: 'gradient.png', mimeType: 'image/png', buffer: png })
  await olivePage.waitForSelector('.composer-picture img')
  await say(olivePage, 'a gradient for you')
  const seen = async (page) =>
    page.$$eval('.chat-image', (imgs) => imgs.map((i) => ({ w: i.naturalWidth, h: i.naturalHeight })))
  await until(async () => (await seen(miaPage)).some((i) => i.w === 200 && i.h === 120), 'Mia seeing the picture at its real size')
  await until(async () => (await bodies(miaPage)).includes('a gradient for you'), "the picture's caption")
  await h.shot(miaPage, 'chat-encrypted-picture')
  await miaPage.click('.chat-image-frame')
  await miaPage.waitForSelector('.chat-image-lightbox img')
  await miaPage.keyboard.press('Escape')
  await miaPage.waitForSelector('.chat-image-lightbox', { state: 'detached' })
  const pic = rows("SELECT mime, width, height, size, data FROM message_images WHERE mime = 'application/x-rushlight-sealed'")
  assert.equal(pic.length, 1, 'one sealed picture stored')
  assert.equal(pic[0].width + pic[0].height, 0)
  assert.ok(Buffer.from(pic[0].data).indexOf(Buffer.from('IHDR')) === -1 && Buffer.from(pic[0].data).indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47])) === -1, 'no trace of the PNG on the server')
  assert.equal(rows("SELECT COUNT(*) AS n FROM message_images WHERE mime LIKE 'image/%'")[0].n, 0, 'no plain picture stored')

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
    assert.equal((await dadPage.$$('.composer-picture-btn')).length, 0, 'no picture button while the key is missing')
    await h.shot(dadPage, 'chat-waiting-for-key')
  }
  await until(async () => !(await dadPage.$('.key-notice')), "Dad's key", 40000)
  await until(async () => (await bodies(dadPage)).includes('the launch code is hunter2'), 'Dad reading the history')
  await until(async () => (await seen(dadPage)).some((i) => i.w === 200 && i.h === 120), 'Dad seeing the old picture')

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
