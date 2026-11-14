// How this computer's microphone is captured: noise suppression, automatic gain and echo cancellation. Each is on by default, because most
// people do not have a good microphone and a quiet room, and each can be turned off by someone who does (a studio microphone is only heard as
// one when the browser is not "improving" it). Kept on this computer, like the microphone mode; one value that Settings, the mic check and the
// voice connection all read, so they never disagree.
const KEYS = {
  noiseSuppression: 'rushlight.mic.noiseSuppression',
  autoGainControl: 'rushlight.mic.autoGainControl',
  echoCancellation: 'rushlight.mic.echoCancellation'
}
export const CAPTURE_KEYS = Object.keys(KEYS)

function readOne(key) {
  try {
    return localStorage.getItem(key) !== '0' // anything but an explicit off is on
  } catch {
    return true
  }
}

function readAll() {
  const all = {}
  for (const name of CAPTURE_KEYS) all[name] = readOne(KEYS[name])
  return all
}

let current = readAll()
const listeners = new Set()

// The same object until something changes, so React's useSyncExternalStore does not see a new value on every render.
export function getSnapshot() {
  return current
}

export function setCapturePref(name, on) {
  if (!(name in KEYS)) throw new Error(`Unknown microphone setting: ${name}`)
  if (current[name] === !!on) return
  current = { ...current, [name]: !!on }
  try {
    localStorage.setItem(KEYS[name], on ? '1' : '0')
  } catch {
    // storage unavailable: the choice just will not be remembered
  }
  listeners.forEach((l) => l(current))
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
