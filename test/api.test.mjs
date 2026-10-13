// The client's api.js against a real server process: the join-code screen's
// list, create and revoke, and what guests are told. The GUI itself is not
// covered here, only the calls it makes and the answers it gets.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, installBridge, rejection } from './helpers.mjs'
import { accessEndedNotice } from '../src/renderer/src/accessEnded.js'
import { startFakeJellyfin, TOKEN, SONG_ID, MISSING_ID, ARTIST_ID } from './fake-jellyfin.mjs'

let srv
let api
let counter = 0

before(async () => {
  // the password routes are rate limited tightly; this file makes many calls from one address
  srv = await startServer({ ACCOUNT_LIMIT: '1000', RECOVER_LIMIT: '1000' })
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

// --- Phase 2a: recovery key, password change and reset ---

const PASSWORD = 'password123'
const newName = () => `keyer${++counter}y`

test('sign-up returns a recovery key to save, and confirming it makes it the working key', async () => {
  const username = newName()
  const r = await api.register(username, PASSWORD)
  assert.equal(r.recoveryKey.split(' ').length, 12)
  assert.equal(r.recoveryKeyAcked, false)
  assert.equal((await api.login(username, PASSWORD)).recoveryKeyAcked, false)
  assert.equal((await api.getMe(r.token)).recoveryKeyAcked, false)
  await api.ackRecoveryKey(r.token)
  assert.equal((await api.login(username, PASSWORD)).recoveryKeyAcked, true)
  assert.equal((await api.getMe(r.token)).recoveryKeyAcked, true)
  assert.equal((await rejection(api.ackRecoveryKey(r.token))).status, 409) // nothing waiting to confirm
})

test('the recovery key resets a forgotten password and hands back the next key', async () => {
  const username = newName()
  const r = await api.register(username, PASSWORD)
  await api.ackRecoveryKey(r.token)

  const wrong = await rejection(api.recoverAccount(username, r.recoveryKey.split(' ').reverse().join(' '), 'a-new-password-1'))
  assert.equal(wrong.status, 401)
  assert.match(wrong.message, /don't match/)

  const back = await api.recoverAccount(username, r.recoveryKey.toUpperCase().split(' ').join('-'), 'a-new-password-1')
  assert.equal(back.recoveryKey.split(' ').length, 12)
  assert.notEqual(back.recoveryKey, r.recoveryKey)
  assert.equal(back.recoveryKeyAcked, false)
  assert.equal((await api.getMe(back.token)).username, username)
  assert.equal((await rejection(api.login(username, PASSWORD))).status, 401)
  await api.login(username, 'a-new-password-1')
  // the old session ended, and the spent key is dead
  assert.equal((await rejection(api.getMe(r.token))).status, 401)
  assert.equal((await rejection(api.recoverAccount(username, r.recoveryKey, 'third-password-1'))).status, 401)
  // the new key works once confirmed
  await api.ackRecoveryKey(back.token)
  await api.recoverAccount(username, back.recoveryKey, 'third-password-1')
})

test('changing the password needs the current one and keeps this session; a new key needs it too', async () => {
  const username = newName()
  const r = await api.register(username, PASSWORD)
  await api.ackRecoveryKey(r.token)
  const other = await api.login(username, PASSWORD)

  assert.equal((await rejection(api.changePassword(r.token, 'wrong-password', 'brand-new-pass-1'))).status, 401)
  assert.equal((await rejection(api.changePassword(r.token, PASSWORD, 'short'))).status, 400)
  const changed = await api.changePassword(r.token, PASSWORD, 'brand-new-pass-1')
  assert.equal((await api.getMe(changed.token)).username, username)
  assert.equal((await rejection(api.getMe(r.token))).status, 401)
  assert.equal((await rejection(api.getMe(other.token))).status, 401)

  assert.equal((await rejection(api.createRecoveryKey(changed.token, PASSWORD))).status, 401) // the old password no longer works
  const made = await api.createRecoveryKey(changed.token, 'brand-new-pass-1')
  assert.equal(made.recoveryKey.split(' ').length, 12)
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

// --- Phase 2b: ownership transfer and owner-only delete ---

test('the server list and server say who owns it, and the owner hands it to a member', async () => {
  const { admin, server } = await world()
  const code = await api.createServerCode(admin.token, server.id, { singleUse: false, expiresInMinutes: null })
  const friend = await account()
  await api.joinServerWithCode(friend.token, code.code)

  assert.equal((await api.getServer(admin.token, server.id)).isOwner, true)
  assert.equal((await api.getServer(friend.token, server.id)).isOwner, false)
  assert.equal((await api.listServers(admin.token)).servers.find((s) => s.id === server.id).isOwner, true)
  const before = (await api.getMembers(admin.token, server.id)).members
  assert.deepEqual(before.filter((m) => m.isOwner).map((m) => m.accountId), [admin.id])

  assert.equal((await rejection(api.transferServer(admin.token, server.id, friend.id, 'wrong-password'))).status, 401)
  assert.equal((await rejection(api.transferServer(friend.token, server.id, admin.id, PASSWORD))).status, 403)
  await api.transferServer(admin.token, server.id, friend.id, PASSWORD)

  const after = (await api.getMembers(admin.token, server.id)).members
  assert.deepEqual(after.filter((m) => m.isOwner).map((m) => m.accountId), [friend.id])
  assert.equal(after.find((m) => m.accountId === admin.id).isAdmin, true) // the old owner stays an admin
  assert.equal((await api.getServer(friend.token, server.id)).isOwner, true)
  assert.equal((await api.getServer(admin.token, server.id)).isOwner, false)
})

test('only the owner can delete a server, and only with their password', async () => {
  const { admin, server } = await world()
  const code = await api.createServerCode(admin.token, server.id, { singleUse: false, expiresInMinutes: null })
  const friend = await account()
  await api.joinServerWithCode(friend.token, code.code)
  await api.transferServer(admin.token, server.id, friend.id, PASSWORD)

  const old = await rejection(api.deleteServer(admin.token, server.id, PASSWORD)) // now just an admin
  assert.equal(old.status, 403)
  assert.match(old.message, /owner/)
  assert.equal((await rejection(api.deleteServer(friend.token, server.id, 'wrong-password'))).status, 401)
  await api.deleteServer(friend.token, server.id, PASSWORD)
  assert.equal((await rejection(api.getServer(friend.token, server.id))).status, 403)
})

// --- 2b follow-ups: admins, session ended, deleted server ---

test('the owner makes a member an admin and takes it away; others cannot', async () => {
  const { admin, server } = await world()
  const code = await api.createServerCode(admin.token, server.id, { singleUse: false, expiresInMinutes: null })
  const a = await account()
  const b = await account()
  await api.joinServerWithCode(a.token, code.code)
  await api.joinServerWithCode(b.token, code.code)

  assert.equal((await api.getServer(a.token, server.id)).isAdmin, false)
  const made = await api.setMemberAdmin(admin.token, server.id, a.id, true)
  assert.equal(made.member.isAdmin, true)
  assert.equal((await api.getServer(a.token, server.id)).isAdmin, true) // what the tree's check picks up
  assert.equal((await rejection(api.setMemberAdmin(a.token, server.id, b.id, true))).status, 403) // an admin cannot
  assert.equal((await rejection(api.setMemberAdmin(b.token, server.id, a.id, false))).status, 403) // nor a member
  assert.equal((await rejection(api.setMemberAdmin(admin.token, server.id, admin.id, false))).status, 400) // the owner stays one

  const back = await api.setMemberAdmin(admin.token, server.id, a.id, false)
  assert.equal(back.member.isAdmin, false)
  assert.equal((await api.getServer(a.token, server.id)).isAdmin, false)
})

test('a request that finds the session over tells the app, but a wrong password does not', async () => {
  const username = newName()
  const r = await api.register(username, PASSWORD)
  await api.ackRecoveryKey(r.token)
  const other = await api.login(username, PASSWORD)

  const seen = []
  api.setSessionEndedHandler((info) => seen.push(info))
  try {
    // a wrong password on a route that asks for one is not the session ending
    await rejection(api.changePassword(r.token, 'wrong-password', 'brand-new-pass-1'))
    await rejection(api.login(username, 'wrong-password'))
    assert.deepEqual(seen, [])

    const changed = await api.changePassword(r.token, PASSWORD, 'brand-new-pass-1')
    const err = await rejection(api.getMe(other.token)) // the other window's next request
    assert.equal(err.status, 401)
    assert.equal(err.reason, 'session_ended')
    assert.equal(seen.length, 1)
    assert.equal(seen[0].token, other.token) // so the app can ignore requests from an older token
    assert.equal(seen[0].reason, 'session_ended')
    assert.match(seen[0].message, /password was changed/)
    await api.getMe(changed.token) // the window that changed it carries on, with no call to the handler
    assert.equal(seen.length, 1)
  } finally {
    api.setSessionEndedHandler(null)
  }
})

test('people in a deleted server are told it was deleted, and a kick keeps its wording', async () => {
  const { admin, server } = await world()
  const code = await api.createServerCode(admin.token, server.id, { singleUse: false, expiresInMinutes: null })
  const a = await account()
  const kicked = await account()
  await api.joinServerWithCode(a.token, code.code)
  await api.joinServerWithCode(kicked.token, code.code)
  await api.kickMember(admin.token, server.id, kicked.id)
  const k = await rejection(api.getServer(kicked.token, server.id))
  assert.equal(k.reason, 'removed')
  assert.match(accessEndedNotice(k), /removed/)

  await api.deleteServer(admin.token, server.id, PASSWORD)
  const gone = await rejection(api.getServer(a.token, server.id))
  assert.equal(gone.status, 403)
  assert.equal(gone.reason, 'deleted')
  assert.equal(accessEndedNotice(gone), 'This server was deleted.')
})

// --- Phase 2c: deleting an account, and what its messages become ---

test('deleting an account needs the password, is refused for an owner with the servers named, then redacts the messages', async () => {
  const { admin, server } = await world()
  const code = await api.createServerCode(admin.token, server.id, { singleUse: false, expiresInMinutes: null })
  const leaver = await account()
  await api.joinServerWithCode(leaver.token, code.code)
  const chat = await api.createChannel(admin.token, server.id, { name: 'persistent', mode: 'text', persistent: true })
  await api.postMessage(leaver.token, 'channel', chat.id, { text: 'a secret that should go', avatarColor: '#abcdef' })
  await api.postMessage(admin.token, 'channel', chat.id, { text: 'this one stays' })

  assert.equal((await rejection(api.deleteAccount(leaver.token, 'wrong-password'))).status, 401)
  // the owner of a server is refused, and told which one
  const refused = await rejection(api.deleteAccount(admin.token, PASSWORD))
  assert.equal(refused.status, 409)
  assert.equal(refused.reason, 'owns_servers')
  assert.deepEqual(refused.servers.map((s) => s.id), [server.id])

  await api.deleteAccount(leaver.token, PASSWORD)
  const msgs = await api.getMessages(admin.token, 'channel', chat.id)
  assert.equal(msgs.length, 2)
  assert.equal(msgs[0].redacted, true)
  assert.equal(msgs[0].text, '')
  assert.equal(msgs[0].author, null)
  assert.equal(typeof msgs[0].time, 'string') // still has a time, so the conversation reads in order
  assert.equal(msgs[1].text, 'this one stays')
  assert.equal(msgs[1].redacted, false)
  // the deleted account's window is told so, and its username is free
  assert.equal((await rejection(api.getMe(leaver.token))).reason, 'session_expired')
})

test('music: the owner links Jellyfin, members only learn that it is linked, the panel state and controls follow the roles', async () => {
  const jelly = await startFakeJellyfin()
  try {
    const { admin: owner, server } = await world()
    const code = await api.createServerCode(owner.token, server.id, { singleUse: false, expiresInMinutes: null })
    const member = await account()
    await api.joinServerWithCode(member.token, code.code)
    const room = await api.createChannel(owner.token, server.id, { name: 'jukebox', mode: 'both', persistent: true })

    // nothing linked: hidden for everyone
    assert.deepEqual(await api.getMusic(member.token, server.id), { linked: false })
    assert.equal((await api.getMusicState(member.token, 'channel', room.id)).available, false)

    // only the owner links; a wrong key is refused with a message and saves nothing
    assert.equal((await rejection(api.linkMusic(member.token, server.id, { address: jelly.url, apiKey: TOKEN }))).status, 403)
    const bad = await rejection(api.linkMusic(owner.token, server.id, { address: jelly.url, apiKey: 'nope' }))
    assert.equal(bad.status, 400)
    assert.ok(bad.message)
    assert.equal((await rejection(api.linkMusic(owner.token, server.id, { address: 'http://169.254.169.254', apiKey: TOKEN }))).status, 400)
    assert.deepEqual(await api.getMusic(owner.token, server.id), { linked: false })

    const linked = await api.linkMusic(owner.token, server.id, { address: jelly.url, apiKey: TOKEN })
    assert.equal(linked.linked, true)
    assert.equal(linked.name, 'Fake Jelly')
    assert.deepEqual(await api.getMusic(owner.token, server.id), { linked: true, address: jelly.url, kind: 'apikey' })
    assert.deepEqual(await api.getMusic(member.token, server.id), { linked: true }) // no address for a member
    assert.equal((await api.testMusic(owner.token, server.id)).ok, true)
    assert.equal((await rejection(api.testMusic(member.token, server.id))).status, 403)

    // the panel: everyone sees it, only the owner and admins control it
    const asMember = await api.getMusicState(member.token, 'channel', room.id)
    assert.equal(asMember.available, true)
    assert.equal(asMember.canControl, false)
    assert.deepEqual(asMember.queue, [])
    assert.equal(asMember.nowPlaying, null)
    assert.equal((await api.getMusicState(owner.token, 'channel', room.id)).canControl, true)
    assert.equal((await rejection(api.musicControl(member.token, 'channel', room.id, { action: 'pause' }))).status, 403)
    // an admin has to be in the room to press anything
    assert.equal((await rejection(api.musicControl(owner.token, 'channel', room.id, { action: 'skip' }))).status, 409)

    // search is for admins; results carry what the panel shows
    assert.equal((await rejection(api.searchMusic(member.token, server.id, 'sun'))).status, 403)
    const found = await api.searchMusic(owner.token, server.id, 'sun')
    assert.deepEqual(found.results[0], {
      kind: 'song', id: SONG_ID, title: 'Sunrise Song', artist: 'The Sunbeams', album: 'Sunny Album', albumId: '00000000000000000000000000000010'
    })

    // cover art arrives as a blob address; a missing cover is null
    const cover = await api.fetchMusicCover(member.token, server.id, SONG_ID)
    assert.match(cover, /^blob:/)
    URL.revokeObjectURL(cover)
    assert.equal(await api.fetchMusicCover(member.token, server.id, MISSING_ID), null)

    // chat messages from the bot are flagged
    await api.postMessage(member.token, 'channel', room.id, { text: '/help' })
    let bot = null
    for (let i = 0; i < 40 && !bot; i++) {
      bot = (await api.getMessages(member.token, 'channel', room.id)).find((m) => m.bot)
      if (!bot) await new Promise((r) => setTimeout(r, 100))
    }
    assert.ok(bot, 'Jellybox should answer /help')
    assert.equal(bot.author, 'Jellybox')
    assert.equal(bot.authorId, null)
    assert.match(bot.text, /Hi, I'm Jellybox/)

    // unlinking hides it again
    assert.equal((await rejection(api.unlinkMusic(member.token, server.id))).status, 403)
    await api.unlinkMusic(owner.token, server.id)
    assert.deepEqual(await api.getMusic(owner.token, server.id), { linked: false })
    assert.equal((await api.getMusicState(member.token, 'channel', room.id)).available, false)
  } finally {
    await jelly.stop()
  }
})
test('history window: the owner sets it, everyone reads it, a dry run changes nothing, others are refused', async () => {
  const { admin: owner, server } = await world()
  const code = await api.createServerCode(owner.token, server.id, { singleUse: false, expiresInMinutes: null })
  const member = await account()
  await api.joinServerWithCode(member.token, code.code)

  assert.equal((await api.getServer(member.token, server.id)).retentionMonths, 12) // the default
  assert.equal((await rejection(api.setRetention(member.token, server.id, 6))).status, 403)
  assert.equal((await rejection(api.setRetention(owner.token, server.id, 5))).status, 400)

  const dry = await api.setRetention(owner.token, server.id, 3, { dryRun: true })
  assert.equal(dry.saved, false)
  assert.equal(typeof dry.willDeleteAtNextCleanup, 'number')
  assert.equal((await api.getServer(owner.token, server.id)).retentionMonths, 12)

  const done = await api.setRetention(owner.token, server.id, 6)
  assert.equal(done.saved, true)
  assert.equal(done.retentionMonths, 6)
  assert.equal(done.willDeleteAtNextCleanup, 0)
  assert.equal((await api.getServer(member.token, server.id)).retentionMonths, 6)
})

test('music: browsing the library, stop and shuffle controls, the new state fields', async () => {
  const jelly = await startFakeJellyfin()
  try {
    const { admin: owner, server } = await world()
    const code = await api.createServerCode(owner.token, server.id, { singleUse: false, expiresInMinutes: null })
    const member = await account()
    await api.joinServerWithCode(member.token, code.code)
    const room = await api.createChannel(owner.token, server.id, { name: 'jukebox', mode: 'both', persistent: true })
    await api.linkMusic(owner.token, server.id, { address: jelly.url, apiKey: TOKEN })

    // alphabetical browsing is for admins and the owner
    const artists = await api.browseMusic(owner.token, server.id, { kind: 'artists' })
    assert.deepEqual(artists.items.map((i) => [i.kind, i.title]), [['artist', 'Album Band'], ['artist', 'Nightingale']])
    assert.equal(artists.total, 2)
    const byLetter = await api.browseMusic(owner.token, server.id, { kind: 'artists', letter: 'N' })
    assert.deepEqual(byLetter.items.map((i) => i.title), ['Nightingale'])
    assert.deepEqual((await api.browseMusic(owner.token, server.id, { kind: 'albums' })).items.map((i) => i.title), ['Four Tracks'])
    const inside = await api.musicChildren(owner.token, server.id, 'artist', ARTIST_ID)
    assert.deepEqual(inside.items.map((i) => [i.kind, i.title]), [['album', 'Four Tracks']])
    assert.equal((await rejection(api.browseMusic(member.token, server.id, { kind: 'artists' }))).status, 403)
    assert.equal((await rejection(api.musicChildren(member.token, server.id, 'artist', ARTIST_ID))).status, 403)
    assert.equal((await rejection(api.browseMusic(owner.token, server.id, { kind: 'genres' }))).status, 400)

    // the panel state now says whether shuffle is on; stop and shuffle are for admins, and need the bot or the room
    const st = await api.getMusicState(member.token, 'channel', room.id)
    assert.equal(st.shuffleAll, false)
    assert.equal(st.active, false) // the bot is not in the room, so the panel is hidden
    assert.equal((await rejection(api.musicControl(member.token, 'channel', room.id, { action: 'stop' }))).status, 403)
    assert.equal((await rejection(api.musicControl(owner.token, 'channel', room.id, { action: 'shuffle', value: true }))).status, 409) // not in the room
    await api.sendPresence(owner.token, 'channel', room.id)
    assert.equal((await rejection(api.musicControl(owner.token, 'channel', room.id, { action: 'stop' }))).status, 409) // nothing is playing
  } finally {
    await jelly.stop()
  }
})


test('pictures: a member sends one, the message carries it, the bytes come back, outsiders and bad files are refused', async () => {
  const { admin, server } = await world()
  const channel = await api.createChannel(admin.token, server.id, { name: 'chat', mode: 'both', persistent: true })
  const member = await account()
  const code = await api.createServerCode(admin.token, server.id, { singleUse: false, expiresInMinutes: null })
  await api.joinServerWithCode(member.token, code.code)
  const stranger = await account()
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const blob = new Blob([png], { type: 'image/png' })

  const sent = await api.postImage(member.token, 'channel', channel.id, blob, { text: 'a dot', avatarColor: '#aabbcc' })
  assert.equal(sent.text, 'a dot')
  assert.deepEqual({ mime: sent.image.mime, width: sent.image.width, height: sent.image.height }, { mime: 'image/png', width: 1, height: 1 })
  assert.ok(sent.time, 'the message gets its display time like any other')

  const list = await api.getMessages(admin.token, 'channel', channel.id)
  assert.equal(list.length, 1)
  assert.equal(list[0].image.id, sent.image.id)

  const url = await api.fetchChatImage(admin.token, sent.image.id)
  assert.match(url, /^blob:/)
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer())
  assert.ok(bytes.subarray(0, 8).equals(png.subarray(0, 8)), 'a real PNG comes back')
  URL.revokeObjectURL(url)

  assert.equal(await api.fetchChatImage(stranger.token, sent.image.id), null, 'someone outside the server gets nothing')
  assert.equal(await api.fetchChatImage(admin.token, 999999), null)
  const refused = await rejection(api.postImage(stranger.token, 'channel', channel.id, blob))
  assert.equal(refused.status, 403)
  const notPicture = await rejection(api.postImage(member.token, 'channel', channel.id, new Blob([Buffer.from('<html>not a picture</html>')], { type: 'image/png' })))
  assert.equal(notPicture.status, 400)
  assert.match(notPicture.message, /real image/)
  assert.equal((await api.getMessages(admin.token, 'channel', channel.id)).length, 1)
})
