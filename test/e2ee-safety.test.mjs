// Safety numbers, verified ticks and new-device notices: the pure parts, and the whole thing against a real server
// with real people who add computers. (The dialog and banner themselves are drawn by React and checked by eye.)
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createECDH } from 'node:crypto'
import { deviceFingerprint, safetyNumber } from '../src/renderer/src/e2ee/safety.js'
import { createTrust, findNotices } from '../src/renderer/src/e2ee/trust.js'
import { startServer, installBridge, openServerDb } from './helpers.mjs'

const pub = () => {
  const e = createECDH('prime256v1')
  e.generateKeys()
  return e.getPublicKey().toString('base64url')
}
const mem = () => {
  const m = new Map()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }
}

test('a safety number has six groups of five digits, is the same in any order, and changes with any device', async () => {
  const [a, b, c] = [pub(), pub(), pub()]
  const n = await safetyNumber([a, b])
  assert.match(n, /^\d{5}( \d{5}){5}$/)
  assert.equal(await safetyNumber([b, a]), n)
  assert.equal(await safetyNumber([a, b, a]), n, 'the same device twice is one device')
  assert.notEqual(await safetyNumber([a, b, c]), n)
  assert.notEqual(await safetyNumber([a]), n)
  assert.equal(await safetyNumber([]), '')
  assert.match(await deviceFingerprint(a), /^\d{5}( \d{5}){3}$/)
  assert.notEqual(await deviceFingerprint(a), await deviceFingerprint(b))
  await assert.rejects(() => safetyNumber(['not a key!']))
})

test('the first look at a person is a baseline; a new device after that is a notice; a verified number that moved is a notice', () => {
  const trust = createTrust(mem(), 'x|1')
  const dev = (id, accountId) => ({ id, accountId, username: 'u' + accountId, label: 'pc', createdAt: 1 })
  const people = (list, number) => {
    const by = {}
    for (const d of list) (by[d.accountId] ||= { accountId: d.accountId, username: d.username, devices: [], number }).devices.push(d)
    return by
  }
  const look = (p) => findNotices({ people: p, myAccountId: 1, myDeviceId: 10, trust, serverId: 5 })
  const first = look(people([dev(10, 1), dev(20, 2)], 'N1'))
  assert.deepEqual(first.notices, [])
  assert.equal(first.baseline.length, 2)
  for (const [id, ids] of first.baseline) trust.setSeen(5, id, ids)
  assert.deepEqual(look(people([dev(10, 1), dev(20, 2)], 'N1')).notices, [])
  const added = look(people([dev(10, 1), dev(20, 2), dev(21, 2)], 'N2'))
  assert.equal(added.notices.length, 1)
  assert.equal(added.notices[0].accountId, 2)
  assert.equal(added.notices[0].own, false)
  assert.deepEqual(added.notices[0].newDevices.map((d) => d.id), [21])
  trust.setVerified(2, 'N2')
  assert.equal(look(people([dev(10, 1), dev(20, 2), dev(21, 2)], 'N2')).notices.length, 1, 'still unseen')
  trust.setSeen(5, 2, [20, 21])
  assert.deepEqual(look(people([dev(10, 1), dev(20, 2), dev(21, 2)], 'N2')).notices, [])
  const moved = look(people([dev(10, 1), dev(20, 2)], 'N3'))
  assert.equal(moved.notices.length, 1)
  assert.equal(moved.notices[0].verifiedChanged, true)
  assert.deepEqual(moved.notices[0].newDevices, [])
  const own = look(people([dev(10, 1), dev(11, 1), dev(20, 2), dev(21, 2)], 'N2'))
  assert.equal(own.notices.find((n) => n.accountId === 1).own, true)
  assert.deepEqual(own.notices.find((n) => n.accountId === 1).newDevices.map((d) => d.id), [11], 'this computer is never "new" to itself')
})

let srv, api, session, counter = 0
before(async () => {
  srv = await startServer({ ACCOUNT_LIMIT: '1000', DEVICE_LIMIT: '1000' })
  installBridge(srv.url, { version: '0.22.0' })
  api = await import('../src/renderer/src/api.js')
  await api.getMe('x').catch(() => {})
  session = await import('../src/renderer/src/e2eeSession.js')
  session.setTrustStorage(mem())
})
after(async () => {
  if (srv) await srv.stop()
})

test('against a real server: a new computer for someone is noticed, a verified tick survives until their devices change, and dismissing clears it', async () => {
  const person = async (n) => api.register(`${n}${++counter}safe`, 'password123')
  const owner = await person('owner')
  const server = await api.createServer(owner.token, 'S')
  const code = await api.createServerCode(owner.token, server.id, { singleUse: false, expiresInMinutes: null })
  const member = await person('member')
  await api.joinServerWithCode(member.token, code.code)
  const db = openServerDb(srv.dbPath)
  db.prepare('UPDATE servers SET e2ee_enabled = 1 WHERE id = ?').run(server.id)
  db.close()
  const info = async (who) => (await api.getServer(who.token, server.id)).e2ee
  for (const [who, admin] of [[owner, true], [member, false]]) {
    await session.refresh({ token: who.token, accountId: who.id, serverId: server.id, e2ee: await info(who), isAdmin: admin })
  }
  const args = (who) => ({ token: who.token, accountId: who.id, serverId: server.id })
  const view = () => session.trustOf(session.getTrustSnapshot(), server.id)

  await session.checkDevices(args(owner))
  assert.deepEqual(view().notices, [], 'the first look is a baseline')
  const them = view().people[member.id]
  assert.match(them.number, /^\d{5}( \d{5}){5}$/)
  assert.equal(session.isVerified(owner.id, them), false)

  await session.setVerified({ ...args(owner), personId: member.id, verified: true })
  assert.equal(session.isVerified(owner.id, view().people[member.id]), true)

  await api.registerDevice(member.token, pub(), 'laptop')
  await session.checkDevices(args(owner))
  const n = view().notices
  assert.equal(n.length, 1)
  assert.equal(n[0].username, member.username ?? n[0].username)
  assert.equal(n[0].accountId, member.id)
  assert.equal(n[0].verifiedChanged, true)
  assert.deepEqual(n[0].newDevices.map((d) => d.label), ['laptop'])
  assert.equal(session.isVerified(owner.id, view().people[member.id]), false, 'the old tick no longer matches')

  await session.dismissNotice({ ...args(owner), noticeId: n[0].id })
  assert.deepEqual(view().notices, [])
  assert.equal(session.isVerified(owner.id, view().people[member.id]), false, 'a tick has to be earned again')

  // your own account: another computer shows up on the first one
  await api.registerDevice(owner.token, pub(), 'old desktop')
  await session.checkDevices(args(owner))
  assert.equal(view().notices.length, 1)
  assert.equal(view().notices[0].own, true)
  assert.deepEqual(view().notices[0].newDevices.map((d) => d.label), ['old desktop'])
  session.lock()
  assert.deepEqual(view().notices, [])
})
