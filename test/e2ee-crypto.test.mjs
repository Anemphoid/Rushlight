// The encryption primitives on their own: wrapping a server key to a device, deriving the chat and voice keys,
// sealing and opening chat text. Real WebCrypto, no server. What each test pins down is something a mistake
// would silently weaken: an envelope that opens for the wrong device, a message that opens in the wrong place.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CryptoProblem,
  toB64u,
  fromB64u,
  generateDeviceKeys,
  newServerKey,
  wrapServerKey,
  unwrapServerKey,
  deriveVoiceKey,
  sealMessage,
  openMessage,
  messageEpoch,
  MAX_PLAINTEXT_BYTES
} from '../src/renderer/src/e2ee/crypto.js'

const wrapCtx = { serverId: 7, epoch: 1, recipientDeviceId: 11 }
const space = { serverId: 7, type: 'channel', spaceId: 3, epoch: 1, authorId: 5 }
const problem = async (promise, code) => {
  try {
    await promise
  } catch (err) {
    assert.ok(err instanceof CryptoProblem, String(err))
    assert.equal(err.code, code)
    return
  }
  assert.fail('expected a CryptoProblem ' + code)
}
// the shape the server accepts (Rushlight-Server src/e2ee.js)
const SERVER_ENVELOPE = /^rl1\.(\d{1,9})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22,})$/

test('base64url round-trips every length and stays URL safe', () => {
  for (let n = 0; n < 70; n++) {
    const bytes = crypto.getRandomValues(new Uint8Array(n))
    const text = toB64u(bytes)
    assert.match(text, /^[A-Za-z0-9_-]*$/)
    assert.deepEqual(fromB64u(text), bytes)
  }
  assert.throws(() => fromB64u('has space'), CryptoProblem)
  assert.throws(() => fromB64u('a+b/'), CryptoProblem)
})

test("a device's private key can be used but never read back out", async () => {
  const { privateKey, publicKey } = await generateDeviceKeys()
  assert.equal(privateKey.extractable, false)
  await assert.rejects(crypto.subtle.exportKey('pkcs8', privateKey))
  assert.equal(fromB64u(publicKey).length, 65) // an uncompressed P-256 point, as the server expects
  assert.equal(fromB64u(publicKey)[0], 4)
})

test('a server key wrapped to a device opens on that device and nowhere else', async () => {
  const mine = await generateDeviceKeys()
  const other = await generateDeviceKeys()
  const key = newServerKey()
  assert.equal(key.length, 32)
  const envelope = await wrapServerKey(key, mine.publicKey, wrapCtx)
  assert.deepEqual(await unwrapServerKey(envelope, mine.privateKey, wrapCtx), key)
  await problem(unwrapServerKey(envelope, other.privateKey, wrapCtx), 'cannot_open')
})

test('an envelope is tied to its server, epoch and recipient, so it cannot be replayed elsewhere', async () => {
  const d = await generateDeviceKeys()
  const envelope = await wrapServerKey(newServerKey(), d.publicKey, wrapCtx)
  for (const bad of [{ ...wrapCtx, serverId: 8 }, { ...wrapCtx, epoch: 2 }, { ...wrapCtx, recipientDeviceId: 12 }]) {
    await problem(unwrapServerKey(envelope, d.privateKey, bad), 'cannot_open')
  }
})

test('a changed or cut-short envelope is refused, and the same key wrapped twice looks different', async () => {
  const d = await generateDeviceKeys()
  const key = newServerKey()
  const a = await wrapServerKey(key, d.publicKey, wrapCtx)
  const b = await wrapServerKey(key, d.publicKey, wrapCtx)
  assert.notEqual(a, b)
  const bytes = fromB64u(a)
  for (const i of [0, 40, 70, bytes.length - 1]) {
    const bent = new Uint8Array(bytes)
    bent[i] ^= 1
    await problem(unwrapServerKey(toB64u(bent), d.privateKey, wrapCtx), 'cannot_open')
  }
  await problem(unwrapServerKey(toB64u(bytes.subarray(0, bytes.length - 1)), d.privateKey, wrapCtx), 'cannot_open')
  await problem(unwrapServerKey('not base64 at all!', d.privateKey, wrapCtx), 'cannot_open')
})

test('an envelope has the size and alphabet the server accepts', async () => {
  const d = await generateDeviceKeys()
  const envelope = await wrapServerKey(newServerKey(), d.publicKey, wrapCtx)
  assert.ok(envelope.length >= 40 && envelope.length <= 1024)
  assert.match(envelope, /^[A-Za-z0-9_-]+$/)
  await problem(wrapServerKey(new Uint8Array(16), d.publicKey, wrapCtx), 'bad_key')
})

test('sealed text opens to exactly what was written, including other scripts and emoji', async () => {
  const key = newServerKey()
  for (const text of ['hello', '  spaces kept  ', 'línea\nnueva', '日本語のメッセージ', 'a'.repeat(2000), '\u{1F9EA}'.repeat(50), '{"v":1,"t":"looks like json"}']) {
    const sealed = await sealMessage(key, space, text)
    assert.match(sealed, SERVER_ENVELOPE)
    assert.equal(messageEpoch(sealed), 1)
    assert.equal(await openMessage(key, space, sealed), text)
  }
})

test('the ciphertext does not contain the text, and sealing the same text twice differs', async () => {
  const key = newServerKey()
  const a = await sealMessage(key, space, 'attack at dawn')
  const b = await sealMessage(key, space, 'attack at dawn')
  assert.notEqual(a, b)
  assert.ok(!a.includes('attack'))
  assert.ok(!Buffer.from(a.split('.')[3], 'base64url').toString('latin1').includes('attack'))
})

test('a message only opens for its own author, space, server and key', async () => {
  const key = newServerKey()
  const sealed = await sealMessage(key, space, 'private')
  await problem(openMessage(newServerKey(), space, sealed), 'cannot_open')
  for (const bad of [{ authorId: 6 }, { spaceId: 4 }, { type: 'room' }, { serverId: 8 }]) {
    await problem(openMessage(key, { ...space, ...bad }, sealed), 'cannot_open')
  }
})

test('changing any part of a sealed message, or its epoch, stops it opening', async () => {
  const key = newServerKey()
  const sealed = await sealMessage(key, space, 'private')
  const [tag, epoch, nonce, body] = sealed.split('.')
  const flip = (s, i) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1)
  for (const bent of [`${tag}.2.${nonce}.${body}`, `${tag}.${epoch}.${flip(nonce, 3)}.${body}`, `${tag}.${epoch}.${nonce}.${flip(body, 5)}`, `${tag}.${epoch}.${nonce}.${body.slice(0, -2)}`]) {
    await problem(openMessage(key, space, bent), 'cannot_open')
  }
  for (const notOne of ['hello', '', 'rl1.1.x.y', null, undefined, 12]) {
    await problem(openMessage(key, space, notOne), 'cannot_open')
    assert.equal(messageEpoch(notOne), null)
  }
})

test('keys of different epochs are different keys', async () => {
  const key = newServerKey()
  const one = await sealMessage(key, { ...space, epoch: 1 }, 'x')
  // the same ciphertext relabelled as epoch 2 must not open: the epoch is part of the derived key
  const relabelled = one.replace('rl1.1.', 'rl1.2.')
  await problem(openMessage(key, space, relabelled), 'cannot_open')
})

test('empty text and text over the limit are refused before anything is sealed', async () => {
  const key = newServerKey()
  await problem(sealMessage(key, space, ''), 'empty')
  await problem(sealMessage(key, space, '   '), 'empty')
  await problem(sealMessage(key, space, 'x'.repeat(MAX_PLAINTEXT_BYTES)), 'too_long')
  const biggest = await sealMessage(key, space, 'x'.repeat(MAX_PLAINTEXT_BYTES - 20))
  assert.ok(biggest.length <= 12000, 'the biggest allowed message fits the server limit, was ' + biggest.length)
  // 4000 four-byte characters is more than the allowed size too
  await problem(sealMessage(key, space, '\u{1F9EA}'.repeat(4000)), 'too_long')
})

test('the voice key is 32 bytes, repeatable, and different per space, server and epoch', async () => {
  const key = newServerKey()
  const base = { serverId: 7, type: 'room', spaceId: 3, epoch: 1 }
  const a = new Uint8Array(await deriveVoiceKey(key, base))
  assert.equal(a.length, 32)
  assert.deepEqual(new Uint8Array(await deriveVoiceKey(key, base)), a)
  for (const change of [{ spaceId: 4 }, { type: 'channel' }, { serverId: 8 }, { epoch: 2 }]) {
    assert.notDeepEqual(new Uint8Array(await deriveVoiceKey(key, { ...base, ...change })), a)
  }
  assert.notDeepEqual(new Uint8Array(await deriveVoiceKey(newServerKey(), base)), a)
})
