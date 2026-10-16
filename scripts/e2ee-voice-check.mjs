// Real encrypted calls: the production build in Chromium (a separate profile per person, fake microphones that beep),
// a real Rushlight server whose server is switched to encrypted, and a real LiveKit server. Checks, by what the
// receiving browsers actually measure (audio energy on the incoming streams):
//   - two members in an encrypted room hear each other, and the room is marked encrypted;
//   - a member whose key is wrong hears nobody, and nobody hears them;
//   - a newcomer who has no key yet does not connect (nothing is sent in the clear), then connects by itself once
//     the key arrives;
//   - after someone is removed and the server moves to a new key, the call carries on and a newcomer who sends with
//     the new key is heard by those who were already in the call.
// Needs `npm run build`, Playwright's Chromium, RUSHLIGHT_SERVER_DIR (v0.16.0 or later) and a LiveKit server binary
// (LIVEKIT_SERVER_BIN, e.g. built from github.com/livekit/livekit). Not part of `npm test`.
// Run: node scripts/e2ee-voice-check.mjs [outDir]
// With E2EE_ELECTRON=1 (and a display, e.g. `xvfb-run -a env E2EE_ELECTRON=1 node scripts/e2ee-voice-check.mjs`) Mia is the
// real Electron app opened from the built files, as an installed copy is, instead of a Chromium page: this is what proves
// the encryption worker loads outside a web address.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { setup, root, findPlaywright } from './ui-shots/lib.mjs'

const BIN = process.env.LIVEKIT_SERVER_BIN || '/tmp/lk/bin/livekit-server'
const freePort = () =>
  new Promise((ok, bad) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => ok(port))
    })
    s.on('error', bad)
  })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const tmp = mkdtempSync(join(tmpdir(), 'e2ee-voice-'))
const httpPort = await freePort()
const tcpPort = await freePort()
const udpStart = 50000 + Math.floor(Math.random() * 8000)
writeFileSync(
  join(tmp, 'livekit.yaml'),
  `port: ${httpPort}
bind_addresses: ["127.0.0.1"]
rtc:
  tcp_port: ${tcpPort}
  port_range_start: ${udpStart}
  port_range_end: ${udpStart + 300}
  use_external_ip: false
  node_ip: 127.0.0.1
keys:
  shotskey: shots-secret-shots-secret-shots-secret-2
logging:
  level: warn
`
)
const lk = spawn(BIN, ['--config', join(tmp, 'livekit.yaml')], { stdio: ['ignore', 'pipe', 'pipe'] })
let lkLog = ''
lk.stdout.on('data', (d) => (lkLog += d))
lk.stderr.on('data', (d) => (lkLog += d))
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${httpPort}`)).ok) break
  } catch {
    // not up yet
  }
  await sleep(100)
}

// The fake microphones all play the same loud tone (a 440 Hz sine, two seconds, looped), so what is measured is whether
// the audio got through, not how loud a fake device happens to be.
function writeTone(path, seconds = 2, rate = 48000) {
  const n = seconds * rate
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 0.5 * 32767), i * 2)
  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(1, 22)
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36)
  head.writeUInt32LE(data.length, 40)
  writeFileSync(path, Buffer.concat([head, data]))
}
const TONE = join(tmp, 'tone.wav')
writeTone(TONE)
const FAKE_MIC = [`--use-file-for-fake-audio-capture=${TONE}`, '--disable-features=WebRtcHideLocalIpsWithMdns']

const outDir = process.argv[2] || join(tmp, 'shots')
const h = await setup({
  outDir,
  seedWorld: false,
  worldEnv: { LIVEKIT_URL: `ws://127.0.0.1:${httpPort}`, NODE_OPTIONS: '' }, // no frozen clock: LiveKit checks tokens against the real one
  fakeMedia: true,
  chromiumArgs: FAKE_MIC
})
const w = h.world
const INIT = `
  try { localStorage.setItem('rushlight-mic-mode', 'open') } catch {}
  window.__pcs = []
  const Orig = window.RTCPeerConnection
  window.RTCPeerConnection = function (...a) { const pc = new Orig(...a); window.__pcs.push(pc); return pc }
  window.RTCPeerConnection.prototype = Orig.prototype
`
// the energy on each incoming audio stream, to see which ones carry sound
const inbound = (page) =>
  page.evaluate(async () => {
    const out = []
    for (const pc of window.__pcs) {
      if (pc.connectionState === 'closed') continue
      const stats = await pc.getStats()
      stats.forEach((r) => {
        if (r.type === 'inbound-rtp' && r.kind === 'audio') out.push({ id: r.id, energy: r.totalAudioEnergy || 0, packets: r.packetsReceived || 0 })
      })
    }
    return out
  })
// what a page is sending, and the level of its microphone: tells a quiet microphone from a broken call
const outbound = (page) =>
  page.evaluate(async () => {
    const out = []
    for (const pc of window.__pcs) {
      if (pc.connectionState === 'closed') continue
      const stats = await pc.getStats()
      stats.forEach((r) => {
        if (r.type === 'outbound-rtp' && r.kind === 'audio') out.push({ packets: r.packetsSent, bytes: r.bytesSent })
        if (r.type === 'media-source' && r.kind === 'audio') out.push({ micEnergy: r.totalAudioEnergy, level: r.audioLevel })
      })
    }
    return out
  })
// how many incoming audio streams grew in energy over a few seconds
async function growing(page, ms = 3500) {
  const a = await inbound(page)
  await sleep(ms)
  const b = await inbound(page)
  const before = new Map(a.map((r) => [r.id, r.energy]))
  return b.filter((r) => r.energy > (before.get(r.id) ?? 0) + 0.0005).length
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
let electronApp = null
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
  await w.call('POST', '/api/servers/join', { code: code.code }, dad.token)
  await w.call('POST', `/api/servers/${server.id}/channels`, { name: 'Lounge', mode: 'voice', persistent: true }, owner.token)
  {
    const Database = createRequire(join(w.dir, 'package.json'))('better-sqlite3')
    const db = new Database(w.dbPath)
    db.prepare('UPDATE servers SET e2ee_enabled = 1 WHERE id = ?').run(server.id)
    db.close()
  }

  // Mia as the real Electron app: the built app opened from its files, with a test config and a copy of package.json that
  // carries a real version (the repository's says 0.1.0; releases take theirs from the tag).
  async function openInElectron(account, name) {
    const { _electron } = findPlaywright()
    const appDir = join(tmp, 'electron-app')
    const userData = join(tmp, 'electron-user')
    mkdirSync(appDir, { recursive: true })
    mkdirSync(userData, { recursive: true })
    writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'rushlight', version: '0.25.0', main: join(root, 'out', 'main', 'index.js') }))
    writeFileSync(join(userData, 'server-config.json'), JSON.stringify({ serverUrl: w.url }))
    electronApp = await _electron.launch({
      executablePath: join(root, 'node_modules', 'electron', 'dist', 'electron'),
      args: [appDir, '--no-sandbox', `--user-data-dir=${userData}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', ...FAKE_MIC]
    })
    const page = await electronApp.firstWindow()
    await electronApp.context().addInitScript(INIT)
    page.on('console', (m) => m.type() === 'error' && h.log.push(`[electron console] ${m.text().slice(0, 200)}`))
    page.on('pageerror', (e) => h.log.push(`[electron pageerror] ${e.message}`))
    await page.waitForLoadState('domcontentloaded')
    await page.evaluate((t) => localStorage.setItem('rushlight-session', t), account.token)
    await page.reload()
    console.log('  Mia is the real Electron app, version', await page.evaluate(() => window.api.getVersion()))
    return (pages[name] = page)
  }
  const open = (account, name) =>
    name === 'mia' && process.env.E2EE_ELECTRON ? openInElectron(account, name) :
    h.newPage({ session: account.token, width: 1100, height: 700, fixedClock: false, version: '0.25.0', init: INIT }).then((p) => (pages[name] = p))
  const enterServer = async (page) => {
    await page.click('.rail-btn[title="Sealed"]')
    await page.waitForSelector('.channel-row:has-text("Lounge")')
  }
  const joinLounge = (page) => page.click('.channel-row:has-text("Lounge")')
  const connected = (page, what) => until(async () => (await page.$('.voice-status.connected')) !== null, what)

  // 1. Olive makes the first key and joins; Mia gets it and joins; they hear each other
  const olive = await open(owner, 'olive')
  await enterServer(olive)
  await sleep(1500) // the first key is made as the server opens
  await joinLounge(olive)
  await connected(olive, 'Olive in the call')
  const miaPage = await open(mia, 'mia')
  await enterServer(miaPage)
  await joinLounge(miaPage) // may have to wait a few seconds for the key to be handed over, then connects by itself
  await connected(miaPage, 'Mia in the call (the key handed over, then the call started)')
  assert.ok(await olive.$('.voice-encrypted'), 'the room is marked encrypted')
  assert.ok(await miaPage.$('.voice-encrypted'), 'the room is marked encrypted for Mia too')
  await until(async () => (await inbound(olive)).length >= 1 && (await inbound(miaPage)).length >= 1, 'incoming audio streams')
  {
    const n = await growing(olive)
    if (n !== 1) console.error('diagnostic: Mia sends', JSON.stringify(await outbound(miaPage)), '| Olive receives', JSON.stringify(await inbound(olive)))
    assert.equal(n, 1, 'Olive hears Mia')
  }
  assert.equal(await growing(miaPage), 1, 'Mia hears Olive')
  await h.shot(olive, 'voice-encrypted-call')

  // 2. a member whose key is wrong hears nobody and is heard by nobody
  const dadPage = await open(dad, 'dad')
  await enterServer(dadPage)
  await sleep(6000) // let the key reach Dad's computer
  await dadPage.evaluate(async () => {
    const db = await new Promise((ok, bad) => {
      const r = indexedDB.open('rushlight-e2ee', 1)
      r.onsuccess = () => ok(r.result)
      r.onerror = () => bad(r.error)
    })
    const store = db.transaction('serverKeys', 'readwrite').objectStore('serverKeys')
    const keys = await new Promise((ok) => (store.getAllKeys().onsuccess = (e) => ok(e.target.result)))
    for (const k of keys) store.put(crypto.getRandomValues(new Uint8Array(32)), k)
    await new Promise((ok) => (store.transaction.oncomplete = ok))
  })
  await dadPage.reload() // starts afresh, reading the (now wrong) key from disk
  await enterServer(dadPage)
  await joinLounge(dadPage)
  await connected(dadPage, 'Dad (wrong key) connected')
  await until(async () => (await inbound(dadPage)).length >= 2 && (await inbound(olive)).length >= 2, 'Dad in the room')
  assert.equal(await growing(dadPage), 0, 'a wrong key hears nobody')
  {
    const a = await inbound(olive)
    const n = await growing(olive)
    if (n !== 1) console.error('diagnostic, Olive inbound before:', JSON.stringify(a), 'after:', JSON.stringify(await inbound(olive)))
    assert.equal(n, 1, 'and Olive still hears only Mia (Dad cannot be opened)')
  }

  // 3. Dad is removed: the server asks for a new key; Olive's window makes it and the call carries on
  await w.call('POST', `/api/servers/${server.id}/members/${dad.id}/kick`, undefined, owner.token)
  await until(() => rows('SELECT e2ee_epoch AS e FROM servers WHERE id = ?', server.id)[0].e === 2, 'the second key', 30000)
  // across the whole switch (about ten seconds) the call must stay audible: sample Mia's incoming audio the whole time
  for (let i = 0; i < 4; i++) assert.equal(await growing(miaPage, 3000), 1, 'during the switch to the new key Mia still hears Olive')

  // 4. a newcomer arrives with no key: the call does not start (nothing in the clear), then starts by itself.
  //    Olive's and Mia's windows are stopped from handing the key over until the newcomer has been seen waiting.
  const hold = (page) => page.route((u) => /\/key-envelopes/.test(u.pathname), (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()))
  await hold(olive)
  await hold(miaPage)
  const zed = await reg('Zed')
  await w.call('POST', '/api/servers/join', { code: code.code }, zed.token)
  const zedPage = await open(zed, 'zed')
  await enterServer(zedPage)
  await joinLounge(zedPage)
  const waiting = await until(async () => {
    const t = await zedPage.$eval('.voice-panel', (e) => e.innerText).catch(() => '')
    return /doesn't have the server's key yet/.test(t) ? t : null
  }, 'the no-key notice', 15000)
  assert.ok(waiting)
  await sleep(4000)
  assert.equal(await zedPage.evaluate(() => window.__pcs.length), 0, 'with no key nothing was connected, so nothing was sent in the clear')
  assert.equal((await zedPage.$$('.voice-status.connected')).length, 0)
  await h.shot(zedPage, 'voice-waiting-for-key')
  await olive.unroute(/./).catch(() => {})
  await miaPage.unroute(/./).catch(() => {})
  await olive.unrouteAll({ behavior: 'ignoreErrors' })
  await miaPage.unrouteAll({ behavior: 'ignoreErrors' })
  await connected(zedPage, 'Zed connected by itself once the key arrived')
  // he sends with the newest key: everyone who was in the call must have switched to it to hear him
  await until(async () => (await inbound(olive)).length >= 2 && (await inbound(miaPage)).length >= 2 && (await inbound(zedPage)).length >= 2, 'all streams')
  assert.equal(await growing(zedPage), 2, 'Zed hears Olive and Mia')
  assert.equal(await growing(olive), 2, 'Olive hears Mia and Zed (so Olive moved to the new key)')
  assert.equal(await growing(miaPage), 2, 'Mia hears Olive and Zed')

  // 5. invites that carry keys, through the real screens. Olive makes a guest invite for Lounge in Admin Tools.
  const inviteViaUi = async (page, optionLabel, shotName = null) => {
    await page.click('.admin-tools-btn')
    await page.click('.rl-nav-item:has-text("Join codes")')
    if (optionLabel) await page.selectOption('select[aria-label="What the code covers"]', { label: optionLabel })
    await page.click('button:has-text("Generate join code")')
    const text = await until(async () => page.$eval('.code-box code', (e) => e.textContent).catch(() => null), 'the new invite')
    if (shotName) await h.shot(page, shotName)
    await page.keyboard.press('Escape')
    await page.waitForSelector('.channel-row:has-text("Lounge")')
    return text.trim()
  }
  const guestInvite = await inviteViaUi(olive, 'Guests only: Lounge (and its rooms)', 'admin-invite-encrypted')
  assert.match(guestInvite, /^[a-z]+-[a-z]+-\d{4}\.(\w{5}-){4}\w{5}$/, 'the invite shown is the code, a dot and the secret half')
  const visibleOnly = guestInvite.split('.')[0]
  const guestPage = async (name, invite) => {
    const p = await h.newPage({ width: 1100, height: 700, fixedClock: false, version: '0.26.0', init: INIT })
    pages[name] = p
    await p.fill('#auth-join', invite)
    await p.click('.auth-joinrow button')
    await p.fill('#auth-screen-name', name)
    await p.click('button:has-text("Continue")')
    return p
  }
  // the visible half alone is refused, and says why
  const bare = await guestPage('Bare', visibleOnly)
  const refusal = await until(async () => bare.$eval('.auth-error', (e) => e.textContent).catch(() => null), 'the refusal of a code without its second half', 10000)
  assert.match(refusal, /whole invite, including the part after the dot/)
  assert.equal((await bare.$$('.channel-row')).length, 0, 'nothing opened')
  await bare.close()

  // a mistyped secret half is refused too, and neither attempt used the single-use invite up
  const last = guestInvite.slice(-1)
  const typo = await guestPage('Typo', guestInvite.slice(0, -1) + (last === 'A' ? 'B' : 'A'))
  const typoRefusal = await until(async () => typo.$eval('.auth-error', (e) => e.textContent).catch(() => null), 'the refusal of a mistyped second half', 10000)
  assert.match(typoRefusal, /second half of that invite isn't right/)
  await typo.close()
  assert.equal(rows('SELECT used FROM join_codes WHERE code = ?', visibleOnly)[0].used, 0, 'the invite was not spent by the refused attempts')

  // the whole invite brings a guest into the encrypted call
  const gus = await guestPage('Gus', guestInvite)
  await gus.waitForSelector('.channel-row:has-text("Lounge")')
  await gus.click('.channel-row:has-text("Lounge")')
  await connected(gus, 'Gus (a guest) in the encrypted call')
  assert.ok(await gus.$('.voice-encrypted'), 'the guest sees that the room is encrypted')
  await until(async () => (await inbound(gus)).length >= 3 && (await inbound(olive)).length >= 3, 'the guest in the room')
  assert.equal(await growing(gus), 3, 'Gus hears Olive, Mia and Zed')
  assert.equal(await growing(olive), 3, 'and Olive hears Mia, Zed and Gus')
  await h.shot(gus, 'voice-guest-encrypted')

  // 6. the guest follows a key change: Zed is removed, a new key starts, the invite is brought up to it, and a newcomer
  //    who sends with the new key is heard by the guest
  await w.call('POST', `/api/servers/${server.id}/members/${zed.id}/kick`, undefined, owner.token)
  await until(() => rows('SELECT e2ee_epoch AS e FROM servers WHERE id = ?', server.id)[0].e === 3, 'the third key', 40000)
  await until(() => rows('SELECT key_epoch AS e FROM join_codes WHERE key_package IS NOT NULL ORDER BY id DESC LIMIT 1')[0].e === 3, "the guest's invite brought up to the third key", 40000)
  const yan = await reg('Yan')
  await w.call('POST', '/api/servers/join', { code: code.code }, yan.token)
  const yanPage = await open(yan, 'yan')
  await enterServer(yanPage)
  await joinLounge(yanPage)
  await connected(yanPage, 'Yan connected on the third key')
  // the switch to the new key takes about ten seconds in the call; then the guest hears all three (and Zed, gone, is silent)
  await until(async () => (await growing(gus, 2500)) === 3, 'the guest, on the new key, hearing Olive, Mia and Yan', 60000)
  await until(async () => (await growing(olive, 2500)) === 3, 'Olive hearing Mia, Yan and Gus', 60000)

  // 7. a new member who joins with an invite connects at once: the keys came in it, so they never wait for another member
  const memberInvite = await inviteViaUi(olive, null)
  const nia = await reg('Nia')
  const niaPage = await open(nia, 'nia')
  await niaPage.click('.rail-add')
  await niaPage.fill('#server-code-input', memberInvite)
  await niaPage.click('button:has-text("Join server")')
  await niaPage.waitForSelector('.channel-row:has-text("Lounge")')
  await niaPage.click('.channel-row:has-text("Lounge")')
  let waited = false
  await until(async () => {
    const t = await niaPage.$eval('.voice-panel', (e) => e.innerText).catch(() => '')
    if (/doesn't have the server's key yet/.test(t)) waited = true
    return (await niaPage.$('.voice-status.connected')) !== null
  }, 'Nia connected with the keys from her invite', 20000)
  assert.equal(waited, false, 'a member who joins with an invite never waits for the key')
  await until(async () => (await inbound(niaPage)).length >= 3, 'streams for Nia')
  assert.ok((await growing(niaPage)) >= 3, 'Nia hears the room')

  // Dad's wrong key is the only reason for "InvalidKey". "MissingKey" would mean someone sent with a key another could not
  // yet open: the moment of switching to the new key must not cost anyone's audio.
  const missing = h.log.filter((l) => /MissingKey/.test(l))
  assert.deepEqual(missing, [], 'nobody was ever sent audio with a key they did not yet have:\n' + missing.slice(0, 3).join('\n'))
  const bad = h.log.filter((l) => !/Failed to load resource|401|403|426|409|InvalidKey|Failed to fetch|User-Initiated Abort|closed unexpectedly/.test(l)) // (Failed to fetch: the key hand-over this script blocks on purpose; the aborts are a kicked person's connection being closed)
  assert.deepEqual(bad, [], 'no unexpected console errors:\n' + bad.join('\n'))
  console.log('encrypted calls with a real LiveKit server: ok')
} catch (err) {
  failed = true
  console.error('encrypted voice check: FAILED\n', err)
  for (const [who, page] of Object.entries(pages)) console.error(`--- ${who}:`, await page.$eval('.voice-panel', (e) => e.innerText.replace(/\n+/g, ' | ')).catch(async () => '(no voice panel) page says: ' + (await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').slice(0, 300)).catch(() => '?'))))
  console.error(h.log.join('\n'))
  console.error('--- livekit:\n' + lkLog.slice(-1500))
} finally {
  if (electronApp) await electronApp.close().catch(() => {})
  await h.close()
  lk.kill()
  rmSync(tmp, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
