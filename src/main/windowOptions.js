// What the window is made from, per system. Linux (and Mac) draw a transparent frameless window with rounded corners
// in the page. Windows cannot: a transparent frameless window there is not properly resizable or maximizable, so on
// Windows the window is a solid frameless one (Windows 11 rounds its corners itself; the page squares its own, see the
// `data-platform` rule in index.css). Kept apart from index.js so a test can see it without starting Electron.
export function windowFrame(platform) {
  if (platform === 'win32') return { frame: false, transparent: false, backgroundColor: '#121212' }
  return { frame: false, transparent: true }
}

// Self-updating works for the AppImage (Linux) and the installed program (Windows).
export function canSelfUpdate({ platform, packaged, appImage }) {
  if (!packaged) return false
  if (platform === 'win32') return true
  return !!appImage
}
