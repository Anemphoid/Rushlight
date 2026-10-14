// The app icon: one picture in two places (the window and the build), 1024 square with a see-through corner.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url))

test('build/icon.png and resources/icon.png are the same 1024 px RGBA picture', () => {
  const a = read('build/icon.png')
  const b = read('resources/icon.png')
  assert.ok(a.equals(b))
  assert.equal(a.toString('latin1', 1, 4), 'PNG')
  assert.equal(a.readUInt32BE(16), 1024)
  assert.equal(a.readUInt32BE(20), 1024)
  assert.equal(a[25], 6, 'colour type 6 = RGBA, so the corners can be see-through')
})
