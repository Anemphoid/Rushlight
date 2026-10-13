// WCAG contrast maths, for the style gallery now and the contrast check that fails the build later.
// Pure functions, no DOM, so they can be tested in Node.

// '#rgb', '#rrggbb', 'rgb(1, 2, 3)' or 'rgba(1, 2, 3, 0.5)' -> [r, g, b] (0 to 255). Alpha is ignored:
// check a translucent colour against the surface it sits on by blending first (see blend).
export function parseColor(input) {
  const s = String(input || '').trim().toLowerCase()
  let m = /^#([0-9a-f]{3})$/.exec(s)
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16))
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(s)
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16))
  m = /^rgba?\(\s*(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/.exec(s)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  return null
}

// A colour at some opacity over a background colour.
export function blend(fg, bg, alpha) {
  return fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)))
}

export function luminance([r, g, b]) {
  const lin = (v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

// 1 (no contrast) to 21 (black on white).
export function contrastRatio(a, b) {
  const la = luminance(typeof a === 'string' ? parseColor(a) : a)
  const lb = luminance(typeof b === 'string' ? parseColor(b) : b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

// The bars the design plan sets: 4.5 to 1 for text, 3 to 1 for controls and icons.
export const MIN_TEXT = 4.5
export const MIN_CONTROL = 3
