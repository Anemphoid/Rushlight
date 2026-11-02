// A ratchet on hard-coded colours. Every colour a screen uses should come from the skin's variables
// (styles/contract.js), or a skin cannot restyle it. There is no linter in this repo, so the audit script's counts are
// held against a baseline: the numbers may go down, never up. When they go down, lower the baseline in
// test/raw-colours.baseline.json in the same change; a new raw colour makes this fail, naming where to look.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const baseline = JSON.parse(readFileSync(new URL('./raw-colours.baseline.json', import.meta.url), 'utf8'))

test('the number of hard-coded colours in the stylesheet and the components never goes up', () => {
  const audit = JSON.parse(execFileSync('node', ['scripts/ui-audit.mjs', '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 1e8 }))
  const now = { css: audit.css.hardCodedColourCount, jsx: audit.jsx.hardCodedColours.length }
  const where = 'run `npm run ui:audit` and look for "hard-coded colours"; use a variable from styles/contract.js instead'
  assert.ok(now.css <= baseline.css, `index.css has ${now.css} hard-coded colours, the baseline is ${baseline.css}: ${where}`)
  assert.ok(now.jsx <= baseline.jsx, `the components have ${now.jsx} hard-coded colours, the baseline is ${baseline.jsx}: ${where}`)
})
