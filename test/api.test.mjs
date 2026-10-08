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
  assert.deepEqual(Object.keys(c).sort(), ['code', 'createdAt', 'expiresAt', 'guestsNow', 'id', 'persistent', 'scope', 'singleUse', 'used'])
  assert.equal(c.code, made.code)
  assert.equal(c.singleUse, true)
  assert.equal(c.persistent, false)
  assert.equal(typeof c.id, 'number')
  assert.ok(c.expiresAt > Date.now() + 59 * 60 * 1000 && c.expiresAt < Date.now() + 61 * 60 * 1000)
  assert.ok(c.createdAt <= Date.now() && c.createdAt > Date.now() - 60 * 1000)
  assert.equal(c.guestsNow, 0)
  assert.equal(c.scope, null)
  assert.equal(c.used, false)
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('access that ends is explained: expired, removed and banned come back with a reason', async () => {
  const { accessEndedNotice } = await import('../src/renderer/src/accessEnded.js')
  const { admin, server } = await world()

  // expiry: a member whose timed code runs out (a few seconds)
  const timed = await api.createServerCode(admin.token, server.id, { singleUse: false, expiresInMinutes: 0.04 })
  const expiring = await account()
  await api.joinServerWithCode(expiring.token, timed.code)
  assert.equal((await api.getServer(expiring.token, server.id)).id, server.id)

  // kick and ban, on members of a permanent code
  const open = await api.createServerCode(admin.token, server.id, { singleUse: false, expiresInMinutes: null })
  const kicked = await account()
  const banned = await account()
  for (const m of [kicked, banned]) await api.joinServerWithCode(m.token, open.code)
  await api.kickMember(admin.token, server.id, kicked.id)
  await api.banMember(admin.token, server.id, banned.id, 'test')

  const kickedErr = await rejection(api.getServer(kicked.token, server.id))
  assert.equal(kickedErr.status, 403)
  assert.equal(kickedErr.reason, 'removed')
  assert.equal(accessEndedNotice(kickedErr), 'You were removed from this server.')
  const bannedErr = await rejection(api.getServer(banned.token, server.id))
  assert.equal(bannedErr.reason, 'banned')
  assert.equal(accessEndedNotice(bannedErr), 'You were banned from this server.')

  // wait for the timer to run out, then the real message the screen shows
  let expiredErr
  for (let i = 0; i < 80 && !expiredErr; i++) {
    try {
      await api.getServer(expiring.token, server.id)
      await sleep(100)
    } catch (err) {
      expiredErr = err
    }
  }
  assert.ok(expiredErr, 'the timed member never lost access')
  assert.equal(expiredErr.status, 403)
  assert.equal(expiredErr.reason, 'expired')
  assert.equal(accessEndedNotice(expiredErr), 'Your access to this server has expired.')
  // and the server rail no longer lists it
  assert.ok(!(await api.listServers(expiring.token)).servers.some((s) => s.id === server.id))
})

test('a guest checks in and sees only their own space, while members see the guest', async () => {
  const { admin, server, voice } = await world()
  const elsewhere = await api.createChannel(admin.token, server.id, { name: 'elsewhere', mode: 'voice', persistent: false })
  const made = await api.createServerCode(admin.token, server.id, { singleUse: false, expiresInMinutes: null })
  const member = await account()
  await api.joinServerWithCode(member.token, made.code)
  await api.sendPresence(member.token, 'channel', elsewhere.id, null) // a member in the other channel

  const guest = await api.joinWithCode(made.code, 'Guest Presence')
  assert.deepEqual(guest.server.presence, {}) // nothing shown before they are in a room
  const mine = await api.sendPresence(guest.guestToken, 'channel', voice.id, '#aabbcc')
  assert.deepEqual(Object.keys(mine.presence), [`channel:${voice.id}`])
  const me = mine.presence[`channel:${voice.id}`][0]
  assert.equal(me.name, 'Guest Presence')
  assert.equal(me.guest, true)
  assert.equal(me.avatarUpdatedAt, null)

  // the tree a member loads shows the guest in their room, and the member where they are
  const tree = await api.getServer(admin.token, server.id)
  assert.deepEqual(tree.presence[`channel:${voice.id}`].map((p) => p.name), ['Guest Presence'])
  assert.equal(tree.presence[`channel:${elsewhere.id}`].length, 1)
})

test('admins can list the guests here, and leaving takes a guest off the list and out of the room', async () => {
  const { admin, server, voice } = await world()
  const made = await api.createServerCode(admin.token, server.id, { singleUse: false, expiresInMinutes: null })
  const member = await account()
  await api.joinServerWithCode(member.token, made.code)
  const guest = await api.joinWithCode(made.code, 'Listed Guest')

  let { guests } = await api.listServerGuests(admin.token, server.id)
  assert.equal(guests.length, 1)
  assert.deepEqual(Object.keys(guests[0]).sort(), ['code', 'codeId', 'expiresAt', 'identity', 'joinedAt', 'name', 'space'])
  assert.equal(guests[0].name, 'Listed Guest')
  assert.equal(guests[0].code, made.code)
  assert.equal(guests[0].space, null) // joined, not in a room yet

  await api.sendPresence(guest.guestToken, 'channel', voice.id, null)
  guests = (await api.listServerGuests(admin.token, server.id)).guests
  assert.equal(guests[0].space, `channel:${voice.id}`)

  assert.equal((await rejection(api.listServerGuests(member.token, server.id))).status, 403)
  assert.equal((await rejection(api.listServerGuests(guest.guestToken, server.id))).status, 401)

  await api.leavePresence(guest.guestToken)
  const tree = await api.getServer(admin.token, server.id)
  assert.equal(tree.presence[`channel:${voice.id}`], undefined)
})

test('a guest cannot check in to another server', async () => {
  const a = await world()
  const b = await world()
  const made = await api.createServerCode(a.admin.token, a.server.id, { singleUse: false, expiresInMinutes: null })
  const guest = await api.joinWithCode(made.code, 'Out Of Bounds')
  const err = await rejection(api.sendPresence(guest.guestToken, 'channel', b.voice.id, null))
  assert.equal(err.status, 403)
})

test('a code limited to one room: the list says so, the guest sees only that, an account is refused', async () => {
  const { admin, server, voice } = await world()
  const room = await api.createRoom(admin.token, server.id, voice.id, { name: 'back', mode: 'voice', persistent: false })
  const other = await api.createRoom(admin.token, server.id, voice.id, { name: 'front', mode: 'voice', persistent: false })
  const made = await api.createServerCode(admin.token, server.id, {
    singleUse: false,
    expiresInMinutes: null,
    scope: { type: 'room', id: room.id }
  })
  assert.equal(made.scope.type, 'room')
  const row = (await api.listServerCodes(admin.token, server.id)).codes[0]
  assert.deepEqual(row.scope, { type: 'room', id: room.id, name: 'voice / back' })

  const guest = await api.joinWithCode(made.code, 'Back Room Guest')
  const tree = guest.server.channels
  assert.equal(tree.length, 1)
  assert.equal(tree[0].joinable, false)
  assert.deepEqual(tree[0].rooms.map((r) => r.id), [room.id])

  const err = await rejection(api.joinServerWithCode((await account()).token, made.code))
  assert.equal(err.status, 403)
  assert.match(err.message, /guest invite for one room/)

  const bad = await rejection(
    api.createServerCode(admin.token, server.id, { singleUse: false, expiresInMinutes: null, scope: { type: 'room', id: 999999 } })
  )
  assert.equal(bad.status, 400)
  assert.ok(other.id)
})

test('a used single-use code stays listed while its guest is here; revoking it removes the guest', async () => {
  const { admin, server, voice } = await world()
  const made = await api.createServerCode(admin.token, server.id, { singleUse: true, expiresInMinutes: null })
  const guest = await api.joinWithCode(made.code, 'Used Code Guest')
  const row = (await api.listServerCodes(admin.token, server.id)).codes.find((c) => c.code === made.code)
  assert.ok(row, 'the used code vanished while its guest is still in')
  assert.equal(row.used, true)
  assert.equal(row.guestsNow, 1)
  await api.revokeServerCode(admin.token, server.id, row.id)
  assert.equal((await rejection(api.getVoiceToken(guest.guestToken, 'channel', voice.id))).status, 403)
  assert.equal((await api.listServerCodes(admin.token, server.id)).codes.length, 0)
})

test('removing one guest leaves the other, and the removed guest is refused', async () => {
  const { admin, server, voice } = await world()
  const made = await api.createServerCode(admin.token, server.id, { singleUse: false, expiresInMinutes: null })
  const stays = await api.joinWithCode(made.code, 'Stays Put')
  const goes = await api.joinWithCode(made.code, 'Sent Away')
  const list = (await api.listServerGuests(admin.token, server.id)).guests
  const target = list.find((g) => g.name === 'Sent Away')
  await api.removeServerGuest(admin.token, server.id, target.identity)

  assert.deepEqual((await api.listServerGuests(admin.token, server.id)).guests.map((g) => g.name), ['Stays Put'])
  const err = await rejection(api.getVoiceToken(goes.guestToken, 'channel', voice.id))
  assert.equal(err.status, 403)
  assert.match(err.message, /removed/i)
  assert.equal((await api.getVoiceToken(stays.guestToken, 'channel', voice.id)).room, `s${server.id}-channel-${voice.id}`)

  const again = await rejection(api.removeServerGuest(admin.token, server.id, target.identity))
  assert.equal(again.status, 404)
  const notAdmin = await rejection(api.removeServerGuest(stays.guestToken, server.id, target.identity))
  assert.equal(notAdmin.status, 401)
})

test('the leave sent on the way out clears a guest and an account from presence', async () => {
  const { admin, server, voice } = await world()
  const made = await api.createServerCode(admin.token, server.id, { singleUse: false, expiresInMinutes: null })
  const guest = await api.joinWithCode(made.code, 'Closing The Window')
  await api.sendPresence(guest.guestToken, 'channel', voice.id)
  await api.sendPresence(admin.token, 'channel', voice.id)
  const here = async () => ((await api.getServer(admin.token, server.id)).presence[`channel:${voice.id}`] || []).map((p) => p.name)
  assert.equal((await here()).length, 2)

  api.leavePresenceOnExit(guest.guestToken)
  api.leavePresenceOnExit(admin.token)
  api.leavePresenceOnExit(null) // no token: does nothing, does not throw
  const end = Date.now() + 3000
  while ((await here()).length > 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 100))
  assert.deepEqual(await here(), [])
})

test('a banned account shows in the ban list and can rejoin only after an unban', async () => {
  const { admin, server } = await world()
  const code = await api.createServerCode(admin.token, server.id, { singleUse: false, expiresInMinutes: null })
  const troublemaker = await account()
  await api.joinServerWithCode(troublemaker.token, code.code)
  const member = (await api.getMembers(admin.token, server.id)).members.find((m) => m.accountId === troublemaker.id)
  assert.ok(member, 'the joined account is in the member list')

  await api.banMember(admin.token, server.id, member.accountId, 'testing')
  const { bans } = await api.getBans(admin.token, server.id)
  assert.equal(bans.length, 1)
  assert.deepEqual(Object.keys(bans[0]).sort(), ['accountId', 'bannedAt', 'reason', 'username'])
  assert.equal(bans[0].accountId, member.accountId)
  assert.equal(bans[0].reason, 'testing')
  assert.equal((await rejection(api.joinServerWithCode(troublemaker.token, code.code))).status, 403)

  await api.unbanMember(admin.token, server.id, member.accountId)
  assert.deepEqual((await api.getBans(admin.token, server.id)).bans, [])
  await api.joinServerWithCode(troublemaker.token, code.code) // allowed again
  await api.unbanMember(admin.token, server.id, member.accountId) // already unbanned: fine, not an error
})
