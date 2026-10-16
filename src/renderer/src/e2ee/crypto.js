// End-to-end encryption primitives. Pure WebCrypto (P-256 ECDH, HKDF-SHA256, AES-256-GCM), the same in the
// Electron renderer and in Node, so the tests run the real code. Nothing here talks to the server or stores
// anything; see keys.js for that. The design is in the Rushlight roadmap ("End-to-end encryption design").
//
//   device key   one P-256 pair per computer. The private half is a non-extractable CryptoKey.
//   server key   32 random bytes per server per epoch. Never leaves the clients in the clear: it is wrapped
//                (ECIES: ephemeral ECDH + HKDF + AES-GCM) to each member device and the server holds the wraps.
//   space key    derived from the server key for one channel or room, so a new space needs no key exchange.
//   message      rl1.<epoch>.<nonce>.<ciphertext>, the server's required shape (Rushlight-Server src/e2ee.js).

const subtle = globalThis.crypto.subtle
const enc = new TextEncoder()
const dec = new TextDecoder()

export const WRAP_VERSION = 'rushlight-wrap-v1'
const SALT = enc.encode('rushlight-e2ee-v1')
// The server accepts up to 12000 characters of envelope; this is the most plaintext that still fits.
export const MAX_PLAINTEXT_BYTES = 8000

export class CryptoProblem extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

// --- base64url ---
export function toB64u(bytes) {
  const u8 = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function fromB64u(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text)) throw new CryptoProblem('bad_encoding', 'Not base64url')
  const s = text.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))
export const newServerKey = () => randomBytes(32)

// --- device keys ---

// A new device identity. The private key can be used but never read back out, even by this code.
export async function generateDeviceKeys() {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  const publicKey = toB64u(await subtle.exportKey('raw', pair.publicKey))
  return { privateKey: pair.privateKey, publicKey }
}

const importPublic = (b64) => subtle.importKey('raw', fromB64u(b64), { name: 'ECDH', namedCurve: 'P-256' }, false, [])

async function wrapKeyFor(sharedBits, salt, info) {
  const base = await subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey'])
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt'
  ])
}

const wrapInfo = ({ serverId, epoch, recipientDeviceId }) => `${WRAP_VERSION}|${serverId}|${epoch}|${recipientDeviceId}`

// Wraps a server key so only the holder of recipientPublicKey's private half can open it. Bound to the server,
// epoch and recipient device, so an envelope cannot be replayed for another. 65 + 12 + 48 bytes, base64url.
export async function wrapServerKey(serverKey, recipientPublicKey, ctx) {
  if (!(serverKey instanceof Uint8Array) || serverKey.length !== 32) throw new CryptoProblem('bad_key', 'A server key is 32 bytes')
  const eph = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  const ephPublic = new Uint8Array(await subtle.exportKey('raw', eph.publicKey))
  const shared = await subtle.deriveBits({ name: 'ECDH', public: await importPublic(recipientPublicKey) }, eph.privateKey, 256)
  const info = wrapInfo(ctx)
  const key = await wrapKeyFor(shared, ephPublic, info)
  const nonce = randomBytes(12)
  const sealed = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: enc.encode(info) }, key, serverKey))
  const out = new Uint8Array(65 + 12 + sealed.length)
  out.set(ephPublic, 0)
  out.set(nonce, 65)
  out.set(sealed, 77)
  return toB64u(out)
}

// Opens an envelope with this device's private key. Throws CryptoProblem('cannot_open') for any failure,
// whatever the cause, so a bad envelope never says more than that.
export async function unwrapServerKey(envelope, privateKey, ctx) {
  try {
    const bytes = fromB64u(envelope)
    if (bytes.length !== 65 + 12 + 48) throw new Error('size')
    const ephPublic = bytes.subarray(0, 65)
    const nonce = bytes.subarray(65, 77)
    const shared = await subtle.deriveBits(
      { name: 'ECDH', public: await subtle.importKey('raw', ephPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []) },
      privateKey,
      256
    )
    const info = wrapInfo(ctx)
    const key = await wrapKeyFor(shared, ephPublic, info)
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: enc.encode(info) }, key, bytes.subarray(77)))
  } catch {
    throw new CryptoProblem('cannot_open', 'That key was not made for this device')
  }
}

// --- keys derived from a server key ---

async function derive(serverKey, info, usage) {
  const base = await subtle.importKey('raw', serverKey, 'HKDF', false, ['deriveKey', 'deriveBits'])
  const params = { name: 'HKDF', hash: 'SHA-256', salt: SALT, info: enc.encode(info) }
  if (usage === 'bits') return subtle.deriveBits(params, base, 256)
  return subtle.deriveKey(params, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
const spaceInfo = (purpose, { serverId, type, spaceId, epoch }) => `${purpose}|${serverId}|${type}|${spaceId}|${epoch}`

// The chat key of one channel or room in one epoch.
export const deriveSpaceKey = (serverKey, space) => derive(serverKey, spaceInfo('space', space), 'key')

// The 32 bytes handed to LiveKit's ExternalE2EEKeyProvider for a voice space (used by the voice step).
export const deriveVoiceKey = (serverKey, space) => derive(serverKey, spaceInfo('voice', space), 'bits')

// --- messages ---

const messageAad = ({ serverId, type, spaceId, epoch, authorId }) => enc.encode(`rl1|${serverId}|${type}|${spaceId}|${epoch}|${authorId}`)

// Seals chat text. The author, space and epoch are authenticated, so the server cannot present the same
// ciphertext as another person's, or in another space.
export async function sealMessage(serverKey, ctx, text) {
  if (typeof text !== 'string' || !text.trim()) throw new CryptoProblem('empty', 'Message text is required')
  const plain = enc.encode(JSON.stringify({ v: 1, t: text }))
  if (plain.length > MAX_PLAINTEXT_BYTES) throw new CryptoProblem('too_long', 'Message is too long')
  const key = await deriveSpaceKey(serverKey, ctx)
  const nonce = randomBytes(12)
  const sealed = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: messageAad(ctx) }, key, plain))
  return `rl1.${ctx.epoch}.${toB64u(nonce)}.${toB64u(sealed)}`
}

const ENVELOPE = /^rl1\.(\d{1,9})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22,})$/
export function messageEpoch(text) {
  const m = typeof text === 'string' ? ENVELOPE.exec(text) : null
  return m ? Number(m[1]) : null
}

// Opens chat text. Returns the string, or throws CryptoProblem('cannot_open'): wrong key, wrong author or
// space, or altered. ctx.epoch is taken from the message itself.
export async function openMessage(serverKey, ctx, text) {
  const m = typeof text === 'string' ? ENVELOPE.exec(text) : null
  if (!m) throw new CryptoProblem('cannot_open', 'Not an encrypted message')
  const full = { ...ctx, epoch: Number(m[1]) }
  try {
    const key = await deriveSpaceKey(serverKey, full)
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64u(m[2]), additionalData: messageAad(full) }, key, fromB64u(m[3]))
    const body = JSON.parse(dec.decode(plain))
    if (!body || body.v !== 1 || typeof body.t !== 'string') throw new Error('shape')
    return body.t
  } catch {
    throw new CryptoProblem('cannot_open', 'This message could not be opened')
  }
}
