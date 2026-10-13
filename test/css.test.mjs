// A stylesheet with a missing closing brace does not fail loudly: the rules after it quietly nest inside it and
// stop applying (this happened once when two branches' CSS was merged). So check the braces balance, and that
// nothing is left open at the end or closes more than it opened.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('index.css has balanced braces and no rule left open', () => {
  const css = readFileSync(new URL('../src/renderer/src/index.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '') // comments
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""') // strings, which may hold a brace
  let depth = 0
  let line = 1
  const at = (i) => css.slice(0, i).split('\n').length
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      assert.ok(depth >= 0, `a "}" with nothing open, near line ${at(i)}`)
    }
    // a rule that starts at the top level of a stylesheet cannot appear while one is still open, except in @media blocks
  }
  assert.equal(depth, 0, `${depth} rule(s) never closed`)
  void line
})

test('no ordinary rule is nested inside another by a missing brace', () => {
  const css = readFileSync(new URL('../src/renderer/src/index.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')
  // depth 1 may only be inside an at-rule (@media, @keyframes, @font-face...): find rules opened at depth 1 inside a plain rule
  const stack = []
  let start = 0
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') {
      const head = css.slice(start, i).trim()
      if (stack.length > 0 && !stack[stack.length - 1].startsWith('@')) {
        assert.fail(`"${head.slice(0, 60)}" is nested inside "${stack[stack.length - 1].slice(0, 60)}" (line ${css.slice(0, i).split('\n').length})`)
      }
      stack.push(head)
      start = i + 1
    } else if (css[i] === '}') {
      stack.pop()
      start = i + 1
    } else if (css[i] === ';' && stack.length === 0) start = i + 1
  }
})
