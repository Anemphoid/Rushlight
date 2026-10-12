// The visualizer choices are per person and remembered on this computer.
const KEY = 'rushlight.visualizer'
const DEFAULTS = { enabled: false, style: 'bars', shuffle: false, favourites: [] }
export const STYLES = ['bars', 'wave', 'radial']

export function loadPrefs(storage = globalThis.localStorage) {
  try {
    const raw = JSON.parse(storage.getItem(KEY) || '{}')
    return {
      enabled: raw.enabled === true,
      style: STYLES.includes(raw.style) ? raw.style : DEFAULTS.style,
      shuffle: raw.shuffle === true,
      favourites: Array.isArray(raw.favourites) ? raw.favourites.filter((n) => typeof n === 'string').slice(0, 500) : []
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function savePrefs(prefs, storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // private window or blocked storage: the choice just does not stick
  }
}
