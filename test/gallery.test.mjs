// The style gallery's contrast maths, and the promise that the gallery is development-only: nothing in a
// production build may load it. (The page itself was checked in a browser; see the pull request.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseColor, blend, luminance, contrastRatio, MIN_TEXT, MIN_CONTROL } from '../src/renderer/src/dev/contrast.js'

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer', 'src')

test('colours are read in the forms the stylesheet uses', () => {
  assert.deepEqual(parseColor('#fff'), [255, 255, 255])
  assert.deepEqual(parseColor('#1c150d'), [28, 21, 13])
  assert.deepEqual(parseColor('  #ECDCB8 '), [236, 220, 184])
  assert.deepEqual(parseColor('rgb(1, 2, 3)'), [1, 2, 3])
  assert.deepEqual(parseColor('rgba(10, 20, 30, 0.5)'), [10, 20, 30])
  assert.deepEqual(parseColor('#11223344'), [17, 34, 51]) // alpha dropped
  for (const bad of ['', 'red', 'color-mix(in srgb, #fff 32%, transparent)', '#12', null, undefined]) assert.equal(parseColor(bad), null, String(bad))
})

test('contrast ratios match the published WCAG values', () => {
  assert.equal(contrastRatio('#000', '#fff').toFixed(2), '21.00')
  assert.equal(contrastRatio('#fff', '#000').toFixed(2), '21.00') // order does not matter
  assert.equal(contrastRatio('#777', '#777').toFixed(2), '1.00')
  // #777 on white is the textbook near miss: 4.48, so it fails the 4.5 bar for text
  assert.equal(contrastRatio('#777777', '#ffffff').toFixed(2), '4.48')
  assert.ok(contrastRatio('#777777', '#ffffff') < MIN_TEXT)
  assert.ok(contrastRatio('#767676', '#ffffff') >= MIN_TEXT) // and #767676 is the darkest grey that passes
  assert.ok(contrastRatio('#949494', '#ffffff') >= MIN_CONTROL)
  assert.equal(luminance([0, 0, 0]), 0)
  assert.equal(luminance([255, 255, 255]), 1)
  // the two branches of the sRGB curve meet near 0.039; a value just above it must use the power branch
  assert.equal(luminance([12, 12, 12]).toFixed(4), '0.0037')
  assert.equal(luminance([10, 10, 10]).toFixed(4), '0.0030')
})

test('blending a translucent colour over a surface gives what the eye sees', () => {
  assert.deepEqual(blend([0, 0, 0], [255, 255, 255], 0.5), [128, 128, 128])
  assert.deepEqual(blend([10, 20, 30], [200, 200, 200], 1), [10, 20, 30])
  assert.deepEqual(blend([10, 20, 30], [200, 200, 200], 0), [200, 200, 200])
})

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.jsx?$/.test(n)) out.push(p)
  }
  return out
}

test('only main.jsx reaches for the gallery, and only behind import.meta.env.DEV', () => {
  const offenders = []
  for (const f of walk(src)) {
    const rel = relative(src, f)
    if (rel.startsWith('dev/')) continue
    const text = readFileSync(f, 'utf8')
    if (/dev\/(DevGalleryHost|StyleGallery|contrast|gallery)/.test(text) || /\bStyleGallery\b|\bDevGalleryHost\b/.test(text)) {
      if (rel !== 'main.jsx') offenders.push(rel)
    }
  }
  assert.deepEqual(offenders, [], 'the gallery must not be imported outside main.jsx')
  const main = readFileSync(join(src, 'main.jsx'), 'utf8')
  assert.match(main, /import\.meta\.env\.DEV\s*\?\s*lazy\(\(\)\s*=>\s*import\('\.\/dev\/DevGalleryHost'\)\)\s*:\s*null/)
  assert.doesNotMatch(main, /^import .*dev\//m, 'no static import of dev/ in main.jsx')
  // the gallery's own stylesheet is imported by the gallery, never by the app's css
  assert.doesNotMatch(readFileSync(join(src, 'index.css'), 'utf8'), /gal-|dev\/gallery/)
})
