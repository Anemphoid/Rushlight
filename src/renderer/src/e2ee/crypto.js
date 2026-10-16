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

// Voice keys are hierarchical, so one small thing can cover a whole channel. A channel has a base key (per epoch); the
// voice key of the channel itself and of every room in it, now or made later, is derived from that base. A guest invite
// for a channel carries the base, an invite for one room carries just that room's voice key, and nobody holds more
// than they need. `space` = { serverId, type: 'channel' | 'room', spaceId, channelId (of the room's channel; for a
// channel it is its own id), epoch }.
const channelOf = (space) => {
  const channelId = space.type === 'channel' ? space.spaceId : space.channelId
  if (!Number.isInteger(channelId)) throw new CryptoProblem('bad_space', 'A room needs the channel it is in')
  return channelId
}
export const deriveChannelVoiceBase = (serverKey, { serverId, channelId, epoch }) => derive(serverKey, `voicebase|${serverId}|${channelId}|${epoch}`, 'bits')
export const deriveVoiceKeyFromBase = (base, space) => derive(new Uint8Array(base), spaceInfo('voice', space), 'bits')

// The 32 bytes handed to LiveKit's key provider for a voice space (the voice step).
export async function deriveVoiceKey(serverKey, space) {
  const base = await deriveChannelVoiceBase(serverKey, { serverId: space.serverId, channelId: channelOf(space), epoch: space.epoch })
  return deriveVoiceKeyFromBase(base, space)
}

// --- messages ---

const messageAad = ({ serverId, type, spaceId, epoch, authorId }) => enc.encode(`rl1|${serverId}|${type}|${spaceId}|${epoch}|${authorId}`)

// Seals a message body. `payload` is { t: text, img?: {...} }; the author, space and epoch are authenticated, so
// the server cannot present the same ciphertext as another person's, or in another space.
async function sealPayload(serverKey, ctx, payload) {
  const plain = enc.encode(JSON.stringify({ v: 1, ...payload }))
  if (plain.length > MAX_PLAINTEXT_BYTES) throw new CryptoProblem('too_long', 'Message is too long')
  const key = await deriveSpaceKey(serverKey, ctx)
  const nonce = randomBytes(12)
  const sealed = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: messageAad(ctx) }, key, plain))
  return `rl1.${ctx.epoch}.${toB64u(nonce)}.${toB64u(sealed)}`
}

// Seals chat text.
export async function sealMessage(serverKey, ctx, text) {
  if (typeof text !== 'string' || !text.trim()) throw new CryptoProblem('empty', 'Message text is required')
  return sealPayload(serverKey, ctx, { t: text })
}

const ENVELOPE = /^rl1\.(\d{1,9})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22,})$/
export function messageEpoch(text) {
  const m = typeof text === 'string' ? ENVELOPE.exec(text) : null
  return m ? Number(m[1]) : null
}

// Opens a message body: { t, img? }. Throws CryptoProblem('cannot_open'): wrong key, wrong author or space, or
// altered. ctx.epoch is taken from the message itself.
export async function openPayload(serverKey, ctx, text) {
  const m = typeof text === 'string' ? ENVELOPE.exec(text) : null
  if (!m) throw new CryptoProblem('cannot_open', 'Not an encrypted message')
  const full = { ...ctx, epoch: Number(m[1]) }
  try {
    const key = await deriveSpaceKey(serverKey, full)
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64u(m[2]), additionalData: messageAad(full) }, key, fromB64u(m[3]))
    const body = JSON.parse(dec.decode(plain))
    if (!body || body.v !== 1 || typeof body.t !== 'string') throw new Error('shape')
    return body
  } catch {
    throw new CryptoProblem('cannot_open', 'This message could not be opened')
  }
}

// Opens chat text: the string.
export async function openMessage(serverKey, ctx, text) {
  return (await openPayload(serverKey, ctx, text)).t
}

// --- pictures ---
// A picture is sealed with a key of its own (fresh for every picture); that key, its type and its shape travel
// inside the sealed message text, so only people who can open the message can open the picture, and the server
// can neither swap one picture for another nor learn what it is. The upload is one body (Rushlight-Server
// src/e2ee.js): 4 bytes length of the message text, the message text, then nonce (12) + ciphertext + tag (16).
export const PICTURE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const PICTURE_AAD = enc.encode('rl1img')
const MAX_SIDE_VALUE = 20000

// Returns the body to upload. `info` = { mime, width, height }; the caption may be empty.
export async function sealPicture(serverKey, ctx, bytes, info, caption = '') {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new CryptoProblem('empty', 'No picture')
  if (!PICTURE_TYPES.includes(info.mime)) throw new CryptoProblem('bad_picture', "That kind of picture can't be sent")
  const pictureKey = randomBytes(32)
  const nonce = randomBytes(12)
  const key = await subtle.importKey('raw', pictureKey, 'AES-GCM', false, ['encrypt'])
  const sealed = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: PICTURE_AAD }, key, bytes))
  const text = await sealPayload(serverKey, ctx, {
    t: caption,
    img: { m: info.mime, w: info.width, h: info.height, k: toB64u(pictureKey), n: bytes.length }
  })
  const textBytes = enc.encode(text)
  const out = new Uint8Array(4 + textBytes.length + 12 + sealed.length)
  new DataView(out.buffer).setUint32(0, textBytes.length)
  out.set(textBytes, 4)
  out.set(nonce, 4 + textBytes.length)
  out.set(sealed, 4 + textBytes.length + 12)
  return out
}

// What a message says about its picture, once opened: { mime, width, height, key }, or null if it says nothing
// usable (so a bad or hostile message can never make the app fetch or draw something odd).
export function pictureInfo(payload) {
  const i = payload && payload.img
  if (!i || !PICTURE_TYPES.includes(i.m)) return null
  const ok = (v) => Number.isInteger(v) && v >= 1 && v <= MAX_SIDE_VALUE
  if (!ok(i.w) || !ok(i.h) || typeof i.k !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(i.k)) return null
  return { mime: i.m, width: i.w, height: i.h, key: i.k }
}

// Opens the bytes the server returns for a sealed picture. Throws CryptoProblem('cannot_open').
export async function openPicture(sealedBytes, pictureKey) {
  try {
    const bytes = sealedBytes instanceof Uint8Array ? sealedBytes : new Uint8Array(sealedBytes)
    if (bytes.length < 12 + 16 + 1) throw new Error('size')
    const key = await subtle.importKey('raw', fromB64u(pictureKey), 'AES-GCM', false, ['decrypt'])
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: PICTURE_AAD }, key, bytes.subarray(12)))
  } catch {
    throw new CryptoProblem('cannot_open', 'This picture could not be opened')
  }
}

// --- invites that carry keys ---
// An invite to an encrypted server is the visible code (which the server knows) plus a secret half (which it never
// sees). The keys a joiner needs are sealed under the secret into a package the server stores; the secret itself is
// sealed to the server key, so any admin's app can show the full invite and add the keys of a newer epoch. See the
// server's src/e2ee.js. The secret is 25 characters of Crockford base32 (125 bits), written in groups of five.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const CODE_SECRET_LENGTH = 25

export function newCodeSecret() {
  const r = randomBytes(CODE_SECRET_LENGTH)
  let out = ''
  for (let i = 0; i < CODE_SECRET_LENGTH; i++) out += B32[r[i] & 31]
  return out
}

// What a person typed, to the secret it stands for: upper case, dashes and spaces ignored, and the letters that look
// like digits read as digits (O is 0, I and L are 1). Null if it is not a secret.
export function normalizeCodeSecret(text) {
  if (typeof text !== 'string') return null
  const t = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  return t.length === CODE_SECRET_LENGTH && [...t].every((c) => B32.includes(c)) ? t : null
}
export const formatCodeSecret = (secret) => secret.match(/.{1,5}/g).join('-')

// The full invite, as it is shared: the visible code, a dot, the secret in groups.
export const joinFullCode = (code, secret) => `${code}.${formatCodeSecret(secret)}`

// A pasted or typed invite split into what goes to the server and what stays here. `secret` is null if there is no
// valid second half.
export function splitFullCode(text) {
  const t = String(text || '').trim()
  const i = t.lastIndexOf('.')
  if (i < 0) return { code: t, secret: null, hadDot: false }
  return { code: t.slice(0, i).trim(), secret: normalizeCodeSecret(t.slice(i + 1)), hadDot: true }
}

async function codeKey(material, info) {
  const base = await subtle.importKey('raw', typeof material === 'string' ? enc.encode(material) : material, 'HKDF', false, ['deriveKey'])
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('rushlight-code-v1'), info: enc.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
const packageAad = (serverId) => enc.encode(`rlp1|${serverId}`)

// payload = { v: 1, kind: 'server' | 'channel' | 'room', channelId?, roomId?, keys: { '<epoch>': base64url } }
export async function sealCodePackage(secret, serverId, payload) {
  const key = await codeKey(secret, `pkg|${serverId}`)
  const nonce = randomBytes(12)
  const sealed = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: packageAad(serverId) }, key, enc.encode(JSON.stringify({ v: 1, ...payload }))))
  return `rlp1.${toB64u(nonce)}.${toB64u(sealed)}`
}

// Opens a package with the secret half. Returns { kind, channelId, roomId, keys: Map(epoch -> bytes) } or throws
// CryptoProblem('cannot_open'). Anything that is not shaped like a package is refused whole.
export async function openCodePackage(secret, serverId, text) {
  try {
    const m = /^rlp1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22,})$/.exec(text)
    if (!m) throw new Error('shape')
    const key = await codeKey(secret, `pkg|${serverId}`)
    const body = JSON.parse(dec.decode(await subtle.decrypt({ name: 'AES-GCM', iv: fromB64u(m[1]), additionalData: packageAad(serverId) }, key, fromB64u(m[2]))))
    if (!body || body.v !== 1 || !['server', 'channel', 'room'].includes(body.kind) || !body.keys || typeof body.keys !== 'object') throw new Error('shape')
    const keys = new Map()
    for (const [epoch, value] of Object.entries(body.keys)) {
      const n = Number(epoch)
      const bytes = fromB64u(value)
      if (!Number.isInteger(n) || n < 1 || bytes.length !== 32) throw new Error('key')
      keys.set(n, bytes)
    }
    if (body.kind !== 'server' && !Number.isInteger(body.channelId)) throw new Error('shape')
    if (body.kind === 'room' && !Number.isInteger(body.roomId)) throw new Error('shape')
    return { kind: body.kind, channelId: body.channelId, roomId: body.roomId, keys }
  } catch {
    throw new CryptoProblem('cannot_open', 'This invite could not be opened')
  }
}

export const packagePayload = (pkg) => ({
  kind: pkg.kind,
  ...(pkg.channelId !== undefined ? { channelId: pkg.channelId } : {}),
  ...(pkg.roomId !== undefined ? { roomId: pkg.roomId } : {}),
  keys: Object.fromEntries([...pkg.keys].map(([e, k]) => [String(e), toB64u(k)]))
})

// The secret sealed to a server key: rlc1.<epoch>.<nonce>.<ciphertext>, which is what the server stores beside the package.
export async function sealCodeSecret(serverKey, { serverId, epoch }, secret) {
  const key = await codeKey(serverKey, `secret|${serverId}|${epoch}`)
  const nonce = randomBytes(12)
  const sealed = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: enc.encode(`rlc1|${serverId}|${epoch}`) }, key, enc.encode(secret)))
  return `rlc1.${epoch}.${toB64u(nonce)}.${toB64u(sealed)}`
}

export function codeSecretEpoch(text) {
  const m = typeof text === 'string' ? /^rlc1\.(\d{1,9})\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/.exec(text) : null
  return m ? Number(m[1]) : null
}

export async function openCodeSecret(serverKey, serverId, text) {
  try {
    const epoch = codeSecretEpoch(text)
    if (!epoch) throw new Error('shape')
    const parts = text.split('.')
    const key = await codeKey(serverKey, `secret|${serverId}|${epoch}`)
    const plain = dec.decode(await subtle.decrypt({ name: 'AES-GCM', iv: fromB64u(parts[2]), additionalData: enc.encode(`rlc1|${serverId}|${epoch}`) }, key, fromB64u(parts[3])))
    const secret = normalizeCodeSecret(plain)
    if (!secret) throw new Error('secret')
    return secret
  } catch {
    throw new CryptoProblem('cannot_open', 'This invite could not be opened')
  }
}
