// Whether Jellybox's song pop-up shows when the song changes. One value, kept on this computer, that both the
// Jellybox column (its checkbox) and Settings (the Music section) read and change, so they never disagree.
const KEY = 'rushlight.songToast'
const listeners = new Set()

function read() {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}
let current = read()

export function songToastEnabled() {
  return current
}

export function setSongToastEnabled(on) {
  current = !!on
  try {
    localStorage.setItem(KEY, current ? '1' : '0')
  } catch {
    // storage unavailable: it just won't be remembered
  }
  listeners.forEach((l) => l())
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
