// Density and icon size, remembered on this computer like the skin and mode. An unknown or missing stored value
// (never set, hand-edited, or from a later version) falls back to the default instead of reaching the page.
export const DENSITIES = ['compact', 'cozy', 'comfortable']
export const ICON_SIZES = ['small', 'medium', 'large']
export const DEFAULT_DENSITY = 'cozy'
export const DEFAULT_ICON_SIZE = 'medium'

const KEYS = { density: 'rushlight-density', iconSize: 'rushlight-icon-size' }

function load(key, allowed, fallback) {
  try {
    const v = localStorage.getItem(key)
    return allowed.includes(v) ? v : fallback
  } catch {
    return fallback
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage unavailable: it just won't be remembered
  }
}

export const loadDensity = () => load(KEYS.density, DENSITIES, DEFAULT_DENSITY)
export const loadIconSize = () => load(KEYS.iconSize, ICON_SIZES, DEFAULT_ICON_SIZE)
export const saveDensity = (v) => save(KEYS.density, v)
export const saveIconSize = (v) => save(KEYS.iconSize, v)
