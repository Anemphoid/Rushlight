// The skin contract: every name a skin must set, and every colour pair that has to be readable. The completeness
// test and the contrast test read this file, and so does the style gallery, so a skin is checked the same way
// everywhere. Skins live in styles/skins/*.css; the stored skin ids and display names are in skins.js.

// Colours a skin sets once for the dark mode and once for the light mode.
export const COLOUR_TOKENS = [
  '--bg-app',
  '--bg-rail',
  '--bg-panel',
  '--bg-raised',
  '--bg-sunken',
  '--border',
  '--border-strong',
  '--divider',
  '--text',
  '--text-dim',
  '--text-faint',
  '--accent',
  '--accent-hover',
  '--on-accent',
  '--accent-soft',
  '--danger',
  '--on-danger',
  '--danger-soft',
  '--success',
  '--warning',
  '--info',
  '--overlay',
  '--selection',
  '--scrollbar',
  '--speaking',
  '--focus-ring',
  '--meter-low',
  '--meter-mid',
  '--meter-high',
  '--redact-outline',
  '--logo-ring1',
  '--logo-ring2',
  '--logo-ring3',
  '--logo-wax',
  '--logo-flame',
  '--logo-flame-core',
  '--logo-wick'
]

// Shape and type a skin sets once, for both modes.
export const SKIN_TOKENS = ['--font-ui', '--font-heading', '--font-mono', '--heading-weight', '--radius-sm', '--radius-md', '--radius-lg', '--radius-pill', '--page-header-h', '--page-title-size', '--nav-w', '--nav-gutter', '--nav-item-radius', '--nav-bar-w']

// Text needs 4.5 to 1, controls and icons 3 to 1. "border-strong" is the edge of a text field: the one place a
// border is the only thing that says "type here", so it has to be visible. Other borders and dividers are
// decoration (the control is named by its label) and are not measured. "accent" is a fill that carries a label
// (measured as on-accent on accent), so it is not measured against the page; anything that is only a coloured
// mark (a slider's fill, the progress bar, a link) uses "accent-hover", which is measured as text.
export const MIN_TEXT = 4.5
export const MIN_CONTROL = 3
export const CONTRAST_PAIRS = [
  ['--text', '--bg-app', MIN_TEXT],
  ['--text', '--bg-rail', MIN_TEXT],
  ['--text', '--bg-panel', MIN_TEXT],
  ['--text', '--bg-raised', MIN_TEXT],
  ['--text', '--bg-sunken', MIN_TEXT],
  ['--text', '--accent-soft', MIN_TEXT],
  ['--text-dim', '--bg-app', MIN_TEXT],
  ['--text-dim', '--bg-rail', MIN_TEXT],
  ['--text-dim', '--bg-panel', MIN_TEXT],
  ['--text-dim', '--bg-raised', MIN_TEXT],
  ['--text-dim', '--bg-sunken', MIN_TEXT],
  ['--text-faint', '--bg-app', MIN_TEXT],
  ['--text-faint', '--bg-rail', MIN_TEXT],
  ['--text-faint', '--bg-panel', MIN_TEXT],
  ['--text-faint', '--bg-sunken', MIN_TEXT],
  ['--accent-hover', '--bg-app', MIN_TEXT],
  ['--accent-hover', '--bg-panel', MIN_TEXT],
  ['--accent-hover', '--bg-raised', MIN_TEXT],
  ['--accent-hover', '--accent-soft', MIN_TEXT],
  ['--on-accent', '--accent', MIN_TEXT],
  ['--on-danger', '--danger', MIN_TEXT],
  ['--danger', '--bg-app', MIN_TEXT],
  ['--danger', '--bg-panel', MIN_TEXT],
  ['--danger', '--bg-raised', MIN_TEXT],
  ['--success', '--bg-app', MIN_TEXT],
  ['--success', '--bg-panel', MIN_TEXT],
  ['--warning', '--bg-app', MIN_TEXT],
  ['--info', '--bg-app', MIN_TEXT],
  ['--border-strong', '--bg-sunken', MIN_CONTROL],
  ['--border-strong', '--bg-app', MIN_CONTROL],
  ['--speaking', '--bg-panel', MIN_CONTROL],
  ['--focus-ring', '--bg-app', MIN_CONTROL],
  ['--focus-ring', '--bg-panel', MIN_CONTROL]
]
