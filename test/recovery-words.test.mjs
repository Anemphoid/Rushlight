// Recovery words made by the app: 12 words from the list of 2048, from the secure random source, the same list the server
// knows, and a typed key is checked against the list before anything is sent.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { generateRecoveryWords, wordsAreKnown, keyWords } from '../src/renderer/src/recoveryKey.js'
import { RECOVERY_WORDS } from '../src/renderer/src/recoveryWords.js'

test('the list has 2048 different words', () => {
  assert.equal(RECOVERY_WORDS.length, 2048)
  assert.equal(new Set(RECOVERY_WORDS).size, 2048)
})

test('a key is 12 listed words, different each time', () => {
  const a = generateRecoveryWords()
  const b = generateRecoveryWords()
  assert.equal(keyWords(a).length, 12)
  assert.ok(wordsAreKnown(a))
  assert.notEqual(a, b)
})

test('each word comes from 11 bits of the random numbers, with no bias', () => {
  const fixed = Uint16Array.from([0, 1, 2047, 2048, 65535, 4095, 7, 8, 9, 10, 11, 12])
  const key = keyWords(generateRecoveryWords(() => fixed))
  assert.deepEqual(key, [0, 1, 2047, 0, 2047, 2047, 7, 8, 9, 10, 11, 12].map((i) => RECOVERY_WORDS[i]))
  // every word is reachable the same number of times from 16 bit numbers
  const counts = new Array(2048).fill(0)
  for (let n = 0; n < 65536; n++) counts[n & 0x7ff]++
  assert.ok(counts.every((c) => c === 32))
})

test('what is typed back is checked against the list, in any case and spacing', () => {
  const key = generateRecoveryWords()
  assert.ok(wordsAreKnown(key.toUpperCase().replace(/ /g, ',  ')))
  assert.equal(wordsAreKnown(key + ' extra'), false)
  assert.equal(wordsAreKnown(key.split(' ').slice(1).join(' ')), false)
  assert.equal(wordsAreKnown(key.replace(/^\S+/, 'zzzzzz')), false)
  assert.equal(wordsAreKnown(null), false)
})

test("it is the server's own list, word for word", async (t) => {
  const dir = process.env.RUSHLIGHT_SERVER_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'rushlight-server')
  const file = join(dir, 'src', 'recoverywords.js')
  if (!existsSync(file)) return t.skip('no server checkout')
  const server = await import(pathToFileURL(file).href)
  assert.deepEqual(RECOVERY_WORDS, server.RECOVERY_WORDS)
})
