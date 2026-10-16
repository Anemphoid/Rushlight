// Encryption end to end across real clients and a real server: every computer is its own key manager with its
// own store, talking through the client's real api.js to a real server process (v0.13.0 or later). The server
// has no route yet that switches a server to encrypted, so the tests do what that later step will: set the
// flag in the database. What is checked is what the server can and cannot see, and who can read what.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, installBridge, openServerDb, rejection } from './helpers.mjs'
import { createKeyManager } from '../src/renderer/src/e2ee/keys.js'
import { memoryStore } from '../src/renderer/src/e2ee/keystore.js'
import { CryptoProblem, pictureInfo, openPicture } from '../src/renderer/src/e2ee/crypto.js'

let srv
let api
let counter = 0
before(async () => {
  srv = await startServer({ ACCOUNT_LIMIT: '1000', DEVICE_LIMIT: '1000' })
  installBridge(srv.url, { version: '0.22.0' })
  api = await import('../src/renderer/src/api.js')
})
after(async () => {
  if (srv) await srv.stop()
})

const rows = (sql, ...args) => {
  const db = openServerDb(srv.dbPath)
  try {
    return db.prepare(sql).all(...args)
  } finally {
    db.close()
  }
}
const setFlag = (serverId) => {
  const db = openServerDb(srv.dbPath)
  db.prepare('UPDATE servers SET e2ee_enabled = 1 WHERE id = ?').run(serverId)
  db.close()
}

// One person on one computer.
async function person(name, store = memoryStore()) {
  const account = await api.register(`${name}${++counter}x`, 'password123')
  return computer(account, store)
}
function computer(account, store = memoryStore()) {
  return { account, token: account.token, id: account.id, store, keys: createKeyManager({ api, store, scope: `${srv.url}|${account.id}`, label: 'test computer' }) }
}

async function world() {
  const owner = await person('owner')
  const server = await api.createServer(owner.token, 'Sealed')
  const channel = await api.createChannel(owner.token, server.id, { name: 'general', mode: 'both', persistent: true })
  const code = await api.createServerCode(owner.token, server.id, { singleUse: false, expiresInMinutes: null })
  const join = async (name) => {
    const p = await person(name)
    await api.joinServerWithCode(p.token, code.code)
    return p
  }
  const member = await join('member')
  await Promise.all([owner, member].map((p) => p.keys.ensureDevice(p.token)))
  setFlag(server.id)
  return { owner, member, server, channel, join, code }
}

const where = (w) => ({ type: 'channel', spaceId: w.channel.id })
async function say(w, who, text) {
  const sealed = await who.keys.seal(w.server.id, { ...where(w), authorId: who.id }, text)
  return api.postMessage(who.token, 'channel', w.channel.id, { text: sealed })
}
async function read(w, who) {
  const messages = await api.getMessages(who.token, 'channel', w.channel.id)
  const out = []
  for (const m of messages) {
    if (m.bot) {
      out.push({ bot: true, text: m.text })
      continue
    }
    try {
      out.push({ from: m.author, text: await who.keys.open(w.server.id, { ...where(w), authorId: m.authorId }, m.text) })
    } catch (err) {
      out.push({ from: m.author, unreadable: err.code })
    }
  }
  return out
}

test('a computer registers once, and registers again if the server has dropped it', async () => {
  const p = await person('solo')
  const a = await p.keys.ensureDevice(p.token)
  assert.equal(a.privateKey.extractable, false)
  // a fresh manager over the same store finds the same device without registering another
  const again = createKeyManager({ api, store: p.store, scope: `${srv.url}|${p.id}` })
  assert.equal((await again.ensureDevice(p.token)).deviceId, a.deviceId)
  assert.equal((await api.listMyDevices(p.token)).devices.length, 1)
  // removed from another computer: the next run makes a new one
  await api.removeDevice(p.token, a.deviceId)
  const third = createKeyManager({ api, store: p.store, scope: `${srv.url}|${p.id}` })
  const b = await third.ensureDevice(p.token)
  assert.notEqual(b.deviceId, a.deviceId)
  assert.deepEqual((await api.listMyDevices(p.token)).devices.map((d) => d.id), [b.deviceId])
})

test('the first key, a message from a member, and the owner reads it; the server holds only ciphertext', async () => {
  const w = await world()
  assert.deepEqual(await w.owner.keys.startEpoch(w.owner.token, w.server.id), { epoch: 1 })
  const synced = await w.member.keys.syncKeys(w.member.token, w.server.id)
  assert.deepEqual({ epoch: synced.epoch, hasCurrent: synced.hasCurrent, epochs: synced.epochs }, { epoch: 1, hasCurrent: true, epochs: [1] })

  const sent = await say(w, w.member, 'the password is hunter2')
  assert.equal(sent.encrypted, true)
  assert.deepEqual(await read(w, w.owner), [{ from: w.member.account.username, text: 'the password is hunter2' }])
  assert.deepEqual(await read(w, w.member), [{ from: w.member.account.username, text: 'the password is hunter2' }])

  // what the server stored
  const stored = rows('SELECT text, enc_epoch FROM messages WHERE channel_id = ?', w.channel.id)
  assert.equal(stored.length, 1)
  assert.equal(stored[0].enc_epoch, 1)
  assert.ok(!stored[0].text.includes('hunter2'))
  const envelopes = rows('SELECT data FROM key_envelopes WHERE server_id = ?', w.server.id)
  assert.equal(envelopes.length, 2)
})

test("a message cannot be shown as someone else's or from another space", async () => {
  const w = await world()
  await w.owner.keys.startEpoch(w.owner.token, w.server.id)
  await w.member.keys.syncKeys(w.member.token, w.server.id)
  await say(w, w.member, 'from the member')
  // the server (or anyone) relabels the author: it no longer opens
  const [m] = await api.getMessages(w.owner.token, 'channel', w.channel.id)
  const asOwner = await rejection(w.owner.keys.open(w.server.id, { ...where(w), authorId: w.owner.id }, m.text))
  assert.ok(asOwner instanceof CryptoProblem)
  assert.equal(asOwner.code, 'cannot_open')
  const otherSpace = await rejection(w.owner.keys.open(w.server.id, { type: 'channel', spaceId: w.channel.id + 1, authorId: w.member.id }, m.text))
  assert.equal(otherSpace.code, 'cannot_open')
})

test('a person who joins later gets no key until a member hands it on, then reads the whole history', async () => {
  const w = await world()
  await w.owner.keys.startEpoch(w.owner.token, w.server.id)
  await w.member.keys.syncKeys(w.member.token, w.server.id)
  await say(w, w.member, 'before you came')

  const late = await w.join('late')
  await late.keys.ensureDevice(late.token)
  let s = await late.keys.syncKeys(late.token, w.server.id)
  assert.equal(s.hasCurrent, false)
  assert.deepEqual(await read(w, late), [{ from: w.member.account.username, unreadable: 'no_key' }])
  await rejection(late.keys.seal(w.server.id, { ...where(w), authorId: late.id }, 'hello'))

  assert.equal((await w.owner.keys.shareKeys(w.owner.token, w.server.id)).added, 1)
  s = await late.keys.syncKeys(late.token, w.server.id)
  assert.equal(s.hasCurrent, true)
  assert.deepEqual(await read(w, late), [{ from: w.member.account.username, text: 'before you came' }])
  // handing on again changes nothing, and does not even ask the server twice
  assert.equal((await w.owner.keys.shareKeys(w.owner.token, w.server.id)).added, 0)
  let asked = 0
  const spy = { ...api, postKeyEnvelopes: (...args) => (asked++, api.postKeyEnvelopes(...args)) }
  const again = createKeyManager({ api: spy, store: w.owner.store, scope: `${srv.url}|${w.owner.id}` })
  await again.shareKeys(w.owner.token, w.server.id) // a fresh run has to ask once, then remembers
  const firstRun = asked
  await again.shareKeys(w.owner.token, w.server.id)
  assert.equal(asked, firstRun, 'a second pass in the same run sends nothing')
})

test("a second computer of the same person gets the keys from the first, and the first cannot be fooled by it", async () => {
  const w = await world()
  await w.owner.keys.startEpoch(w.owner.token, w.server.id)
  await w.member.keys.syncKeys(w.member.token, w.server.id)
  await say(w, w.member, 'one')

  const second = computer(w.member.account) // same account, new computer, empty store
  await second.keys.ensureDevice(second.token)
  assert.equal((await second.keys.syncKeys(second.token, w.server.id)).hasCurrent, false)
  await w.member.keys.shareKeys(w.member.token, w.server.id)
  assert.equal((await second.keys.syncKeys(second.token, w.server.id)).hasCurrent, true)
  assert.deepEqual(await read(w, second), [{ from: w.member.account.username, text: 'one' }])
  assert.equal((await api.listMyDevices(w.member.token)).devices.length, 2)
})

test('after someone is removed, the next key locks them out of everything new but not what they already had', async () => {
  const w = await world()
  const other = await w.join('other')
  await other.keys.ensureDevice(other.token)
  await w.owner.keys.startEpoch(w.owner.token, w.server.id)
  await Promise.all([w.member, other].map((p) => p.keys.syncKeys(p.token, w.server.id)))
  await say(w, w.member, 'while we were all here')

  await api.kickMember(w.owner.token, w.server.id, w.member.id)
  const info = await api.getServer(w.owner.token, w.server.id)
  assert.equal(info.e2ee.rekeyNeeded, true)
  assert.deepEqual(await w.owner.keys.startEpoch(w.owner.token, w.server.id), { epoch: 2 })
  assert.equal((await api.getServer(w.owner.token, w.server.id)).e2ee.rekeyNeeded, false)

  await other.keys.syncKeys(other.token, w.server.id)
  await say(w, other, 'after they left')
  assert.deepEqual((await read(w, w.owner)).map((m) => m.text), ['while we were all here', 'after they left'])
  assert.deepEqual((await read(w, other)).map((m) => m.text), ['while we were all here', 'after they left'])

  // the removed person cannot ask for the new key, and what they hold does not open the new message
  const refused = await rejection(w.member.keys.syncKeys(w.member.token, w.server.id))
  assert.equal(refused.status, 403)
  assert.deepEqual(await w.member.keys.epochsHeld(w.server.id), [1])
  const newest = (await api.getMessages(w.owner.token, 'channel', w.channel.id)).at(-1)
  const cannot = await rejection(w.member.keys.open(w.server.id, { ...where(w), authorId: other.id }, newest.text))
  assert.equal(cannot.code, 'no_key')
})

test('starting a key again after another admin got there first still ends with one new epoch', async () => {
  const w = await world()
  const [one, two] = await Promise.all([w.owner.keys.startEpoch(w.owner.token, w.server.id), w.owner.keys.startEpoch(w.owner.token, w.server.id)])
  assert.deepEqual([one.epoch, two.epoch].sort(), [1, 2])
  const info = await api.getServer(w.owner.token, w.server.id)
  assert.equal(info.e2ee.epoch, 2)
})

test('commands go to their own route and the bot answers in plain text', async () => {
  const w = await world()
  await w.owner.keys.startEpoch(w.owner.token, w.server.id)
  await api.postCommand(w.member.token, 'channel', w.channel.id, '/help')
  let bot
  for (let i = 0; i < 50 && !bot; i++) {
    bot = (await read(w, w.owner)).find((m) => m.bot)
    if (!bot) await new Promise((r) => setTimeout(r, 100))
  }
  assert.match(bot.text, /Jellybox/i)
  assert.equal((await read(w, w.owner)).length, 1, 'the command itself is not a message')
})

test('a client that does not say its version is turned away from an encrypted server', async () => {
  const w = await world()
  await w.owner.keys.startEpoch(w.owner.token, w.server.id)
  const bare = await fetch(`${srv.url}/api/channels/${w.channel.id}/messages`, { headers: { authorization: 'Bearer ' + w.member.token } })
  assert.equal(bare.status, 426)
  assert.equal((await bare.json()).reason, 'client_too_old')
  // through api.js the same call works, because it sends the version
  assert.deepEqual(await api.getMessages(w.member.token, 'channel', w.channel.id), [])
})

test('forgetting everything on a computer leaves nothing to read with', async () => {
  const w = await world()
  await w.owner.keys.startEpoch(w.owner.token, w.server.id)
  await w.member.keys.syncKeys(w.member.token, w.server.id)
  await w.member.keys.forgetAll()
  assert.deepEqual(await w.member.keys.epochsHeld(w.server.id), [])
  assert.equal(await w.member.store.getDevice(`${srv.url}|${w.member.id}`), null)
})

// --- pictures ---
const MARK = Buffer.from('PICTURE-MARKER-0123456789')
const fakePicture = (n) => {
  const b = Buffer.alloc(n)
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(b.subarray(i, Math.min(n, i + 65536)))
  MARK.copy(b, 0)
  return new Uint8Array(b)
}
const SEALED = 'application/x-rushlight-sealed'
async function sendPicture(w, who, bytes, caption = '') {
  const body = await who.keys.sealImage(w.server.id, { ...where(w), authorId: who.id }, bytes, { mime: 'image/png', width: 64, height: 48 }, caption)
  return api.postImage(who.token, 'channel', w.channel.id, new Blob([body], { type: SEALED }), { avatarColor: '#abcdef' })
}
// what a reader's computer does with a picture message
async function openPictureOf(w, who, message) {
  const body = await who.keys.openBody(w.server.id, { ...where(w), authorId: message.authorId }, message.text)
  const info = pictureInfo(body)
  const stored = await api.fetchChatImageBytes(who.token, message.image.id)
  return { caption: body.t, info, bytes: await openPicture(stored, info.key), stored }
}

test('a picture goes to the server sealed, and the other member opens it', async () => {
  const w = await world()
  await w.owner.keys.startEpoch(w.owner.token, w.server.id)
  await w.member.keys.syncKeys(w.member.token, w.server.id)
  const bytes = fakePicture(300000)
  const sent = await sendPicture(w, w.member, bytes, 'the plan')
  assert.equal(sent.encrypted, true)
  assert.equal(sent.image.sealed, true)

  const [m] = await api.getMessages(w.owner.token, 'channel', w.channel.id)
  const got = await openPictureOf(w, w.owner, m)
  assert.equal(got.caption, 'the plan')
  assert.deepEqual({ mime: got.info.mime, width: got.info.width, height: got.info.height }, { mime: 'image/png', width: 64, height: 48 })
  assert.deepEqual(got.bytes, bytes)

  // what the server holds: scrambled bytes of the right length, a sealed type, no shape, and a sealed caption
  const [row] = rows('SELECT mime, width, height, size, data FROM message_images')
  assert.deepEqual({ mime: row.mime, width: row.width, height: row.height, size: row.size }, { mime: SEALED, width: 0, height: 0, size: bytes.length + 28 })
  assert.equal(Buffer.from(row.data).indexOf(MARK), -1)
  assert.ok(!JSON.stringify(rows('SELECT text FROM messages')).includes('the plan'))
})

test("the server cannot hand back one picture for another: each opens only with its own message's key", async () => {
  const w = await world()
  await w.owner.keys.startEpoch(w.owner.token, w.server.id)
  await w.member.keys.syncKeys(w.member.token, w.server.id)
  await sendPicture(w, w.member, fakePicture(2000), 'first')
  await sendPicture(w, w.member, fakePicture(2000), 'second')
  const [a, b] = await api.getMessages(w.owner.token, 'channel', w.channel.id)
  const infoB = pictureInfo(await w.owner.keys.openBody(w.server.id, { ...where(w), authorId: b.authorId }, b.text))
  const storedA = await api.fetchChatImageBytes(w.owner.token, a.image.id)
  const swapped = await rejection(openPicture(storedA, infoB.key))
  assert.equal(swapped.code, 'cannot_open')
})

test('a person who joins later reads old pictures once handed the key, and a removed one cannot open new ones', async () => {
  const w = await world()
  await w.owner.keys.startEpoch(w.owner.token, w.server.id)
  await w.member.keys.syncKeys(w.member.token, w.server.id)
  const bytes = fakePicture(4000)
  await sendPicture(w, w.owner, bytes, 'old')

  const late = await w.join('late')
  await late.keys.ensureDevice(late.token)
  await w.owner.keys.shareKeys(w.owner.token, w.server.id)
  await late.keys.syncKeys(late.token, w.server.id)
  const [m] = await api.getMessages(late.token, 'channel', w.channel.id)
  assert.deepEqual((await openPictureOf(w, late, m)).bytes, bytes)

  await api.kickMember(w.owner.token, w.server.id, w.member.id)
  await w.owner.keys.startEpoch(w.owner.token, w.server.id)
  await late.keys.syncKeys(late.token, w.server.id)
  await sendPicture(w, late, fakePicture(3000), 'after the kick')
  const newest = (await api.getMessages(w.owner.token, 'channel', w.channel.id)).at(-1)
  const cannot = await rejection(w.member.keys.openBody(w.server.id, { ...where(w), authorId: late.id }, newest.text))
  assert.equal(cannot.code, 'no_key')
  assert.equal((await openPictureOf(w, w.owner, newest)).caption, 'after the kick')
})

test('a plain picture is refused by an encrypted server, in the server\'s own words', async () => {
  const w = await world()
  await w.owner.keys.startEpoch(w.owner.token, w.server.id)
  const before = rows('SELECT COUNT(*) AS n FROM message_images')[0].n
  const err = await rejection(api.postImage(w.owner.token, 'channel', w.channel.id, new Blob([fakePicture(500)], { type: 'image/png' }), { text: 'sneaky' }))
  assert.equal(err.status, 400)
  assert.equal(err.reason, 'encryption_required')
  assert.equal(rows('SELECT COUNT(*) AS n FROM message_images')[0].n, before)
})
