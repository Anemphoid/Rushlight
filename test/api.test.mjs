// The client's api.js against a real server process: the join-code screen's
// list, create and revoke, and what guests are told. The GUI itself is not
// covered here, only the calls it makes and the answers it gets.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, installBridge, rejection } from './helpers.mjs'

let srv
let api
let counter = 0

before(async () => {
  srv = await startServer()
  installBridge(srv.url)
  api = await import('../src/renderer/src/api.js')
})
after(async () => {
  if (srv) await srv.stop()
})

const account = async () => (await api.register(`tester${++counter}x`, 'password123'))

// An admin with a server that has one voice channel.
async function world() {
  const admin = await account()
  const server = await api.createServer(admin.token, 'Test server')
  const voice = await api.createChannel(admin.token, server.id, { name: 'voice', mode: 'voice', persistent: false })
  return { admin, server, voice }
}

test('listServerCodes returns the real response shape for a timed single-use code', async () => {
  const { admin, server } = await world()
  const made = await api.createServerCode(admin.token, server.id, { singleUse: true, expiresInMinutes: 60 })
  assert.match(made.code, /^[a-z]+-[a-z]+-\d{4}$/)

  const { codes } = await api.listServerCodes(admin.token, server.id)
  assert.equal(codes.length, 1)
  const c = codes[0]
  assert.deepEqual(Object.keys(c).sort(), ['code', 'createdAt', 'expiresAt', 'guestsNow', 'id', 'persistent', 'singleUse'])
  assert.equal(c.code, made.code)
  assert.equal(c.singleUse, true)
  assert.equal(c.persistent, false)
  assert.equal(typeof c.id, 'number')
  assert.ok(c.expiresAt > Date.now() + 59 * 60 * 1000 && c.expiresAt < Date.now() + 61 * 60 * 1000)
  assert.ok(c.createdAt <= Date.now() && c.createdAt > Date.now() - 60 * 1000)
  assert.equal(c.guestsNow, 0)
})

test('a reusable code with no expiry has expiresAt null', async () => {
  const { admin, server } = await world()
  await api.createServerCode(admin.token, server.id, { singleUse: false, expiresInMinutes: null })
  const { codes } = await api.listServerCodes(admin.token, server.id)
  assert.equal(codes.length, 1)
  assert.equal(codes[0].singleUse, false)
  assert.equal(codes[0].expiresAt, null)
})

test('an empty list is an empty array, and a used-up single-use code leaves it', async () => {
  const { admin, server } = await world()
  assert.deepEqual((await api.listServerCodes(admin.token, server.id)).codes, [])
  const made = await api.createServerCode(admin.token, server.id, { singleUse: true, expiresInMinutes: null })
  const joiner = await account()
  await api.joinServerWithCode(joiner.token, made.code)
  assert.deepEqual((await api.listServerCodes(admin.token, server.id)).codes, [])
})

test('revoking a code removes it from the list and it can no longer be used', async () => {
  const { admin, server } = await world()
  const made = await api.createServerCode(admin.token, server.id, { singleUse: false, expiresInMinutes: null })
  const { codes } = await api.listServerCodes(admin.token, server.id)
  await api.revokeServerCode(admin.token, server.id, codes[0].id)

  assert.deepEqual((await api.listServerCodes(admin.token, server.id)).codes, [])
  const err = await rejection(api.joinWithCode(made.code, 'Latecomer'))
  assert.equal(err.status, 404)
  const err2 = await rejection(api.joinServerWithCode((await account()).token, made.code))
  assert.equal(err2.status, 404)
})

test('revoking a code ends access for the guests who joined with it', async () => {
  const { admin, server, voice } = await world()
  const made = await api.createServerCode(admin.token, server.id, { singleUse: false, expiresInMinutes: null })
  const guest = await api.joinWithCode(made.code, 'Guesty')
  assert.equal((await api.getVoiceToken(guest.guestToken, 'channel', voice.id)).room, `s${server.id}-channel-${voice.id}`)

  const row = (await api.listServerCodes(admin.token, server.id)).codes[0]
  assert.equal(row.guestsNow, 1)

  await api.revokeServerCode(admin.token, server.id, row.id)
  const err = await rejection(api.getVoiceToken(guest.guestToken, 'channel', voice.id))
  assert.equal(err.status, 403)
  assert.match(err.message, /revoked/i)
})

test('people who made an account with a revoked code keep their membership', async () => {
  const { admin, server } = await world()
  const made = await api.createServerCode(admin.token, server.id, { singleUse: false, expiresInMinutes: null })
  const member = await account()
  await api.joinServerWithCode(member.token, made.code)
  const row = (await api.listServerCodes(admin.token, server.id)).codes[0]
  await api.revokeServerCode(admin.token, server.id, row.id)
  const mine = await api.listServers(member.token)
  assert.ok(mine.servers.some((s) => s.id === server.id))
})

test('only admins can list or revoke codes, and the error is the server\'s own message', async () => {
  const { admin, server } = await world()
  const made = await api.createServerCode(admin.token, server.id, { singleUse: false, expiresInMinutes: null })
  const member = await account()
  await api.joinServerWithCode(member.token, made.code)

  const listErr = await rejection(api.listServerCodes(member.token, server.id))
  assert.equal(listErr.status, 403)
  assert.match(listErr.message, /admin/i)
  const row = (await api.listServerCodes(admin.token, server.id)).codes[0]
  const revokeErr = await rejection(api.revokeServerCode(member.token, server.id, row.id))
  assert.equal(revokeErr.status, 403)

  const guest = await api.joinWithCode(made.code, 'Visitor')
  const guestErr = await rejection(api.listServerCodes(guest.guestToken, server.id))
  assert.equal(guestErr.status, 401)
})

test('a code from another server cannot be revoked through this one', async () => {
  const a = await world()
  const b = await world()
  await api.createServerCode(b.admin.token, b.server.id, { singleUse: false, expiresInMinutes: null })
  const otherRow = (await api.listServerCodes(b.admin.token, b.server.id)).codes[0]
  const err = await rejection(api.revokeServerCode(a.admin.token, a.server.id, otherRow.id))
  assert.equal(err.status, 404)
})

test('a guest screen name that clashes with an account is refused with a readable message', async () => {
  const { admin, server } = await world()
  const made = await api.createServerCode(admin.token, server.id, { singleUse: false, expiresInMinutes: null })
  const taken = await account()
  const name = (await api.getMe(taken.token)).username
  // The guest join screen shows err.message as it is, so this is what people read.
  const err = await rejection(api.joinWithCode(made.code, name.toUpperCase()))
  assert.equal(err.status, 409)
  assert.match(err.message, /account/i)
  assert.ok(err.message.length > 10)
})
