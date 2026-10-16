// What the chat screens rely on, against a real server: the per-server key status (off, waiting, ready), who
// starts the first key, how long a newcomer waits, how messages are opened or marked unreadable, and that an
// encrypted server's words never reach a desktop notification. (The screens themselves are checked in a real
// browser by scripts/e2ee-chat-check.mjs.)
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, installBridge, openServerDb } from './helpers.mjs'

let srv
let api
let session
let counter = 0
before(async () => {
  srv = await startServer({ ACCOUNT_LIMIT: '1000', DEVICE_LIMIT: '1000' })
  installBridge(srv.url, { version: '0.22.0' })
  api = await import('../src/renderer/src/api.js')
  await api.getMe('x').catch(() => {}) // warms the cached server address, as any real request does
  session = await import('../src/renderer/src/e2eeSession.js')
})
after(async () => {
  if (srv) await srv.stop()
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const person = async (name) => {
  const a = await api.register(`${name}${++counter}x`, 'password123')
  return a
}
async function world({ encrypted = true } = {}) {
  const owner = await person('owner')
  const server = await api.createServer(owner.token, 'S')
  const channel = await api.createChannel(owner.token, server.id, { name: 'general', mode: 'text', persistent: true })
  const code = await api.createServerCode(owner.token, server.id, { singleUse: false, expiresInMinutes: null })
  const member = await person('member')
  await api.joinServerWithCode(member.token, code.code)
  if (encrypted) {
    const db = openServerDb(srv.dbPath)
    db.prepare('UPDATE servers SET e2ee_enabled = 1 WHERE id = ?').run(server.id)
    db.close()
  }
  const info = async (who) => (await api.getServer(who.token, server.id)).e2ee
  const refresh = async (who, isAdmin) => session.refresh({ token: who.token, accountId: who.id, serverId: server.id, e2ee: await info(who), isAdmin })
  const status = () => session.statusOf(session.getSnapshot(), server.id)
  const space = { type: 'channel', id: channel.id }
  return { owner, member, server, channel, info, refresh, status, space }
}

test('a server without encryption stays off and starts nothing', async () => {
  const w = await world({ encrypted: false })
  await w.refresh(w.owner, true)
  assert.deepEqual(w.status(), { state: 'off' })
  assert.equal((await api.listMyDevices(w.owner.token)).devices.length, 0)
})

test('the first admin to open an encrypted server makes the key; a member waits for it, then reads', async () => {
  const w = await world()
  await w.refresh(w.owner, true)
  assert.deepEqual(w.status(), { state: 'ready', epoch: 1 })

  // the member's computer has registered but was not there when the key was made
  const member = { ...w.member }
  await w.refresh(member, false)
  assert.equal(w.status().state, 'waiting')
  const err = await session.seal(member.id, w.server.id, w.space, member.id, 'hi').catch((e) => e)
  assert.equal(err.code, 'no_key')

  await sleep(4300) // the owner's window offers keys on its next check (about every 5 seconds)
  await w.refresh(w.owner, true)
  await w.refresh(member, false)
  assert.deepEqual(w.status(), { state: 'ready', epoch: 1 })
})

test('opened messages carry their text; one this computer cannot read is marked, never shown as ciphertext', async () => {
  const w = await world()
  await w.refresh(w.owner, true)
  const sealed = await session.seal(w.owner.id, w.server.id, w.space, w.owner.id, 'plan: the roof at midnight')
  const saved = await api.postMessage(w.owner.token, 'channel', w.channel.id, { text: sealed })
  const raw = await api.getMessages(w.owner.token, 'channel', w.channel.id)
  assert.equal(raw[0].encrypted, true)
  assert.ok(!raw[0].text.includes('roof'))

  const [mine] = await session.openMessages(w.owner.id, w.server.id, w.space, raw)
  assert.equal(mine.text, 'plan: the roof at midnight')
  assert.equal(mine.locked, undefined)
  assert.equal(saved.id, mine.id)

  // a computer that holds no key
  const [blind] = await session.openMessages(w.member.id, w.server.id, w.space, raw)
  assert.equal(blind.text, '')
  assert.equal(blind.locked, 'no_key')

  // the same ciphertext presented under another author does not open (and says so)
  const [moved] = await session.openMessages(w.owner.id, w.server.id, w.space, [{ ...raw[0], id: 999, authorId: w.member.id }])
  assert.equal(moved.locked, 'cannot_open')
  assert.equal(moved.text, '')
})

test('plain messages, bot messages and redacted ones pass through untouched', async () => {
  const w = await world({ encrypted: false })
  const msgs = [
    { id: 1, text: 'hello', encrypted: false, authorId: 1 },
    { id: 2, text: 'Hi, I am Jellybox', encrypted: false, bot: true },
    { id: 3, text: '', redacted: true, encrypted: false }
  ]
  assert.deepEqual(await session.openMessages(w.owner.id, w.server.id, w.space, msgs), msgs)
})

test('a failure to reach the keys is a visible problem state with the reason', async () => {
  const w = await world()
  await session.refresh({ token: 'not-a-token', accountId: w.owner.id, serverId: w.server.id, e2ee: { enabled: true, epoch: 0, rekeyNeeded: false }, isAdmin: true })
  assert.equal(w.status().state, 'problem')
  assert.ok(w.status().message)
})

test('overlapping refreshes of one server run once', async () => {
  const w = await world()
  await Promise.all([w.refresh(w.owner, true), w.refresh(w.owner, true), w.refresh(w.owner, true)])
  assert.equal(w.status().epoch, 1, 'one key was made, not three')
  assert.equal((await api.getServer(w.owner.token, w.server.id)).e2ee.epoch, 1)
})

test('a desktop notification for an encrypted server never carries the words', async () => {
  const sent = []
  globalThis.Notification = class {
    constructor(title, opts) {
      sent.push({ title, body: opts.body })
    }
  }
  globalThis.document = { hasFocus: () => false }
  const store = new Map()
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }
  const unread = await import('../src/renderer/src/unread.js')
  const key = unread.scopedKey(7, 'channel:1')
  unread.observe({ key, title: 'S · general', messages: [{ id: 1, authorId: 2, author: 'Mia', text: 'old', encrypted: true }], isOpen: false, selfId: 1 }) // baseline
  unread.observe({ key, title: 'S · general', messages: [{ id: 1, authorId: 2, author: 'Mia', text: 'old', encrypted: true }, { id: 2, authorId: 2, author: 'Mia', text: 'the vault code is 1234', encrypted: true }], isOpen: false, selfId: 1 })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].body, 'Mia: sent a message')
  // ordinary servers still show the text
  const plain = unread.scopedKey(8, 'channel:1')
  unread.observe({ key: plain, title: 'P', messages: [{ id: 1, authorId: 2, author: 'Mia', text: 'old', encrypted: false }], isOpen: false, selfId: 1 })
  unread.observe({ key: plain, title: 'P', messages: [{ id: 1, authorId: 2, author: 'Mia', text: 'old', encrypted: false }, { id: 2, authorId: 2, author: 'Mia', text: 'lunch?', encrypted: false }], isOpen: false, selfId: 1 })
  assert.equal(sent[1].body, 'Mia: lunch?')
})

test('signing out clears what is held in memory, and another account on the same computer reads nothing of it', async () => {
  const w = await world()
  await w.refresh(w.owner, true)
  const sealed = await session.seal(w.owner.id, w.server.id, w.space, w.owner.id, 'for the owner only')
  await api.postMessage(w.owner.token, 'channel', w.channel.id, { text: sealed })
  const raw = await api.getMessages(w.owner.token, 'channel', w.channel.id)
  assert.equal((await session.openMessages(w.owner.id, w.server.id, w.space, raw))[0].text, 'for the owner only')
  session.lock()
  assert.deepEqual(w.status(), { state: 'off' })
  // the keys on disk are still there, so the same person signing back in reads again
  assert.equal((await session.openMessages(w.owner.id, w.server.id, w.space, raw))[0].text, 'for the owner only')
  // someone else signing in on this computer does not
  assert.equal((await session.openMessages(w.member.id, w.server.id, w.space, raw))[0].locked, 'no_key')
  // forgetting the account removes the keys themselves
  await session.forgetAccount(w.owner.id)
  assert.equal((await session.openMessages(w.owner.id, w.server.id, w.space, raw))[0].locked, 'no_key')
})

test('after a removal only an admin starts the new key, and everyone else picks it up', async () => {
  const w = await world()
  const code = await api.createServerCode(w.owner.token, w.server.id, { singleUse: false, expiresInMinutes: null })
  const bystander = await person('bystander')
  await api.joinServerWithCode(bystander.token, code.code)
  await w.refresh(w.owner, true)
  await w.refresh(bystander, false)
  await sleep(4300)
  await w.refresh(w.owner, true) // hands the key to the bystander's computer
  await w.refresh(bystander, false)
  assert.deepEqual(w.status(), { state: 'ready', epoch: 1 })

  await api.kickMember(w.owner.token, w.server.id, w.member.id)
  assert.equal((await w.info(w.owner)).rekeyNeeded, true)
  await w.refresh(bystander, false) // not an admin: it must not try, and must not report a problem
  assert.deepEqual(w.status(), { state: 'ready', epoch: 1 })
  assert.equal((await w.info(w.owner)).epoch, 1)

  await w.refresh(w.owner, true) // an admin does
  assert.equal((await w.info(w.owner)).epoch, 2)
  assert.equal((await w.info(w.owner)).rekeyNeeded, false)
  await w.refresh(bystander, false)
  assert.deepEqual(w.status(), { state: 'ready', epoch: 2 })
})

test('an opened picture message carries its type, shape and key; a message that lies about its picture is unreadable', async () => {
  const w = await world()
  await w.refresh(w.owner, true)
  const bytes = new Uint8Array(1500).fill(7)
  const body = await session.sealPictureFor(w.owner.id, w.server.id, w.space, w.owner.id, bytes, { mime: 'image/webp', width: 320, height: 200 }, 'look')
  await api.postImage(w.owner.token, 'channel', w.channel.id, new Blob([body], { type: 'application/x-rushlight-sealed' }), {})
  const raw = await api.getMessages(w.owner.token, 'channel', w.channel.id)
  assert.equal(raw[0].image.sealed, true)
  assert.equal(raw[0].image.width, 0, 'the server does not know the shape')
  const [opened] = await session.openMessages(w.owner.id, w.server.id, w.space, raw)
  assert.equal(opened.text, 'look')
  assert.deepEqual({ ...opened.image, key: typeof opened.image.key }, { id: raw[0].image.id, sealed: true, mime: 'image/webp', width: 320, height: 200, key: 'string' })
  // the same picture message on a computer without the key: unreadable, and no picture to fetch
  const [blind] = await session.openMessages(w.member.id, w.server.id, w.space, raw)
  assert.equal(blind.locked, 'no_key')
  assert.equal(blind.image, null)

  // a text message whose server record claims a picture (the server, or someone, adding one): not shown
  const plainText = await session.seal(w.owner.id, w.server.id, w.space, w.owner.id, 'just words')
  const [fake] = await session.openMessages(w.owner.id, w.server.id, w.space, [{ id: 777, authorId: w.owner.id, encrypted: true, text: plainText, image: { id: 5, sealed: true } }])
  assert.equal(fake.locked, 'cannot_open')
  assert.equal(fake.image, null)
})

test('a picture notification says a picture was sent and nothing more', async () => {
  const sent = []
  globalThis.Notification = class {
    constructor(title, opts) {
      sent.push(opts.body)
    }
  }
  globalThis.document = { hasFocus: () => false }
  const unread = await import('../src/renderer/src/unread.js')
  const key = unread.scopedKey(9, 'channel:1')
  const base = [{ id: 1, authorId: 2, author: 'Mia', text: 'x', encrypted: true }]
  unread.observe({ key, title: 'S', messages: base, isOpen: false, selfId: 1 })
  unread.observe({ key, title: 'S', messages: [...base, { id: 2, authorId: 2, author: 'Mia', text: 'rl1.1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB', encrypted: true, image: { id: 3, sealed: true } }], isOpen: false, selfId: 1 })
  assert.equal(sent.at(-1), 'Mia: sent a picture')
})
