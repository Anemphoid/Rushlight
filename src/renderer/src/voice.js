// The voice connection. One LiveKit room at a time, kept outside React on
// purpose: opening Settings or Profile unmounts the tree screen, and that must
// not drop you out of a call. Components read it through subscribe/getSnapshot.
//
// The mic and PTT behavior is ported from the Alpha 1 client, which worked on
// real hardware: PTT mode starts muted and unmutes only while the key is held,
// open mic stays live, and the mode survives room switches.
import { Room, RoomEvent, Track, DisconnectReason, isE2EESupported } from 'livekit-client'
// LiveKit's own worker for encrypting and decrypting audio frames. Inlined (made from a blob) so it loads the same
// from a file in the packaged app as from a web address.
import E2EEWorker from 'livekit-client/e2ee-worker?worker&inline'
import { VoiceKeyProvider } from './e2ee/voiceKeys'
import { playSound } from './sounds'
import { applyTrackVolume, attachRemoteAudio } from './audioOutput'

const PREF = {
  mode: 'rushlight-mic-mode',
  volume: 'rushlight-output-volume',
  input: 'rushlight-mic-device',
  output: 'rushlight-speaker-device',
  gain: 'rushlight-mic-gain',
  userVolumes: 'rushlight-user-volumes'
}

function readPref(key, fallback) {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : value
  } catch {
    return fallback
  }
}

function writePref(key, value) {
  try {
    if (value === null || value === '') localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // storage unavailable — the choice just won't persist
  }
}

const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.8)

let room = null
let joinSeq = 0 // bumped by every join/leave so a slow, superseded connect can tell it lost
let desiredMic = false
let applyingMic = false
let pttHeld = false
let outputVolume = clamp01(Number(readPref(PREF.volume, '0.8')))
const MAX_GAIN = 2 // slider runs 0-200%; 100% is the untouched mic
const clampGain = (n) => (Number.isFinite(n) ? Math.min(MAX_GAIN, Math.max(0, n)) : 1)
let inputGain = clampGain(Number(readPref(PREF.gain, '1')))
let gainNode = null // the live GainNode, once the processor below is attached
let gainFailed = false // processing broke once; stay on the raw mic from then on
let wantMic = false // what the mic mode asks for, before mute/deafen are applied
let pingTimer = null
// Per-person volume multipliers (0-1 of the output volume), kept by display name
// so they carry over between rooms and sessions.
let userVolumes = {}
try {
  userVolumes = JSON.parse(readPref(PREF.userVolumes, '{}')) || {}
} catch {
  userVolumes = {}
}
let keyProvider = null // the encrypted call's key provider, while in one
let sendingEpoch = 0 // the key epoch this computer's audio is sent with
let switchTimer = null
let e2eeWorker = null
let botTrack = null // Jellybox's audio track while we are subscribed to it, for the visualizer
const remoteAudio = new Map() // subscribed audio track -> speaker's name, so volume changes can reach them
const intentional = new WeakSet() // rooms we disconnected ourselves, vs. dropped on us

let state = {
  status: 'idle', // idle | connecting | connected | reconnecting | error
  error: '',
  key: null, // which space this connection belongs to, e.g. 'room:7'
  micMode: readPref(PREF.mode, 'ptt') === 'open' ? 'open' : 'ptt',
  micOn: false,
  pttHeld: false,
  muted: false, // self-mute: the mic stays off whatever the mic mode says
  deafened: false, // also silences everyone else, and implies muted
  quality: null, // your connection quality: excellent | good | poor | lost
  pingMs: null,
  participants: [],
  encrypted: false, // this call is end-to-end encrypted
  needsKey: false, // an encrypted call could not start because this computer has no key yet; it retries once one arrives
  jellyboxOpen: false, // an admin has allowed Jellybox in this room, so its voice is not end-to-end encrypted
  roomNote: '', // one line about why this call just reconnected (Jellybox allowed or stopped)
  e2eeProblem: '', // set when someone's audio could not be opened (their key and ours differ)
  botAudioId: null // changes when Jellybox's audio track arrives or goes, so the visualizer can re-tap it
}

const listeners = new Set()

function update(patch) {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

// The raw MediaStreamTrack of Jellybox, or null. The visualizer only reads it (a Web Audio analyser that
// is never connected to the speakers), so nothing is heard twice and it shows what this person is sent.
export function getBotMediaTrack() {
  return botTrack ? botTrack.mediaStreamTrack || null : null
}

function clearBotTrack() {
  if (botTrack) {
    botTrack = null
    update({ botAudioId: null })
  }
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSnapshot() {
  return state
}

function refreshParticipants() {
  if (!room) {
    update({ participants: [] })
    return
  }
  const everyone = [room.localParticipant, ...room.remoteParticipants.values()]
  update({
    participants: everyone.map((p) => ({
      identity: p.identity,
      name: p.name || p.identity,
      isLocal: p.isLocal,
      isSpeaking: p.isSpeaking,
      isMuted: !p.isMicrophoneEnabled,
      encrypted: p.isEncrypted
    }))
  })
}

function micErrorText(err) {
  if (err && err.name === 'NotAllowedError') return 'Microphone permission was denied.'
  if (err && err.name === 'NotFoundError') return 'No microphone was found.'
  return 'Microphone problem: ' + (err && err.message ? err.message : String(err))
}

function connectErrorText(err) {
  const message = err && err.message ? err.message : String(err)
  return `Couldn't connect to voice: ${message}`
}

// The mic is driven by a desired state instead of one call per key event. A
// very fast tap can release the key before the first unmute has finished
// setting up, and firing the calls independently could leave the mic stuck open.
async function applyMic() {
  if (applyingMic) return
  applyingMic = true
  const target = desiredMic
  try {
    for (let i = 0; i < 4 && room && room.localParticipant.isMicrophoneEnabled !== desiredMic; i++) {
      await room.localParticipant.setMicrophoneEnabled(desiredMic)
    }
    // A mic problem is only news until the mic works again.
    if (desiredMic && room && room.localParticipant.isMicrophoneEnabled && state.error) {
      update({ error: '' })
    }
  } catch (err) {
    update({ error: micErrorText(err) })
  } finally {
    applyingMic = false
    update({ micOn: !!room && room.localParticipant.isMicrophoneEnabled })
    refreshParticipants()
    if (desiredMic !== target) applyMic() // the key changed while we were busy
  }
}

const micBlocked = () => state.muted || state.deafened

function setMic(on) {
  wantMic = on
  desiredMic = on && !micBlocked()
  applyMic()
}

function applyVolume(track, name) {
  applyTrackVolume(track, outputVolume * userVolume(name), state.deafened)
}

function applyAllVolumes() {
  remoteAudio.forEach((name, track) => applyVolume(track, name))
}

function stopPing() {
  if (pingTimer) clearInterval(pingTimer)
  pingTimer = null
}

// Round-trip time to the voice server, read from the WebRTC connection's own
// stats. Best effort: it uses LiveKit internals, so any failure just means no number.
async function measurePing(r) {
  try {
    const mgr = /** @type {any} */ (r.engine).pcManager
    for (const transport of [mgr && mgr.publisher, mgr && mgr.subscriber]) {
      const stats = transport && (await transport.getStats())
      if (!stats) continue
      let rtt = null
      stats.forEach((report) => {
        if (
          report.type === 'candidate-pair' &&
          (report.nominated || report.state === 'succeeded') &&
          typeof report.currentRoundTripTime === 'number'
        ) {
          rtt = report.currentRoundTripTime
        }
      })
      if (rtt !== null) {
        if (room === r) update({ pingMs: Math.round(rtt * 1000) })
        return
      }
    }
  } catch {
    // no ping number this time
  }
}

export function toggleMute() {
  pttHeld = false
  update({ muted: !state.muted, pttHeld: false })
  desiredMic = wantMic && !micBlocked()
  if (room) applyMic()
}

export function toggleDeafen() {
  pttHeld = false
  update({ deafened: !state.deafened, pttHeld: false })
  desiredMic = wantMic && !micBlocked()
  if (room) applyMic()
  applyAllVolumes()
}

export function getUserVolume(name) {
  return userVolume(name)
}

export function setUserVolume(name, volume) {
  const v = clamp01(volume)
  if (v === 1) delete userVolumes[name]
  else userVolumes[name] = v
  writePref(PREF.userVolumes, Object.keys(userVolumes).length ? JSON.stringify(userVolumes) : '')
  remoteAudio.forEach((n, track) => {
    if (n === name) applyVolume(track, n)
  })
  update({}) // let anything showing this volume redraw
}

function userVolume(name) {
  return name in userVolumes ? clamp01(userVolumes[name]) : 1
}

// Mic input gain is a Web Audio GainNode between the mic and LiveKit, attached
// as a track processor. It is only attached once gain is moved off 100%, so the
// default mic path is exactly what it was before this existed, and if attaching
// ever fails the raw mic keeps working.
const gainProcessor = {
  name: 'rushlight-input-gain',
  processedTrack: undefined,
  nodes: null,
  async build(opts) {
    this.teardownNodes()
    const ctx = opts.audioContext
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
    const source = ctx.createMediaStreamSource(new MediaStream([opts.track]))
    const node = ctx.createGain()
    node.gain.value = inputGain
    const dest = ctx.createMediaStreamDestination()
    source.connect(node)
    node.connect(dest)
    this.nodes = [source, node, dest]
    gainNode = node
    this.processedTrack = dest.stream.getAudioTracks()[0]
  },
  teardownNodes() {
    if (this.nodes) this.nodes.forEach((n) => n.disconnect())
    this.nodes = null
    gainNode = null
  },
  async init(opts) {
    await this.build(opts)
  },
  async restart(opts) {
    await this.build(opts)
  },
  async destroy() {
    this.teardownNodes()
    this.processedTrack = undefined
  }
}

async function ensureGainProcessor() {
  if (!room || gainFailed || gainNode || inputGain === 1) return
  const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone)
  const track = pub && pub.audioTrack
  if (!track) return
  try {
    await track.setProcessor(/** @type {any} */ (gainProcessor))
  } catch (err) {
    gainFailed = true
    gainNode = null
    console.warn('Mic gain unavailable, using the raw mic:', err)
  }
}

async function teardown() {
  const old = room
  room = null
  remoteAudio.clear()
  clearBotTrack()
  gainNode = null
  stopPing()
  wantMic = false
  desiredMic = false
  pttHeld = false
  if (old) {
    intentional.add(old)
    try {
      await old.disconnect()
    } catch {
      // already gone
    }
  }
  keyProvider = null
  sendingEpoch = 0
  if (switchTimer) clearTimeout(switchTimer)
  switchTimer = null
  if (e2eeWorker) {
    e2eeWorker.terminate() // LiveKit does not stop a worker it was handed
    e2eeWorker = null
  }
  document.querySelectorAll('audio[data-lk-audio]').forEach((el) => el.remove())
}

export async function leave() {
  joinSeq++
  const wasActive = room !== null || state.status !== 'idle'
  await teardown()
  if (wasActive) {
    update({
      status: 'idle',
      error: '',
      key: null,
      micOn: false,
      pttHeld: false,
      quality: null,
      pingMs: null,
      participants: [],
      encrypted: false,
      jellyboxOpen: false,
      roomNote: '',
      e2eeProblem: ''
    })
  }
}

// How long to keep sending with the old key after a new one arrives. Everyone learns of a new epoch within one check
// of the server (5 s), so by then every computer in the call can open audio sent with it.
const KEY_SWITCH_DELAY_MS = 7000

// A new key epoch arrived while in an encrypted call (someone was removed). It is loaded straight away, so audio sent with
// it can be opened, but this computer keeps sending with the old key for a few seconds before switching: people who
// have not picked the new key up yet can still hear it, and they are still heard. The older keys stay loaded.
export async function setVoiceKeys(keys) {
  if (!keyProvider || !keys || keys.length === 0) return
  const provider = keyProvider
  const newest = keys[keys.length - 1]
  if (newest.epoch <= sendingEpoch) {
    await provider.setEpochKeys(keys, sendingEpoch || null) // nothing newer: just make sure all are loaded
  } else {
    await provider.setEpochKeys(keys, sendingEpoch || null) // newer loaded, still sending with the old one
    if (switchTimer) clearTimeout(switchTimer)
    switchTimer = setTimeout(async () => {
      switchTimer = null
      if (keyProvider !== provider) return
      await provider.setEpochKeys([newest], newest.epoch)
      sendingEpoch = newest.epoch
    }, sendingEpoch ? KEY_SWITCH_DELAY_MS : 0)
  }
  update({ e2eeProblem: '' })
}

export function fail(message) {
  joinSeq++
  update({ status: 'error', error: message })
}

// `encryption` is null for an ordinary call, or { keys: [{ epoch, bytes }] } for an end-to-end encrypted one (the keys
// from e2eeSession.voiceKeysFor). An encrypted call fails closed: if this computer cannot encrypt, or holds no key,
// it does not connect at all, so audio is never sent in the clear into a room that is meant to be encrypted.
export async function join({ url, token, key, encryption = null, jellyboxOpen = false, note = '' }) {
  const seq = ++joinSeq
  await teardown()
  if (seq !== joinSeq) return
  update({
    status: 'connecting',
    error: '',
    needsKey: false,
    jellyboxOpen,
    roomNote: note,
    key,
    micOn: false,
    pttHeld: false,
    quality: null,
    pingMs: null,
    participants: []
  })

  if (encryption && (!isE2EESupported() || !encryption.keys || encryption.keys.length === 0)) {
    update({
      needsKey: !!(isE2EESupported() && !(encryption.keys && encryption.keys.length)),
      status: 'error',
      error: encryption.keys && encryption.keys.length ? "This call is end-to-end encrypted and this computer can't encrypt audio." : "This call is end-to-end encrypted and this computer doesn't have the server's key yet. It arrives when another member opens Rushlight."
    })
    return
  }

  const savedInput = readPref(PREF.input, '')
  const savedOutput = readPref(PREF.output, '')
  let provider = null
  let worker = null
  if (encryption) {
    provider = new VoiceKeyProvider()
    worker = new E2EEWorker()
  }
  const r = new Room({
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: savedInput ? { deviceId: savedInput } : undefined,
    audioOutput: savedOutput ? { deviceId: savedOutput } : undefined,
    ...(encryption ? { e2ee: { keyProvider: provider, worker } } : {})
  })
  room = r
  keyProvider = provider
  e2eeWorker = worker
  r.on(RoomEvent.EncryptionError, (err, participant) => {
    if (room !== r) return
    const who = participant && (participant.name || participant.identity)
    update({ e2eeProblem: `${who ? who + "'s" : "Someone's"} audio can't be opened: this computer and theirs do not have the same key.` })
  })

  r.on(RoomEvent.ParticipantConnected, () => {
    playSound('other-join')
    refreshParticipants()
  })
  r.on(RoomEvent.ParticipantDisconnected, () => {
    playSound('other-leave')
    refreshParticipants()
  })
  r.on(RoomEvent.ActiveSpeakersChanged, refreshParticipants)
  r.on(RoomEvent.TrackMuted, refreshParticipants)
  r.on(RoomEvent.TrackUnmuted, () => {
    applyAllVolumes() // an admin unmuting someone must not make them audible while deafened
    refreshParticipants()
  })
  r.on(RoomEvent.TrackPublished, refreshParticipants)
  r.on(RoomEvent.TrackUnpublished, refreshParticipants)
  r.on(RoomEvent.LocalTrackPublished, () => {
    refreshParticipants()
    ensureGainProcessor()
  })
  r.on(RoomEvent.LocalTrackUnpublished, refreshParticipants)

  r.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
    if (participant.isLocal && room === r) update({ quality })
  })

  r.on(RoomEvent.TrackSubscribed, (incoming, _pub, participant) => {
    if (incoming.kind !== Track.Kind.Audio) return
    /** @type {import('livekit-client').RemoteAudioTrack} */
    const track = /** @type {any} */ (incoming)
    const name = participant.name || participant.identity
    remoteAudio.set(track, name)
    if (typeof participant.identity === 'string' && participant.identity.startsWith('jellybox-')) {
      botTrack = track
      update({ botAudioId: track.sid || track.mediaStreamTrack?.id || 'bot' })
    }
    // Attach first and set the volume after (see audioOutput.js): a track that arrives while
    // deafened must come up silent.
    const el = attachRemoteAudio(track, outputVolume * userVolume(name), state.deafened)
    el.dataset.lkAudio = '1'
    document.body.appendChild(el)
  })
  r.on(RoomEvent.TrackUnsubscribed, (track) => {
    if (track.kind !== Track.Kind.Audio) return
    remoteAudio.delete(track)
    if (track === botTrack) clearBotTrack()
    track.detach().forEach((el) => el.remove())
  })

  r.on(RoomEvent.Reconnecting, () => {
    if (room === r) update({ status: 'reconnecting' })
  })
  r.on(RoomEvent.Reconnected, () => {
    if (room === r) update({ status: 'connected' })
  })
  r.on(RoomEvent.Disconnected, (reason) => {
    if (intentional.has(r) || room !== r) return // we did this ourselves
    room = null
    remoteAudio.clear()
    clearBotTrack()
    stopPing()
    wantMic = false
    desiredMic = false
    pttHeld = false
    update({
      status: 'error',
      error:
        reason === DisconnectReason.DUPLICATE_IDENTITY
          ? 'You joined this room from somewhere else, so this connection was closed.'
          : 'The voice connection was closed.',
      micOn: false,
      pttHeld: false,
      quality: null,
      pingMs: null,
      participants: []
    })
  })

  try {
    if (encryption) {
      // Keys first, then encryption on, then connect: the mic is only ever published after both.
      await provider.setEpochKeys(encryption.keys)
      sendingEpoch = encryption.keys[encryption.keys.length - 1].epoch
      await r.setE2EEEnabled(true)
    }
    await r.connect(url, token)
  } catch (err) {
    if (seq === joinSeq) {
      room = null
      update({ status: 'error', error: connectErrorText(err), participants: [] })
    }
    intentional.add(r)
    try {
      await r.disconnect()
    } catch {
      // never fully connected
    }
    return
  }

  if (seq !== joinSeq) {
    // A newer join or a leave happened while this one was still connecting.
    intentional.add(r)
    await r.disconnect().catch(() => {})
    return
  }

  update({ status: 'connected', quality: r.localParticipant.connectionQuality, encrypted: !!encryption, e2eeProblem: '' })
  refreshParticipants()
  measurePing(r)
  pingTimer = setInterval(() => measurePing(r), 3000)
  // Same rule Alpha 1 had: open mic goes live, push-to-talk starts muted.
  setMic(state.micMode === 'open')
}

// Global (or, if the hook couldn't start, window-focused) push-to-talk. Both
// can fire for the same key press, so repeats of the current state are ignored.
export function handlePttKey(down) {
  if (!room || state.status !== 'connected' || state.micMode !== 'ptt') return
  if (micBlocked()) return // muted or deafened: the key does nothing
  if (down === pttHeld) return
  pttHeld = down
  update({ pttHeld: down })
  playSound(down ? 'ptt-on' : 'ptt-off')
  setMic(down)
}

export function setMicMode(mode) {
  const next = mode === 'open' ? 'open' : 'ptt'
  writePref(PREF.mode, next)
  pttHeld = false
  update({ micMode: next, pttHeld: false })
  if (room) setMic(next === 'open')
}

export function getOutputVolume() {
  return outputVolume
}

export function setOutputVolume(volume) {
  outputVolume = clamp01(volume)
  writePref(PREF.volume, String(outputVolume))
  applyAllVolumes()
}

export function getInputGain() {
  return inputGain
}

export function setInputGain(gain) {
  inputGain = clampGain(gain)
  writePref(PREF.gain, String(inputGain))
  if (gainNode) gainNode.gain.value = inputGain
  else ensureGainProcessor()
}

export function getSavedDevices() {
  return { input: readPref(PREF.input, ''), output: readPref(PREF.output, '') }
}

// '' means "system default".
export function setInputDevice(deviceId) {
  writePref(PREF.input, deviceId)
  if (room) room.switchActiveDevice('audioinput', deviceId || 'default').catch(() => {})
}

export function setOutputDevice(deviceId) {
  writePref(PREF.output, deviceId)
  if (room) room.switchActiveDevice('audiooutput', deviceId || 'default').catch(() => {})
}

// The global hook reports key events from the main process.
if (typeof window !== 'undefined' && window.api && window.api.onPttKey) {
  window.api.onPttKey(({ down }) => handlePttKey(down))
}
