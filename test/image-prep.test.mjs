// The pure parts of getting a picture ready to send. The canvas step itself needs a browser.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitWithin, outputTypeFor, isPictureFile, MAX_SIDE, MAX_IMAGE_BYTES } from '../src/renderer/src/imagePrep.js'

test('a picture is shrunk to fit, keeps its shape, and is never enlarged', () => {
  assert.deepEqual(fitWithin(4000, 3000), { width: MAX_SIDE, height: Math.round(3000 * (MAX_SIDE / 4000)) })
  assert.deepEqual(fitWithin(3000, 4000), { width: Math.round(3000 * (MAX_SIDE / 4000)), height: MAX_SIDE })
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 })
  assert.deepEqual(fitWithin(100, 1, 50), { width: 50, height: 1 }) // never below one pixel
  assert.deepEqual(fitWithin(0, 0), { width: 0, height: 0 })
})

test('PNG and WebP keep their type, everything else becomes JPEG', () => {
  assert.equal(outputTypeFor('image/png'), 'image/png')
  assert.equal(outputTypeFor('image/webp'), 'image/webp')
  for (const t of ['image/jpeg', 'image/gif', 'image/heic', 'image/bmp', '']) assert.equal(outputTypeFor(t), 'image/jpeg')
})

test('only picture files are taken', () => {
  assert.equal(isPictureFile({ type: 'image/png' }), true)
  assert.equal(isPictureFile({ type: 'text/plain' }), false)
  assert.equal(isPictureFile({ type: 'application/pdf' }), false)
  assert.equal(isPictureFile(null), false)
  assert.equal(isPictureFile({}), false)
})

test("the client's size limit matches the server's default", () => {
  assert.equal(MAX_IMAGE_BYTES, 5 * 1024 * 1024)
})
