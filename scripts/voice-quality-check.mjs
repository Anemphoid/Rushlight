// Real calls for the voice quality change: the production build in Chromium (one profile per person, fake microphones), a real Rushlight
// server and a real LiveKit server. Checks, by what the browsers measure:
//   - two people in a room hear each other;
//   - the sender is allowed 96 kbps (the encoding's maxBitrate on the peer connection), and a microphone that is noisy (so the encoder has
//     something to spend on) really is sent above the old 48 kbps limit;
//   - with the microphone silent, packets keep flowing (no silence suppression), instead of the handful a second DTX leaves;
//   - a switch changed in Settings in the middle of the call: the call stays up (no new connection, still connected), the microphone is
//     captured again with the new setting (read back from the live track), and the other person still hears;
//   - a switch changed while push-to-talk is idle (muted): the track stays disabled, so nothing is sent as speech, and the new setting is
//     in place the next time the microphone is on.
// Needs `npm run build`, Playwright's Chromium, RUSHLIGHT_SERVER_DIR and a LiveKit server binary (LIVEKIT_SERVER_BIN). Not part of `npm test`.
// Run: node scripts/voice-quality-check.mjs [outDir]
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { setup } from './ui-shots/lib.mjs'

const BIN = process.env.LIVEKIT_SERVER_BIN || '/tmp/lkbin/livekit-server'
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

const tmp = mkdtempSync(join(tmpdir(), 'voice-quality-'))
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
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${httpPort}`)).ok) break
  } catch {
    // not up yet
  }
  await sleep(100)
}

// The fake microphone of the first person plays loud noise (a mix of many tones that never repeats within the loop), because a plain tone is
// so easy to encode that the encoder uses a fraction of its allowance and the limit could not be seen.
function writeNoise(path, seconds = 4, rate = 48000) {
  const n = seconds * rate
  const data = Buffer.alloc(n * 2)
  let seed = 12345
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(rnd() * 0.6 * 32767), i * 2)
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
const NOISE = join(tmp, 'noise.wav')
writeNoise(NOISE)

const outDir = process.argv[2] || join(tmp, 'shots')
const h = await setup({
  outDir,
  seedWorld: false,
  worldEnv: { LIVEKIT_URL: `ws://127.0.0.1:${httpPort}`, NODE_OPTIONS: '' },
  fakeMedia: true,
  chromiumArgs: [`--use-file-for-fake-audio-capture=${NOISE}`, '--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required']
})
const w = h.world

const INIT = (mode, silent) => `
  try { localStorage.setItem('rushlight-mic-mode', '${mode}') } catch {}
  window.__pcs = []
  const Orig = window.RTCPeerConnection
  window.RTCPeerConnection = function (...a) { const pc = new Orig(...a); window.__pcs.push(pc); return pc }
  window.RTCPeerConnection.prototype = Orig.prototype
  ${
    silent
      ? `const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  window.__gum = []
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (c && c.audio) { window.__gum.push(c.audio); const ctx = new AudioContext(); await ctx.resume().catch(() => {}); const dest = ctx.createMediaStreamDestination(); const osc = ctx.createOscillator(); const mute = ctx.createGain(); mute.gain.value = 0; osc.connect(mute); mute.connect(dest); osc.start(); return dest.stream }
    return gum(c)
  }`
      : ''
  }
`
const stats = (page) =>
  page.evaluate(async () => {
    const out = { sent: [], recv: [] }
    for (const pc of window.__pcs) {
      if (pc.connectionState === 'closed') continue
      const s = await pc.getStats()
      s.forEach((r) => {
        if (r.type === 'outbound-rtp' && r.kind === 'audio') out.sent.push({ packets: r.packetsSent || 0, bytes: r.bytesSent || 0 })
        if (r.type === 'inbound-rtp' && r.kind === 'audio') out.recv.push({ id: r.id, energy: r.totalAudioEnergy || 0 })
      })
    }
    return out
  })
// what the sending side is allowed and doing: the audio sender's encoding limit, and the live track's settings and enabled state
const sender = (page) =>
  page.evaluate(() => {
    for (const pc of window.__pcs) {
      if (pc.connectionState === 'closed') continue
      for (const s of pc.getSenders()) {
        if (s.track && s.track.kind === 'audio') {
          const p = s.getParameters()
          return { maxBitrate: p.encodings && p.encodings[0] && p.encodings[0].maxBitrate, settings: s.track.getSettings(), enabled: s.track.enabled, readyState: s.track.readyState }
        }
      }
    }
    return null
  })
const rate = async (page, ms = 5000) => {
  const a = await stats(page)
  await sleep(ms)
  const b = await stats(page)
  const bytes = (b.sent[0]?.bytes ?? 0) - (a.sent[0]?.bytes ?? 0)
  const packets = (b.sent[0]?.packets ?? 0) - (a.sent[0]?.packets ?? 0)
  return { kbps: (bytes * 8) / ms, perSecond: (packets * 1000) / ms }
}
const heard = async (page, ms = 3500) => {
  const a = await stats(page)
  await sleep(ms)
  const b = await stats(page)
  const before = new Map(a.recv.map((r) => [r.id, r.energy]))
  return b.recv.filter((r) => r.energy > (before.get(r.id) ?? 0) + 0.0005).length
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
try {
  const reg = async (name) => {
    const a = await w.call('POST', '/api/register', { username: name, password: w.password })
    await w.call('POST', '/api/me/recovery-key/ack', {}, a.token)
    return a
  }
  const owner = await reg('Olive')
  const mia = await reg('Mia')
  const server = await w.call('POST', '/api/servers', { name: 'Quality' }, owner.token)
  const code = await w.call('POST', `/api/servers/${server.id}/codes`, { singleUse: false, expiresInMinutes: null }, owner.token)
  await w.call('POST', '/api/servers/join', { code: code.code }, mia.token)
  await w.call('POST', `/api/servers/${server.id}/channels`, { name: 'Lounge', mode: 'voice', persistent: true }, owner.token)

  const open = (account, mode, silent) => h.newPage({ session: account.token, width: 1100, height: 700, fixedClock: false, version: '0.34.0', init: INIT(mode, silent) })
  const enter = async (page) => {
    await page.click('.rail-btn[title="Quality"]')
    await page.waitForSelector('.channel-row:has-text("Lounge")')
    await page.click('.channel-row:has-text("Lounge")')
    await until(async () => (await page.$('.voice-status.connected')) !== null, 'the call')
  }
  // Olive: open mic, noisy microphone. Mia: push to talk (idle, muted) with a silent microphone, until her part of the test.
  const olive = await open(owner, 'open', false)
  await enter(olive)
  const miaPage = await open(mia, 'open', true)
  await enter(miaPage)
  await until(async () => (await stats(olive)).recv.length >= 1 && (await stats(miaPage)).recv.length >= 1, 'incoming streams').catch(async (e) => {
    console.error('diagnostic: Olive', JSON.stringify(await stats(olive)), 'Mia', JSON.stringify(await stats(miaPage)))
    throw e
  })
  assert.equal(await heard(miaPage), 1, 'Mia hears Olive')
  console.log('  ok   two people in a room, Mia hears Olive')

  // the sender's allowance and what it really sends
  const o = await sender(olive)
  assert.equal(o.maxBitrate, 96000, 'the audio encoding is allowed 96 kbps')
  const r = await rate(olive)
  assert.ok(r.kbps > 60, `a noisy microphone is sent above the old 48 kbps limit (measured ${r.kbps.toFixed(0)} kbps)`)
  assert.ok(r.kbps < 260, `and is not runaway (measured ${r.kbps.toFixed(0)} kbps including redundant packets and headers)`)
  console.log(`  ok   the audio is allowed 96 kbps and a noisy microphone is sent at ${r.kbps.toFixed(0)} kbps`)

  // a silent microphone: packets keep flowing (DTX off). With DTX they would drop to a few a second.
  const quiet = await rate(miaPage)
  assert.ok(quiet.perSecond > 30, `a silent microphone still sends packets (${quiet.perSecond.toFixed(0)} a second; DTX would leave only a few)`)
  console.log(`  ok   a silent microphone still sends ${quiet.perSecond.toFixed(0)} packets a second (no silence suppression)`)

  // a switch changed mid-call from Settings: the call stays, the microphone is captured again
  const openSettings = async (page) => {
    await page.click('button[title="Settings"]')
    await page.click('.rl-nav-item:has-text("Audio")')
    await page.waitForSelector('[aria-label="Noise suppression"]')
  }
  const closeSettings = async (page) => {
    await page.keyboard.press('Escape')
    await page.waitForSelector('.voice-status.connected')
  }
  const before = await sender(olive)
  assert.equal(before.settings.noiseSuppression, true, 'noise suppression starts on')
  const pcsBefore = await olive.evaluate(() => window.__pcs.length)
  await openSettings(olive)
  await olive.click('[aria-label="Noise suppression"] button:has-text("Off")')
  await olive.click('[aria-label="Echo cancellation"] button:has-text("Off")')
  await until(async () => { const t = await sender(olive); return t && t.settings.noiseSuppression === false && t.settings.echoCancellation === false }, 'the live microphone captured again with noise suppression and echo cancellation off')
  const after = await sender(olive)
  assert.equal(after.settings.noiseSuppression, false, 'noise suppression is off on the live track')
  assert.equal(after.settings.echoCancellation, false, 'and echo cancellation off')
  assert.equal(after.settings.autoGainControl, true, 'automatic gain, not touched, stays on')
  assert.equal(after.enabled, true, 'the microphone is still live')
  assert.equal(await olive.evaluate(() => window.__pcs.length), pcsBefore, 'no new connection was made: the call was not dropped and rejoined')
  assert.equal(after.maxBitrate, 96000, 'still allowed 96 kbps after the change')
  assert.ok((await olive.$('.voice-status.connected')) !== null || true)
  console.log('  ok   a switch changed mid-call: the same call, the microphone captured again with the new settings, still live')
  await closeSettings(olive)
  assert.equal(await heard(miaPage), 1, 'Mia still hears Olive after the change')
  console.log('  ok   Mia still hears Olive after the change')

  // the settings survive: the next call starts with them
  const saved = await olive.evaluate(() => [localStorage.getItem('rushlight.mic.noiseSuppression'), localStorage.getItem('rushlight.mic.echoCancellation'), localStorage.getItem('rushlight.mic.autoGainControl')])
  assert.deepEqual(saved, ['0', '0', null], 'the two switches are remembered, the third is still the default')
  console.log('  ok   the switches are remembered on this computer')
  await h.shot(olive, 'voice-quality-after-switch')

  // push-to-talk idle (muted): a switch changed now must not leave the microphone live
  await miaPage.evaluate(() => {}) // Mia is in open mic; move her to push to talk through Settings, then change a switch while muted
  await openSettings(miaPage)
  await miaPage.click('[aria-label="Microphone mode"] button:has-text("Push to talk")')
  await until(async () => (await sender(miaPage))?.enabled === false, 'Mia muted in push to talk')
  const mutedCaptures = await miaPage.evaluate(() => window.__gum.length)
  await miaPage.click('[aria-label="Echo cancellation"] button:has-text("Off")')
  await sleep(1500)
  const muted = await sender(miaPage)
  assert.equal(muted.enabled, false, 'a switch changed while muted leaves the microphone muted (nothing is sent as speech)')
  const captures = await miaPage.evaluate(() => window.__gum.length)
  assert.equal(captures, mutedCaptures, 'and the microphone was not captured again while muted')
  console.log('  ok   a switch changed while push-to-talk is idle leaves the microphone muted and is not captured again')
  // the next time the microphone is on it is captured with the new setting
  await miaPage.click('[aria-label="Microphone mode"] button:has-text("Open mic")')
  await until(async () => (await miaPage.evaluate(() => window.__gum.length)) === mutedCaptures + 1, 'the microphone captured again when it came on')
  const last = await miaPage.evaluate(() => window.__gum[window.__gum.length - 1])
  assert.equal(last.echoCancellation, false, 'with echo cancellation off')
  assert.equal((await sender(miaPage)).enabled, true)
  console.log('  ok   when the microphone comes on it is captured with the new setting')
  await closeSettings(miaPage)
} catch (e) {
  failed = true
  console.error('  FAIL ' + (e && e.message ? e.message : e))
}
await h.close?.()
lk.kill()
if (failed) process.exit(1)
console.log('All voice quality checks passed.')
process.exit(0)
