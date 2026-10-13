// Butterchurn (a WebGL port of Milkdrop) and its preset packs, MIT licensed and bundled with the app.
// Nothing is downloaded, and none of it loads until someone first turns the visualizer on and opens the
// large view, so start-up is not slowed (these imports become their own chunks).
let loading = null

export function supportsWebGL2() {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

const packs = (m) => {
  const p = m.default || m
  return typeof p.getPresets === 'function' ? p.getPresets() : p
}

export function loadMilkdrop() {
  if (!loading) {
    loading = Promise.all([
      import('butterchurn'),
      import('butterchurn-presets'),
      import('butterchurn-presets/lib/butterchurnPresetsExtra.min.js'),
      import('butterchurn-presets/lib/butterchurnPresetsExtra2.min.js'),
      import('butterchurn-presets/lib/butterchurnPresetsMD1.min.js')
    ]).then(([bc, ...presetModules]) => {
      const presets = {}
      for (const m of presetModules) Object.assign(presets, packs(m))
      const names = Object.keys(presets).sort((a, b) => a.localeCompare(b))
      return { butterchurn: bc.default || bc, presets, names }
    })
    loading.catch(() => {
      loading = null // allow another try
    })
  }
  return loading
}
