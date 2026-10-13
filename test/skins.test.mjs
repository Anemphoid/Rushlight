// The skin contract, checked on the real skin files: every skin and mode sets every name, the stored ids are the
// ones people already have, every colour pair that has to be readable is, and no rule in the app uses a name
// nothing defines. This is the "completeness test" and the "contrast check" of the UI refresh plan.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COLOUR_TOKENS, SKIN_TOKENS, CONTRAST_PAIRS } from '../src/renderer/src/styles/contract.js'
import { SKINS, MODES, DEFAULT_SKIN, DEFAULT_MODE, skinName } from '../src/renderer/src/skins.js'
import { contrastRatio, parseColor } from '../src/renderer/src/dev/contrast.js'

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer', 'src')
const read = (p) => readFileSync(join(src, p), 'utf8')

// Parse a skin file into { all: shape and type, dark: {...}, light: {...} }. Only the plain `name: value;` lines the
// skin files use; a value that points at another variable (var(--x)) is resolved inside its own block.
function parseSkin(file) {
  const css = read(`styles/skins/${file}.css`).replace(/\/\*[\s\S]*?\*\//g, '')
  const out = { shape: {}, dark: {}, light: {} }
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sel = m[1].trim()
    const decls = Object.fromEntries([...m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]))
    if (/data-mode='light'/.test(sel)) Object.assign(out.light, decls)
    else if (/data-mode='dark'/.test(sel)) Object.assign(out.dark, decls)
    else Object.assign(out.shape, decls)
  }
  return out
}
const skins = Object.fromEntries(SKINS.map((s) => [s.id, parseSkin(s.file)]))

test('the skins keep the ids people have saved, with the new names', () => {
  assert.deepEqual(SKINS.map((s) => s.id), ['parchment', 'cool-slate'])
  assert.deepEqual(SKINS.map((s) => s.name), ['Lantern', 'Slate'])
  assert.equal(DEFAULT_SKIN, 'parchment')
  assert.equal(DEFAULT_MODE, 'dark')
  assert.deepEqual(MODES, ['dark', 'light'])
  assert.equal(skinName('cool-slate'), 'Slate')
  assert.equal(skinName('something-removed'), 'Lantern') // an unknown saved id falls back to the default skin
})

test('every skin sets every colour name in both modes, and every shape and type name', () => {
  for (const [id, skin] of Object.entries(skins)) {
    for (const mode of MODES) {
      const missing = COLOUR_TOKENS.filter((t) => !(t in skin[mode]))
      assert.deepEqual(missing, [], `${id} ${mode} leaves out: ${missing.join(', ')}`)
    }
    const missingShape = SKIN_TOKENS.filter((t) => !(t in skin.shape))
    assert.deepEqual(missingShape, [], `${id} leaves out: ${missingShape.join(', ')}`)
    const known = new Set([...COLOUR_TOKENS, ...SKIN_TOKENS])
    for (const key of [...Object.keys(skin.dark), ...Object.keys(skin.light), ...Object.keys(skin.shape)]) {
      assert.ok(known.has(key), `${id} sets ${key}, which is not in the contract`)
    }
  }
})

test('every colour a skin sets is a plain colour the checks can read (except the redaction outline)', () => {
  for (const [id, skin] of Object.entries(skins)) {
    for (const mode of MODES) {
      for (const t of COLOUR_TOKENS) {
        if (t === '--redact-outline' || t === '--overlay' || t === '--selection') continue
        assert.ok(parseColor(skin[mode][t]), `${id} ${mode} ${t} = ${skin[mode][t]}`)
      }
    }
  }
})

test('text is readable (4.5 to 1) and controls are visible (3 to 1) in every skin and mode', () => {
  const failures = []
  for (const [id, skin] of Object.entries(skins)) {
    for (const mode of MODES) {
      for (const [fg, bg, need] of CONTRAST_PAIRS) {
        const ratio = contrastRatio(parseColor(skin[mode][fg]), parseColor(skin[mode][bg]))
        if (ratio < need) failures.push(`${id} ${mode}: ${fg} on ${bg} is ${ratio.toFixed(2)}, needs ${need}`)
      }
    }
  }
  assert.deepEqual(failures, [])
})

test('the default look (no attributes set) is Lantern dark, as Parchment dark was', () => {
  const css = read('styles/skins/lantern.css')
  assert.match(css, /:root,\s*html\[data-skin='parchment'\]\[data-mode='dark'\]/)
  assert.match(css, /:root,\s*html\[data-skin='parchment'\] \{/)
})

test('no rule or component uses a variable that nothing defines', () => {
  const defined = new Set([...COLOUR_TOKENS, ...SKIN_TOKENS])
  const own = readFileSync(join(src, 'index.css'), 'utf8')
  for (const m of own.matchAll(/^\s+(--[\w-]+)\s*:/gm)) defined.add(m[1])
  const unknown = new Set()
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) {
        if (n !== 'dev') walk(p)
      } else if (/\.(jsx?|css)$/.test(n)) {
        for (const m of readFileSync(p, 'utf8').matchAll(/var\((--[\w-]+)/g)) if (!defined.has(m[1])) unknown.add(`${m[1]} in ${n}`)
      }
    }
  }
  walk(src)
  assert.deepEqual([...unknown], [])
})

test('the old skin names and the hard-coded logo colours are gone from the app', () => {
  const offenders = []
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.jsx?$/.test(n) && !/skins\.js$/.test(n)) {
        const t = readFileSync(p, 'utf8')
        if (/Cool Slate|Parchment/.test(t.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))) offenders.push(`${n}: old skin name`)
      }
    }
  }
  walk(src)
  assert.deepEqual(offenders, [])
  assert.doesNotMatch(read('components/RushlightLogo.jsx'), /#[0-9a-fA-F]{3,6}/, 'the logo is coloured by tokens only')
})
