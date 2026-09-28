// The voice connection. One LiveKit room at a time, kept outside React on
// purpose: opening Settings or Profile unmounts the tree screen, and that must
// not drop you out of a call. Components read it through subscribe/getSnapshot.
//
// The mic and PTT behavior is ported from the Alpha 1 client, which worked on
// real hardware: PTT mode starts muted and unmutes only while the key is held,
// open mic stays live, and the mode survives room switches.
import { Room, RoomEvent, Track, DisconnectReason } from 'livekit-client'
import { playSound } from './sounds'

const PREF = {
  mode: 'rushlight-mic-mode',
  volume: 'rushlight-output-volume',
  input: 'rushlight-mic-device',
  output: 'rushlight-speaker-device'
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
const remoteAudio = new Set() // subscribed audio tracks, so the volume slider can reach them
const intentional = new WeakSet() // rooms we disconnected ourselves, vs. dropped on us

let state = {
  status: 'idle', // idle | connecting | connected | reconnecting | error
  error: '',
  key: null, // which space this connection belongs to, e.g. 'room:7'
  micMode: readPref(PREF.mode, 'ptt') === 'open' ? 'open' : 'ptt',
  micOn: false,
  pttHeld: false,
  participants: []
}

const listeners = new Set()

function update(patch) {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
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
      isMuted: !p.isMicrophoneEnabled
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

function setMic(on) {
  desiredMic = on
  applyMic()
}

async function teardown() {
  const old = room
  room = null
  remoteAudio.clear()
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
  document.querySelectorAll('audio[data-lk-audio]').forEach((el) => el.remove())
}

export async function leave() {
  joinSeq++
  const wasActive = room !== null || state.status !== 'idle'
  await teardown()
  if (wasActive) {
    update({ status: 'idle', error: '', key: null, micOn: false, pttHeld: false, participants: [] })
  }
}

export function fail(message) {
  joinSeq++
  update({ status: 'error', error: message })
}

export async function join({ url, token, key }) {
  const seq = ++joinSeq
  await teardown()
  if (seq !== joinSeq) return
  update({ status: 'connecting', error: '', key, micOn: false, pttHeld: false, participants: [] })

  const savedInput = readPref(PREF.input, '')
  const savedOutput = readPref(PREF.output, '')
  const r = new Room({
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: savedInput ? { deviceId: savedInput } : undefined,
    audioOutput: savedOutput ? { deviceId: savedOutput } : undefined
  })
  room = r

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
  r.on(RoomEvent.TrackUnmuted, refreshParticipants)
  r.on(RoomEvent.TrackPublished, refreshParticipants)
  r.on(RoomEvent.TrackUnpublished, refreshParticipants)
  r.on(RoomEvent.LocalTrackPublished, refreshParticipants)
  r.on(RoomEvent.LocalTrackUnpublished, refreshParticipants)

  r.on(RoomEvent.TrackSubscribed, (incoming) => {
    if (incoming.kind !== Track.Kind.Audio) return
    /** @type {import('livekit-client').RemoteAudioTrack} */
    const track = /** @type {any} */ (incoming)
    track.setVolume(outputVolume)
    remoteAudio.add(track)
    const el = track.attach()
    el.dataset.lkAudio = '1'
    document.body.appendChild(el)
  })
  r.on(RoomEvent.TrackUnsubscribed, (track) => {
    if (track.kind !== Track.Kind.Audio) return
    remoteAudio.delete(track)
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
      participants: []
    })
  })

  try {
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

  update({ status: 'connected' })
  refreshParticipants()
  // Same rule Alpha 1 had: open mic goes live, push-to-talk starts muted.
  setMic(state.micMode === 'open')
}

// Global (or, if the hook couldn't start, window-focused) push-to-talk. Both
// can fire for the same key press, so repeats of the current state are ignored.
export function handlePttKey(down) {
  if (!room || state.status !== 'connected' || state.micMode !== 'ptt') return
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
  remoteAudio.forEach((track) => track.setVolume(outputVolume))
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
