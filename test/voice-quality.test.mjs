// Voice quality: how the voice connection is built (96 kbps, no silence suppression) and the three microphone switches (noise suppression,
// automatic gain, echo cancellation): on by default, remembered, and what they ask the browser for. The live behaviour (the bitrate on the
// wire, a switch changing mid-call without leaving the room) is checked by scripts/voice-quality-check.mjs against a real LiveKit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { AudioPresets } from 'livekit-client'
import { captureConstraints, captureOptions, publishDefaults, roomOptions, SEND_BITRATE } from '../src/renderer/src/voiceOptions.js'

function fakeStorage(initial = {}) {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v)
    },
    removeItem: (k) => {
      delete data[k]
    }
  }
}
let n = 0
async function freshPrefs(storage) {
  globalThis.localStorage = storage
  return import(`../src/renderer/src/voicePrefs.js?run=${++n}`) // a new copy each time, so it reads the storage it is given
}

const ALL_ON = { noiseSuppression: true, autoGainControl: true, echoCancellation: true }

test('voice is sent at 96 kbps with silence suppression off, and redundant packets left as they are', () => {
  const opts = roomOptions({ input: '', output: '', capture: ALL_ON, e2ee: null })
  assert.equal(opts.publishDefaults.audioPreset, AudioPresets.musicHighQuality)
  assert.equal(opts.publishDefaults.audioPreset.maxBitrate, 96000)
  assert.equal(SEND_BITRATE, 96000)
  assert.equal(opts.publishDefaults.dtx, false)
  assert.equal('red' in opts.publishDefaults, false, 'RED is not touched, so LiveKit keeps it on')
  assert.equal(publishDefaults, opts.publishDefaults)
})

test('the connection options keep what they had: adaptive stream, dynacast, the chosen speaker, and encryption when there is one', () => {
  const plain = roomOptions({ input: '', output: 'spk', capture: ALL_ON, e2ee: null })
  assert.equal(plain.adaptiveStream, true)
  assert.equal(plain.dynacast, true)
  assert.deepEqual(plain.audioOutput, { deviceId: 'spk' })
  assert.equal('e2ee' in plain, false)
  const keys = { keyProvider: {}, worker: {} }
  assert.equal(roomOptions({ input: '', output: '', capture: ALL_ON, e2ee: keys }).e2ee, keys)
  assert.equal(roomOptions({ input: '', output: '', capture: ALL_ON, e2ee: null }).audioOutput, undefined)
})

test('the capture options carry the three switches and the chosen microphone', () => {
  const opts = roomOptions({ input: 'mic-1', output: '', capture: { noiseSuppression: false, autoGainControl: true, echoCancellation: false }, e2ee: null })
  assert.deepEqual(opts.audioCaptureDefaults, { deviceId: 'mic-1', noiseSuppression: false, voiceIsolation: false, autoGainControl: true, echoCancellation: false })
  assert.equal('deviceId' in captureOptions(ALL_ON, ''), false, 'no device chosen: the system default')
})

test('voice isolation follows the noise suppression switch, so off is really off', () => {
  assert.equal(captureConstraints({ ...ALL_ON, noiseSuppression: false }).voiceIsolation, false)
  assert.equal(captureConstraints(ALL_ON).voiceIsolation, true)
})

test('all three switches are on by default', async () => {
  const prefs = await freshPrefs(fakeStorage())
  assert.deepEqual(prefs.getSnapshot(), ALL_ON)
})

test('a switch is remembered, on its own, and comes back after a restart', async () => {
  const storage = fakeStorage()
  const prefs = await freshPrefs(storage)
  prefs.setCapturePref('echoCancellation', false)
  assert.equal(storage.getItem('rushlight.mic.echoCancellation'), '0')
  assert.equal(storage.getItem('rushlight.mic.noiseSuppression'), null, 'the others are untouched')
  const again = await freshPrefs(storage)
  assert.deepEqual(again.getSnapshot(), { noiseSuppression: true, autoGainControl: true, echoCancellation: false })
  again.setCapturePref('echoCancellation', true)
  assert.deepEqual((await freshPrefs(storage)).getSnapshot(), ALL_ON)
})

test('a change is announced once, the snapshot is a new object only when something changed, and setting the same value is silent', async () => {
  const prefs = await freshPrefs(fakeStorage())
  const seen = []
  const off = prefs.subscribe((s) => seen.push(s))
  const before = prefs.getSnapshot()
  prefs.setCapturePref('autoGainControl', true) // already on
  assert.equal(prefs.getSnapshot(), before)
  assert.equal(seen.length, 0)
  prefs.setCapturePref('autoGainControl', false)
  assert.equal(seen.length, 1)
  assert.notEqual(prefs.getSnapshot(), before)
  assert.equal(seen[0].autoGainControl, false)
  off()
  prefs.setCapturePref('autoGainControl', true)
  assert.equal(seen.length, 1, 'after unsubscribing nothing is announced')
  assert.throws(() => prefs.setCapturePref('bitrate', false), /Unknown microphone setting/)
})

test('without usable storage the switches still work for this session, all on', async () => {
  const broken = { getItem: () => { throw new Error('no storage') }, setItem: () => { throw new Error('no storage') } }
  const prefs = await freshPrefs(broken)
  assert.deepEqual(prefs.getSnapshot(), ALL_ON)
  prefs.setCapturePref('noiseSuppression', false)
  assert.equal(prefs.getSnapshot().noiseSuppression, false)
})

test('the wiring: the connection is built from roomOptions, a mid-call change captures the track again, and Settings and the mic check use the same switches', () => {
  const read = (p) => readFileSync(new URL(`../src/renderer/src/${p}`, import.meta.url), 'utf8')
  const voice = read('voice.js')
  assert.match(voice, /new Room\(\s*roomOptions\(/)
  assert.match(voice, /track\.restartTrack\(captureOptions\(voicePrefs\.getSnapshot\(\)/)
  assert.match(voice, /voicePrefs\.subscribe\(/)
  // a muted track is never captured again: that would send audio while muted
  assert.match(voice, /captureStale && desiredMic && room && room\.localParticipant\.isMicrophoneEnabled/)
  const settings = read('screens/SettingsScreen.jsx')
  for (const key of ['noiseSuppression', 'autoGainControl', 'echoCancellation']) assert.match(settings, new RegExp(`setCapturePref\\('${key}'`))
  assert.match(settings, /only when you wear headphones/)
  const check = read('components/MicSpeakerCheck.jsx')
  assert.match(check, /captureOptions\(capture\)/)
})
