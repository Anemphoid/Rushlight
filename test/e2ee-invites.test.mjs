// Invites that carry keys: the code's secret half, the sealed package and who it opens for, the voice-key hierarchy that
// lets one small package cover a channel and all its rooms, adding a newer epoch to a package, and the whole thing
// against a real server (a member who joins with an invite can read at once; a guest gets the keys of a room and
// follows a key change). Real crypto, real server process (needs server v0.16.0).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, installBridge, openServerDb, rejection } from './helpers.mjs'
import {
  CryptoProblem,
  newServerKey,
  newCodeSecret,
  normalizeCodeSecret,
  formatCodeSecret,
  joinFullCode,
  splitFullCode,
  sealCodePackage,
  openCodePackage,
  packagePayload,
  sealCodeSecret,
  openCodeSecret,
  deriveVoiceKey,
  deriveChannelVoiceBase,
  deriveVoiceKeyFromBase,
  CODE_SECRET_LENGTH
} from '../src/renderer/src/e2ee/crypto.js'
import { makeInvite, refreshedInvite, secretOfInvite, voiceKeysFromPackage } from '../src/renderer/src/e2ee/invites.js'
import { createKeyManager } from '../src/renderer/src/e2ee/keys.js'
import { memoryStore } from '../src/renderer/src/e2ee/keystore.js'

const same = (a, b) => assert.deepEqual(new Uint8Array(a), new Uint8Array(b))
const problem = async (promise, code) => {
  const err = await rejection(promise)
  assert.ok(err instanceof CryptoProblem, String(err))
  assert.equal(err.code, code)
}

// --- the secret half ---
test('a secret is 25 characters of an alphabet without look-alikes, and different every time', () => {
  const a = newCodeSecret()
  assert.equal(a.length, CODE_SECRET_LENGTH)
  assert.match(a, /^[0-9A-HJKMNP-TV-Z]+$/)
  assert.notEqual(a, newCodeSecret())
})

test('a secret typed any reasonable way is read as the same secret, and wrong ones are refused', () => {
  const s = newCodeSecret()
  const shown = formatCodeSecret(s)
  assert.match(shown, /^(\w{5}-){4}\w{5}$/)
  for (const typed of [shown, shown.toLowerCase(), shown.replace(/-/g, ' '), shown.replace(/-/g, ''), '  ' + shown + '  ']) assert.equal(normalizeCodeSecret(typed), s)
  // O is read as 0, and I or L as 1: a person cannot tell them apart in a typeface
  assert.equal(normalizeCodeSecret('O'.repeat(25)), '0'.repeat(25))
  assert.equal(normalizeCodeSecret('IL'.repeat(12) + 'I'), '1'.repeat(25))
  for (const bad of ['', 'short', 'U'.repeat(25), shown + 'A', shown.slice(0, -1), null, undefined, 12]) assert.equal(normalizeCodeSecret(bad), null, String(bad))
})

test('the full invite is the visible code, a dot and the secret, and is split back the same', () => {
  const s = newCodeSecret()
  const full = joinFullCode('amber-fox-1234', s)
  assert.match(full, /^amber-fox-1234\.(\w{5}-){4}\w{5}$/)
  assert.deepEqual(splitFullCode(full), { code: 'amber-fox-1234', secret: s, hadDot: true })
  assert.deepEqual(splitFullCode('  ' + full.toLowerCase() + ' '), { code: 'amber-fox-1234', secret: s, hadDot: true })
  assert.deepEqual(splitFullCode('amber-fox-1234'), { code: 'amber-fox-1234', secret: null, hadDot: false })
  assert.deepEqual(splitFullCode('amber-fox-1234.nonsense'), { code: 'amber-fox-1234', secret: null, hadDot: true })
  assert.deepEqual(splitFullCode(''), { code: '', secret: null, hadDot: false })
})

// --- the sealed package ---
const pkgBody = { kind: 'server', keys: new Map([[1, new Uint8Array(32).fill(1)], [2, new Uint8Array(32).fill(2)]]) }

test('a package opens only with its own secret and its own server, and tampering is refused', async () => {
  const secret = newCodeSecret()
  const text = await sealCodePackage(secret, 7, packagePayload(pkgBody))
  assert.match(text, /^rlp1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/)
  const opened = await openCodePackage(secret, 7, text)
  assert.equal(opened.kind, 'server')
  same(opened.keys.get(2), new Uint8Array(32).fill(2))
  await problem(openCodePackage(newCodeSecret(), 7, text), 'cannot_open')
  await problem(openCodePackage(secret, 8, text), 'cannot_open')
  const [tag, nonce, body] = text.split('.')
  const flip = (t, i) => t.slice(0, i) + (t[i] === 'A' ? 'B' : 'A') + t.slice(i + 1)
  for (const bent of [`${tag}.${flip(nonce, 2)}.${body}`, `${tag}.${nonce}.${flip(body, 9)}`, `${tag}.${nonce}.${body.slice(0, -3)}`, 'nonsense', '', null]) await problem(openCodePackage(secret, 7, bent), 'cannot_open')
  assert.ok(!Buffer.from(body, 'base64url').toString('latin1').includes('server'), 'the kind is not readable in what the server stores')
})

test('a package that is not shaped right is refused whole, whatever it is sealed under', async () => {
  const secret = newCodeSecret()
  const k = Buffer.alloc(32, 3).toString('base64url')
  for (const payload of [
    { kind: 'galaxy', keys: { 1: k } },
    { kind: 'server', keys: { 1: 'short' } },
    { kind: 'server', keys: { zero: k } },
    { kind: 'server', keys: { 0: k } },
    { kind: 'server', keys: 'nope' },
    { kind: 'channel', keys: { 1: k } }, // no channel
    { kind: 'room', channelId: 3, keys: { 1: k } } // no room
  ]) await problem(openCodePackage(secret, 7, await sealCodePackage(secret, 7, payload)), 'cannot_open')
})

test('the secret is sealed to a server key and opens only with that key, that server and that epoch', async () => {
  const key = newServerKey()
  const secret = newCodeSecret()
  const text = await sealCodeSecret(key, { serverId: 7, epoch: 3 }, secret)
  assert.match(text, /^rlc1\.3\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/)
  assert.equal(await openCodeSecret(key, 7, text), secret)
  await problem(openCodeSecret(newServerKey(), 7, text), 'cannot_open')
  await problem(openCodeSecret(key, 8, text), 'cannot_open')
  await problem(openCodeSecret(key, 7, text.replace('rlc1.3.', 'rlc1.4.')), 'cannot_open')
  await problem(openCodeSecret(key, 7, 'nope'), 'cannot_open')
})

// --- the voice-key hierarchy ---
test('a room\'s voice key is derived from its channel\'s base key, and a base opens that channel only', async () => {
  const key = newServerKey()
  const ctx = { serverId: 7, type: 'room', spaceId: 11, channelId: 3, epoch: 1 }
  const base = await deriveChannelVoiceBase(key, { serverId: 7, channelId: 3, epoch: 1 })
  same(await deriveVoiceKeyFromBase(base, ctx), await deriveVoiceKey(key, ctx))
  // the channel's own key too
  same(await deriveVoiceKeyFromBase(base, { serverId: 7, type: 'channel', spaceId: 3, epoch: 1 }), await deriveVoiceKey(key, { serverId: 7, type: 'channel', spaceId: 3, epoch: 1 }))
  // another channel's base gives other keys
  const other = await deriveChannelVoiceBase(key, { serverId: 7, channelId: 4, epoch: 1 })
  assert.notDeepEqual(new Uint8Array(await deriveVoiceKeyFromBase(other, ctx)), new Uint8Array(await deriveVoiceKey(key, ctx)))
  await problem(deriveVoiceKey(key, { serverId: 7, type: 'room', spaceId: 11, epoch: 1 }), 'bad_space') // a room must say its channel
})

// --- making an invite, and what it opens for ---
const keysMap = () => new Map([[1, newServerKey()], [2, newServerKey()]])
const space = (type, id, channelId) => ({ type, id, channelId })

test('a whole-server invite carries the server keys, and a guest with it can derive any room\'s voice key', async () => {
  const keys = keysMap()
  const inv = await makeInvite(7, keys, null)
  assert.equal(inv.body.epoch, 2)
  const pkg = await openCodePackage(inv.secret, 7, inv.body.package)
  assert.equal(pkg.kind, 'server')
  for (const [e, k] of keys) same(pkg.keys.get(e), k)
  for (const sp of [space('channel', 3), space('room', 11, 3), space('room', 12, 4)]) {
    const got = await voiceKeysFromPackage(7, pkg, sp)
    assert.deepEqual(got.map((k) => k.epoch), [1, 2])
    same(got[1].bytes, await deriveVoiceKey(keys.get(2), { serverId: 7, type: sp.type, spaceId: sp.id, channelId: sp.type === 'channel' ? sp.id : sp.channelId, epoch: 2 }))
  }
})

test('a channel invite holds a base key and opens that channel and every room in it, and nothing else', async () => {
  const keys = keysMap()
  const inv = await makeInvite(7, keys, { type: 'channel', id: 3 })
  const pkg = await openCodePackage(inv.secret, 7, inv.body.package)
  assert.equal(pkg.kind, 'channel')
  assert.equal(pkg.channelId, 3)
  for (const sp of [space('channel', 3), space('room', 11, 3), space('room', 999, 3)]) {
    const got = await voiceKeysFromPackage(7, pkg, sp)
    assert.deepEqual(got.map((k) => k.epoch), [1, 2], `${sp.type} ${sp.id}: a room made later is covered too`)
    for (const k of got) {
      same(k.bytes, await deriveVoiceKey(keys.get(k.epoch), { serverId: 7, type: sp.type, spaceId: sp.id, channelId: sp.type === 'channel' ? sp.id : sp.channelId, epoch: k.epoch }))
    }
  }
  // it is the same key the members use
  same((await voiceKeysFromPackage(7, pkg, space('room', 11, 3)))[0].bytes, await deriveVoiceKey(keys.get(1), { serverId: 7, type: 'room', spaceId: 11, channelId: 3, epoch: 1 }))
  // and no key for other channels' voice, nor a server key to derive chat from
  for (const sp of [space('channel', 4), space('room', 12, 4)]) assert.deepEqual(await voiceKeysFromPackage(7, pkg, sp), [])
  assert.equal(pkg.keys.get(1).length, 32)
  assert.notDeepEqual(new Uint8Array(pkg.keys.get(1)), new Uint8Array(keys.get(1)), 'what it holds is not the server key')
})

test('a room invite holds that room\'s voice keys and opens that room only', async () => {
  const keys = keysMap()
  const inv = await makeInvite(7, keys, { type: 'room', id: 11, channelId: 3 })
  const pkg = await openCodePackage(inv.secret, 7, inv.body.package)
  assert.equal(pkg.kind, 'room')
  const got = await voiceKeysFromPackage(7, pkg, space('room', 11, 3))
  assert.equal(got.length, 2)
  same(got[0].bytes, await deriveVoiceKey(keys.get(1), { serverId: 7, type: 'room', spaceId: 11, channelId: 3, epoch: 1 }))
  for (const sp of [space('room', 12, 3), space('room', 13, 3), space('channel', 3)]) assert.deepEqual(await voiceKeysFromPackage(7, pkg, sp), [])
})

test('an invite holds at most the newest eight epochs, and cannot be made without a key', async () => {
  const many = new Map()
  for (let e = 1; e <= 11; e++) many.set(e, newServerKey())
  const inv = await makeInvite(7, many, null)
  assert.equal(inv.body.epoch, 11)
  assert.deepEqual([...(await openCodePackage(inv.secret, 7, inv.body.package)).keys.keys()].sort((a, b) => a - b), [4, 5, 6, 7, 8, 9, 10, 11])
  await problem(makeInvite(7, new Map(), null), 'no_key')
})

test('the secret half is recoverable from the list by anyone holding that epoch\'s key, and by no one else', async () => {
  const keys = keysMap()
  const inv = await makeInvite(7, keys, null)
  const row = { id: 1, code: 'amber-fox-1234', e2ee: { ...inv.body, version: 0 } }
  assert.equal(await secretOfInvite(7, keys, row), inv.secret)
  assert.equal(await secretOfInvite(7, new Map([[2, keys.get(2)]]), row), inv.secret, 'only the newest epoch\'s key is needed')
  assert.equal(await secretOfInvite(7, new Map([[1, keys.get(1)]]), row), null)
  assert.equal(await secretOfInvite(7, new Map([[2, newServerKey()]]), row), null)
  assert.equal(await secretOfInvite(7, keys, { id: 2, code: 'x', e2ee: null }), null)
})

test('a newer epoch is added to a package, keeping the old ones, for whichever kind it is', async () => {
  for (const scope of [null, { type: 'channel', id: 3 }, { type: 'room', id: 11, channelId: 3 }]) {
    const keys = new Map([[1, newServerKey()]])
    const inv = await makeInvite(7, keys, scope)
    const row = { id: 1, code: 'c', e2ee: { ...inv.body, version: 4 } }
    assert.equal(await refreshedInvite(7, keys, row), null, 'nothing to add yet')
    keys.set(2, newServerKey())
    const next = await refreshedInvite(7, keys, row)
    assert.equal(next.epoch, 2)
    assert.equal(next.version, 4, 'the version it read, for the server to compare')
    const pkg = await openCodePackage(inv.secret, 7, next.package)
    assert.deepEqual([...pkg.keys.keys()], [1, 2])
    // the guest derives the same voice keys the members will use for epoch 2
    const sp = scope && scope.type === 'room' ? space('room', 11, 3) : scope ? space('room', 50, 3) : space('room', 11, 3)
    const got = await voiceKeysFromPackage(7, pkg, sp)
    same(got[1].bytes, await deriveVoiceKey(keys.get(2), { serverId: 7, type: 'room', spaceId: sp.id, channelId: 3, epoch: 2 }))
  }
})

test('adding a newer epoch keeps the older ones the package already holds, even ones this computer does not have', async () => {
  const all = new Map([[1, newServerKey()], [2, newServerKey()]])
  const inv = await makeInvite(7, all, null)
  // an admin's computer that holds epoch 2 (which opens the secret) and epoch 3, but not epoch 1
  const admin = new Map([[2, all.get(2)], [3, newServerKey()]])
  const next = await refreshedInvite(7, admin, { id: 1, code: 'c', e2ee: { ...inv.body, version: 0 } })
  assert.deepEqual([...(await openCodePackage(inv.secret, 7, next.package)).keys.keys()].sort((a, b) => a - b), [1, 2, 3])
})

test('an invite this computer cannot open is left alone when a newer epoch arrives', async () => {
  const keys = new Map([[1, newServerKey()]])
  const inv = await makeInvite(7, keys, null)
  const row = { id: 1, code: 'c', e2ee: { ...inv.body, version: 0 } }
  const other = new Map([[1, newServerKey()], [2, newServerKey()]]) // a computer that does not hold epoch 1's real key
  assert.equal(await refreshedInvite(7, other, row), null)
  assert.equal(await refreshedInvite(7, keys, { id: 3, code: 'c', e2ee: null }), null)
})

test('refreshing keeps only the newest eight epochs', async () => {
  const keys = new Map()
  for (let e = 1; e <= 8; e++) keys.set(e, newServerKey())
  const inv = await makeInvite(7, keys, null)
  keys.set(9, newServerKey())
  const next = await refreshedInvite(7, keys, { id: 1, code: 'c', e2ee: { ...inv.body, version: 0 } })
  assert.deepEqual([...(await openCodePackage(inv.secret, 7, next.package)).keys.keys()].sort((a, b) => a - b), [2, 3, 4, 5, 6, 7, 8, 9])
})

// --- against a real server ---
let srv
let api
let session
let counter = 0
before(async () => {
  srv = await startServer({ ACCOUNT_LIMIT: '1000', DEVICE_LIMIT: '1000' })
  installBridge(srv.url, { version: '0.26.0' })
  api = await import('../src/renderer/src/api.js')
  await api.getMe('x').catch(() => {})
  session = await import('../src/renderer/src/e2eeSession.js')
})
after(async () => {
  if (srv) await srv.stop()
})

async function world() {
  const owner = await api.register(`invowner${++counter}x`, 'password123')
  const server = await api.createServer(owner.token, 'Inv')
  const lounge = await api.createChannel(owner.token, server.id, { name: 'Lounge', mode: 'both', persistent: true })
  const side = await api.createRoom(owner.token, server.id, lounge.id, { name: 'Side', mode: 'both', persistent: false })
  const db = openServerDb(srv.dbPath)
  db.prepare('UPDATE servers SET e2ee_enabled = 1 WHERE id = ?').run(server.id)
  db.close()
  const mgr = (a) => createKeyManager({ api, store: memoryStore(), scope: `${srv.url}|${a.id}` })
  const A = mgr(owner)
  await A.ensureDevice(owner.token)
  await A.startEpoch(owner.token, server.id)
  return { owner, server, lounge, side, A, mgr }
}
const mkInvite = async (w, scope, options = {}) => {
  const inv = await w.A.createInvite(w.server.id, scope)
  const row = await api.createServerCode(w.owner.token, w.server.id, { singleUse: false, expiresInMinutes: null, ...(scope ? { scope: { type: scope.type, id: scope.id } } : {}), ...options, e2ee: inv.body })
  return { ...row, secret: inv.secret, full: joinFullCode(row.code, inv.secret) }
}

test('a member who joins with an invite can read what is already there at once, with no other member online', async () => {
  const w = await world()
  const sealed = await w.A.seal(w.server.id, { type: 'channel', spaceId: w.lounge.id, authorId: w.owner.id }, 'before you came')
  await api.postMessage(w.owner.token, 'channel', w.lounge.id, { text: sealed })
  const invite = await mkInvite(w, null)
  const member = await api.register(`invmember${++counter}x`, 'password123')
  const { code, secret } = splitFullCode(invite.full)
  const joined = await api.joinServerWithCode(member.token, code)
  assert.equal(joined.e2ee.enabled, true)
  const B = w.mgr(member)
  await B.ensureDevice(member.token)
  assert.equal(await B.takeInvite(joined.id, secret, joined.e2ee.package), 1)
  const [m] = await api.getMessages(member.token, 'channel', w.lounge.id)
  assert.equal(await B.open(w.server.id, { type: 'channel', spaceId: w.lounge.id, authorId: m.authorId }, m.text), 'before you came')
  // handing the same invite's keys over twice changes nothing
  assert.equal(await B.takeInvite(joined.id, secret, joined.e2ee.package), 0)
  // the wrong secret gives nothing
  const C = w.mgr(await api.register(`invmember${++counter}x`, 'password123'))
  await problem(C.takeInvite(joined.id, newCodeSecret(), joined.e2ee.package), 'cannot_open')
})

test('an admin sees the full invite in the list, and a guest gets the keys of just the room it was made for', async () => {
  const w = await world()
  const invite = await mkInvite(w, { type: 'room', id: w.side.id, channelId: w.lounge.id })
  const { codes } = await api.listServerCodes(w.owner.token, w.server.id)
  assert.equal(await w.A.fullInvite(w.server.id, codes.find((c) => c.id === invite.id)), invite.full, 'any admin can list the shareable invite')

  const { code, secret } = splitFullCode(invite.full)
  const g = await api.joinWithCode(code, 'Visitor')
  assert.equal(g.server.e2ee.enabled, true)
  await session.setGuestInvite({ serverId: g.server.id, secret, packageText: g.server.e2ee.package })
  const token = await api.getVoiceToken(g.guestToken, 'room', w.side.id)
  assert.equal(token.encrypted, true)
  const mine = await session.guestVoiceKeys({ type: 'room', id: w.side.id, channelId: w.lounge.id }, token.epoch)
  assert.deepEqual(mine.map((k) => k.epoch), [1])
  const members = await w.A.voiceKeys(w.server.id, { type: 'room', spaceId: w.side.id, channelId: w.lounge.id })
  same(mine[0].bytes, members[0].bytes)
  // not the channel's voice, and nothing at all with the wrong secret
  assert.deepEqual(await session.guestVoiceKeys({ type: 'channel', id: w.lounge.id }, token.epoch), [])
  await problem(session.setGuestInvite({ serverId: g.server.id, secret: newCodeSecret(), packageText: g.server.e2ee.package }), 'cannot_open')
  // a guest holding keys of an older epoch than the room's is treated as holding none
  assert.deepEqual(await session.guestVoiceKeys({ type: 'room', id: w.side.id, channelId: w.lounge.id }, 2), [])
})

test('after a key change an admin\'s app brings the invites up to date and a guest picks up the new keys', async () => {
  const w = await world()
  const invite = await mkInvite(w, { type: 'channel', id: w.lounge.id })
  const { code, secret } = splitFullCode(invite.full)
  const g = await api.joinWithCode(code, 'Visitor')
  await session.setGuestInvite({ serverId: g.server.id, secret, packageText: g.server.e2ee.package })
  assert.equal(await session.refreshGuest(g.guestToken), false, 'nothing new yet')

  // someone is removed: a new key
  const other = await api.register(`invgone${++counter}x`, 'password123')
  const plain = await api.createServerCode(w.owner.token, w.server.id, { singleUse: false, expiresInMinutes: null, e2ee: (await w.A.createInvite(w.server.id, null)).body })
  await api.joinServerWithCode(other.token, plain.code)
  await api.kickMember(w.owner.token, w.server.id, other.id)
  await w.A.startEpoch(w.owner.token, w.server.id)

  const { codes } = await api.listServerCodes(w.owner.token, w.server.id)
  assert.equal(await w.A.refreshInvites(w.owner.token, w.server.id, codes), codes.filter((c) => c.e2ee).length)
  assert.equal(await session.refreshGuest(g.guestToken), true, 'the guest holds the new epoch now')
  const keys = await session.guestVoiceKeys({ type: 'room', id: w.side.id, channelId: w.lounge.id }, 2)
  assert.deepEqual(keys.map((k) => k.epoch), [1, 2])
  const members = await w.A.voiceKeys(w.server.id, { type: 'room', spaceId: w.side.id, channelId: w.lounge.id })
  same(keys[1].bytes, members[1].bytes)
  // an app that asks again with the version it read before another admin's update loses quietly
  const stale = codes.find((c) => c.id === invite.id)
  assert.equal(await w.A.refreshInvites(w.owner.token, w.server.id, [{ ...stale, e2ee: { ...stale.e2ee, version: 0, epoch: 1 } }]), 0)
})

test('an invite made before encryption cannot bring a guest in, and a missing secret half is not guessable', async () => {
  const w = await world()
  const db = openServerDb(srv.dbPath)
  db.prepare("INSERT INTO join_codes (code, server_id, created_by, persistent, single_use, created_at) VALUES ('old-code-9999', ?, ?, 0, 0, ?)").run(w.server.id, w.owner.id, Date.now())
  db.close()
  const err = await rejection(api.joinWithCode('old-code-9999', 'Visitor'))
  assert.equal(err.status, 409)
  assert.equal(err.reason, 'old_invite')
  // the code without its secret half still reaches the server, which cannot tell: the app is what refuses
  const invite = await mkInvite(w, { type: 'channel', id: w.lounge.id })
  const g = await api.joinWithCode(splitFullCode(invite.full).code, 'Visitor Two')
  assert.ok(g.server.e2ee.package, 'the server gives the sealed package to whoever presents the code')
  assert.equal(splitFullCode(invite.code).secret, null)
})
