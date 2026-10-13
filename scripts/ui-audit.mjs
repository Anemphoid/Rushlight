// Counts what the client's styling really contains, for docs/ui-audit.md: hard-coded colours, sizes, radii,
// shadows, fonts and motion in index.css and in the components, the classes the screens use, every back and
// close pattern, and the button wording. Read-only; prints markdown to the terminal (or JSON with --json).
//
//   node scripts/ui-audit.mjs [--json]
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'src', 'renderer', 'src')
const json = process.argv.includes('--json')

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(jsx?|css)$/.test(n)) out.push(p)
  }
  return out
}
const files = walk(src)
const rel = (p) => relative(root, p)
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length

// ---------------------------------------------------------------- CSS
const cssPath = join(src, 'index.css')
const css = readFileSync(cssPath, 'utf8')
// blank out comments but keep line numbers
const cssClean = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

// rules: [{selector, body, line, media}]
const rules = []
{
  let i = 0
  let media = null
  const stack = []
  let buf = ''
  let startLine = 1
  for (; i < cssClean.length; i++) {
    const ch = cssClean[i]
    if (ch === '{') {
      const head = buf.trim()
      if (head.startsWith('@media') || head.startsWith('@supports')) {
        media = head
        stack.push({ at: true })
      } else if (head.startsWith('@keyframes')) {
        stack.push({ keyframes: head })
      } else {
        stack.push({ selector: head, body: '', line: startLine, media })
      }
      buf = ''
      startLine = lineOf(cssClean, i + 1)
    } else if (ch === '}') {
      const top = stack.pop()
      if (top && top.selector !== undefined) {
        top.body += buf
        rules.push(top)
      } else if (top && top.at) media = null
      buf = ''
      startLine = lineOf(cssClean, i + 1)
    } else {
      buf += ch
      const top = stack[stack.length - 1]
      if (top && top.selector !== undefined && ch === ';') {
        top.body += buf
        buf = ''
      }
    }
  }
}
const decls = []
for (const r of rules) {
  for (const d of r.body.split(';')) {
    const m = /^\s*([-\w]+)\s*:\s*([\s\S]+?)\s*$/.exec(d)
    if (m) decls.push({ prop: m[1], value: m[2].replace(/\s+/g, ' '), selector: r.selector, line: r.line, media: r.media })
  }
}
const isSkinBlock = (r) => /^:root$|^html\[data-skin/.test(r.selector)
const skinDecls = decls.filter((d) => /^:root$|^html\[data-skin/.test(d.selector) && d.prop.startsWith('--'))
const colourRe = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:white|black)\b/g

function tally(list, key) {
  const m = new Map()
  for (const x of list) {
    const k = key(x)
    const e = m.get(k) || { value: k, count: 0, where: [] }
    e.count++
    if (e.where.length < 4) e.where.push(x.where)
    m.set(k, e)
  }
  return [...m.values()].sort((a, b) => b.count - a.count)
}

const cssColours = []
for (const d of decls) {
  if (/^:root$|^html\[data-skin/.test(d.selector)) continue // the skins' own values are meant to be colours
  if (d.prop === '--redact-outline') continue
  for (const c of d.value.match(colourRe) || []) cssColours.push({ value: c.toLowerCase(), where: `index.css:${d.line} ${d.selector}` })
}
const varDefs = new Set(decls.filter((d) => d.prop.startsWith('--')).map((d) => d.prop))
const varUses = new Map()
for (const d of decls) for (const m of d.value.matchAll(/var\((--[\w-]+)/g)) varUses.set(m[1], (varUses.get(m[1]) || 0) + 1)
for (const f of files.filter((f) => f.endsWith('.jsx') || f.endsWith('.js'))) {
  const t = readFileSync(f, 'utf8')
  for (const m of t.matchAll(/var\((--[\w-]+)/g)) varUses.set(m[1], (varUses.get(m[1]) || 0) + 1)
}

const fontSizes = decls.filter((d) => d.prop === 'font-size').map((d) => ({ value: d.value, where: `index.css:${d.line} ${d.selector}` }))
const pxFonts = fontSizes.filter((f) => /px\b/.test(f.value))
const remFonts = fontSizes.filter((f) => /rem\b/.test(f.value))
const radii = decls.filter((d) => d.prop === 'border-radius').map((d) => ({ value: d.value, where: `index.css:${d.line} ${d.selector}` }))
const shadows = decls.filter((d) => d.prop === 'box-shadow' || d.prop === 'text-shadow').map((d) => ({ value: d.value, where: `index.css:${d.line} ${d.selector}` }))
const zindex = decls.filter((d) => d.prop === 'z-index').map((d) => ({ value: d.value, where: `index.css:${d.line} ${d.selector}` }))
const families = decls.filter((d) => d.prop === 'font-family' || (d.prop === 'font' && /,/.test(d.value))).map((d) => ({ value: d.value, where: `index.css:${d.line} ${d.selector}` }))
const transitions = decls.filter((d) => /^(transition|animation)(-duration|-timing-function)?$/.test(d.prop)).map((d) => ({ value: d.prop + ': ' + d.value, where: `index.css:${d.line} ${d.selector}` }))
const keyframes = [...cssClean.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1])
const medias = [...new Set(rules.map((r) => r.media).filter(Boolean))]
const important = decls.filter((d) => /!important/.test(d.value)).length
const pxSizes = decls.filter((d) => /^(width|height|min-width|max-width|min-height|max-height|padding|margin|gap)(-[a-z]+)?$/.test(d.prop) && /\d+px/.test(d.value))
const spacingValues = tally(
  pxSizes.flatMap((d) => (d.value.match(/-?\d+(?:\.\d+)?px/g) || []).map((v) => ({ value: v, where: `index.css:${d.line}` }))),
  (x) => x.value
)

// ---------------------------------------------------------------- JSX
const jsx = files.filter((f) => f.endsWith('.jsx') || f.endsWith('.js'))
const perFile = []
const jsxColours = []
const inlineProps = new Map()
const classUse = new Map()
const buttons = { plain: [], byClass: new Map() }
const backClose = []
const labels = []
const headings = []
for (const f of jsx) {
  const t = readFileSync(f, 'utf8')
  const styleBlocks = [...t.matchAll(/style=\{\{([\s\S]*?)\}\}/g)]
  perFile.push({ file: rel(f), inlineStyles: styleBlocks.length, lines: t.split('\n').length })
  for (const sb of styleBlocks) {
    for (const m of sb[1].matchAll(/(\w+)\s*:/g)) inlineProps.set(m[1], (inlineProps.get(m[1]) || 0) + 1)
  }
  for (const m of t.matchAll(colourRe)) {
    const line = lineOf(t, m.index)
    const text = t.split('\n')[line - 1]
    if (/\/\/|^\s*\*|import /.test(text.slice(0, text.indexOf(m[0])))) continue
    jsxColours.push({ value: m[0].toLowerCase(), where: `${rel(f)}:${line}` })
  }
  for (const m of t.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\}|\{'([^']+)'\s*\+)/g)) {
    for (const c of (m[1] || m[2] || m[3] || '').replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean)) classUse.set(c, (classUse.get(c) || 0) + 1)
  }
  for (const m of t.matchAll(/<button\b([\s\S]*?)>\s*([^<{][^<]*|\{[^}]*\})?/g)) {
    const attrs = m[1]
    const cn = /className=(?:"([^"]+)"|\{[^}]*\})/.exec(attrs)
    const line = lineOf(t, m.index)
    const label = (m[2] || '').replace(/\s+/g, ' ').trim()
    if (!cn) buttons.plain.push({ where: `${rel(f)}:${line}`, label })
    else {
      const key = cn[1] || '(computed class)'
      buttons.byClass.set(key, (buttons.byClass.get(key) || 0) + 1)
    }
    if (label && !label.startsWith('{')) labels.push({ label, where: `${rel(f)}:${line}` })
    if (/^(Back|Cancel|Close|Done|Hide|hide|Dismiss|close|Back to home|No|Never mind|Cancel, keep my old key)\b|^(←|×|x)$/.test(label)) backClose.push({ label, where: `${rel(f)}:${line}`, className: cn ? cn[1] || '(computed)' : '(none)' })
  }
  for (const m of t.matchAll(/<h([1-3])[^>]*>([^<]+)</g)) headings.push({ level: m[1], text: m[2].trim(), where: `${rel(f)}:${lineOf(t, m.index)}` })
}
const cssClasses = new Set([...cssClean.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]))
const usedNotStyled = [...classUse.keys()].filter((c) => !cssClasses.has(c)).sort()
const styledNotUsed = [...cssClasses].filter((c) => !classUse.has(c)).sort()

const wording = {
  signInVsLogIn: labels.filter((l) => /sign in|log in/i.test(l.label)).map((l) => `${l.label} (${l.where})`),
  titleCaseLabels: labels.filter((l) => /^[A-Z][a-z]+( [A-Z][a-z]+)+$/.test(l.label) && !/^(Back to home)$/.test(l.label)).map((l) => `${l.label} (${l.where})`),
  vague: labels.filter((l) => /^(OK|Ok|Yes|No|Submit|Go|Done|Click here)$/.test(l.label)).map((l) => `${l.label} (${l.where})`)
}

const out = {
  css: {
    lines: css.split('\n').length,
    rules: rules.length,
    skinVariables: [...new Set(skinDecls.map((d) => d.prop))],
    skinBlocks: [...new Set(rules.filter(isSkinBlock).map((r) => r.selector))],
    hardCodedColours: tally(cssColours, (x) => x.value),
    hardCodedColourCount: cssColours.length,
    variablesDefined: [...varDefs],
    variablesUsed: Object.fromEntries([...varUses].sort((a, b) => b[1] - a[1])),
    variablesUsedButUndefined: [...varUses.keys()].filter((v) => !varDefs.has(v)),
    variablesDefinedButUnused: [...varDefs].filter((v) => !varUses.has(v)),
    pxFontSizes: tally(pxFonts, (x) => x.value),
    remFontSizes: tally(remFonts, (x) => x.value),
    radii: tally(radii, (x) => x.value),
    shadows: tally(shadows, (x) => x.value),
    zIndex: tally(zindex, (x) => x.value),
    fontFamilies: tally(families, (x) => x.value),
    motion: tally(transitions, (x) => x.value),
    keyframes,
    mediaQueries: medias,
    importantCount: important,
    pxSpacingValues: spacingValues.slice(0, 30),
    distinctPxSpacingValues: spacingValues.length
  },
  jsx: {
    files: perFile.sort((a, b) => b.inlineStyles - a.inlineStyles),
    inlineStyleTotal: perFile.reduce((n, f) => n + f.inlineStyles, 0),
    inlineProps: Object.fromEntries([...inlineProps].sort((a, b) => b[1] - a[1])),
    hardCodedColours: tally(jsxColours, (x) => x.value),
    buttonsWithNoClass: buttons.plain,
    buttonClasses: Object.fromEntries([...buttons.byClass].sort((a, b) => b[1] - a[1])),
    backAndClosePatterns: backClose,
    classesUsedButNotStyled: usedNotStyled,
    classesStyledButNeverUsed: styledNotUsed,
    headings
  },
  wording
}

if (json) {
  console.log(JSON.stringify(out, null, 1))
} else {
  const L = (...a) => console.log(...a)
  L('# Raw numbers from scripts/ui-audit.mjs\n')
  L(`index.css: ${out.css.lines} lines, ${out.css.rules} rules, ${out.css.importantCount} !important`)
  L(`skin blocks: ${out.css.skinBlocks.join(' | ')}`)
  L(`skin variables: ${out.css.skinVariables.join(' ')}`)
  L(`hard-coded colours outside the skin blocks: ${out.css.hardCodedColourCount} uses, ${out.css.hardCodedColours.length} distinct`)
  for (const c of out.css.hardCodedColours) L(`  ${c.value} x${c.count}  e.g. ${c.where[0]}`)
  L(`px font sizes: ${out.css.pxFontSizes.map((f) => f.value + ' x' + f.count).join(', ') || 'none'}`)
  L(`rem font sizes (${out.css.remFontSizes.length} distinct): ${out.css.remFontSizes.map((f) => f.value + ' x' + f.count).join(', ')}`)
  L(`radii: ${out.css.radii.map((f) => f.value + ' x' + f.count).join(', ')}`)
  L(`shadows: ${out.css.shadows.map((f) => f.value + ' x' + f.count).join(' | ') || 'none'}`)
  L(`z-index: ${out.css.zIndex.map((f) => f.value + ' x' + f.count).join(', ')}`)
  L(`font families: ${out.css.fontFamilies.map((f) => f.value + ' x' + f.count).join(' | ')}`)
  L(`motion: ${out.css.motion.map((f) => f.value + ' x' + f.count).join(' | ')}`)
  L(`keyframes: ${out.css.keyframes.join(', ') || 'none'}`)
  L(`media queries: ${out.css.mediaQueries.join(' | ')}`)
  L(`distinct px spacing/size values: ${out.css.distinctPxSpacingValues}`)
  L(`variables used but undefined: ${out.css.variablesUsedButUndefined.join(', ') || 'none'}`)
  L(`variables defined but unused: ${out.css.variablesDefinedButUnused.join(', ') || 'none'}`)
  L(`variable use counts: ${Object.entries(out.css.variablesUsed).map(([k, v]) => k + ' ' + v).join(', ')}`)
  L(`\ncomponents: inline style={{}} blocks total ${out.jsx.inlineStyleTotal}`)
  for (const f of out.jsx.files.filter((f) => f.inlineStyles)) L(`  ${f.file}: ${f.inlineStyles}`)
  L(`inline style properties: ${Object.entries(out.jsx.inlineProps).map(([k, v]) => k + ' ' + v).join(', ')}`)
  L(`hard-coded colours in components: ${out.jsx.hardCodedColours.map((c) => c.value + ' x' + c.count + ' (' + c.where[0] + ')').join(', ') || 'none'}`)
  L(`button classes: ${Object.entries(out.jsx.buttonClasses).map(([k, v]) => k + ' x' + v).join(' | ')}`)
  L(`buttons with no class: ${out.jsx.buttonsWithNoClass.length}`)
  for (const b of out.jsx.buttonsWithNoClass) L(`  ${b.where} "${b.label}"`)
  L(`back/close/cancel patterns:`)
  for (const b of out.jsx.backAndClosePatterns) L(`  ${b.where} "${b.label}" [${b.className}]`)
  L(`classes used but not styled: ${out.jsx.classesUsedButNotStyled.join(', ') || 'none'}`)
  L(`classes styled but never used: ${out.jsx.classesStyledButNeverUsed.join(', ') || 'none'}`)
  L(`sign in / log in wording:`)
  for (const w of out.wording.signInVsLogIn) L('  ' + w)
  L(`Title Case button labels:`)
  for (const w of out.wording.titleCaseLabels) L('  ' + w)
  L(`vague labels: ${out.wording.vague.join(', ') || 'none'}`)
  L(`headings:`)
  for (const h of out.jsx.headings) L(`  h${h.level} "${h.text}" ${h.where}`)
}
