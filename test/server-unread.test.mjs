// The red bubble on a server icon: its count, and that white text on its red is readable in every skin.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { serverUnread } from '../src/renderer/src/unread.js'
import { contrastRatio, parseColor } from '../src/renderer/src/dev/contrast.js'

test('a server counts the unread messages of its own spaces only', () => {
  const counts = { '1:room:3': 2, '1:channel:1': 1, '12:room:3': 5, '2:room:9': 4, '1:room:7': 0 }
  assert.equal(serverUnread(counts, 1), 3)
  assert.equal(serverUnread(counts, 12), 5)
  assert.equal(serverUnread(counts, 2), 4)
  assert.equal(serverUnread(counts, 3), 0)
  assert.equal(serverUnread({}, 1), 0)
})

test('white text on the bubble red is at least 4.5 to 1, and the red does not depend on the skin', () => {
  const css = readFileSync(new URL('../src/renderer/src/index.css', import.meta.url), 'utf8')
  const red = css.match(/--bubble:\s*(#[0-9a-fA-F]{6})/)[1]
  const white = css.match(/--on-bubble:\s*(#[0-9a-fA-F]{6})/)[1]
  assert.ok(contrastRatio(parseColor(white), parseColor(red)) >= 4.5)
  for (const f of ['lantern', 'slate']) {
    const skin = readFileSync(new URL(`../src/renderer/src/styles/skins/${f}.css`, import.meta.url), 'utf8')
    assert.ok(!/--bubble/.test(skin), f + ' must not set the bubble colour')
  }
})
