// Owner succession from the app's side, against a real server (needs server v0.21.0). The 90 and 14 day periods are
// settings of the server, so here they run in seconds: the owner counts as dormant after 1.5 s, a claim waits 1.5 s.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, installBridge } from './helpers.mjs'

let srv, api
const DORMANT = 1500
before(async () => {
  srv = await startServer({
    OWNER_DORMANT_MS: String(DORMANT),
    SUCCESSION_NOTICE_MS: '1500',
    SUCCESSION_CHECK_MS: '100',
    SEEN_EVERY_MS: '20',
    NOTICE_KEEP_MS: '60000',
    ACCOUNT_LIMIT: '1000'
  })
  installBridge(srv.url, { version: '0.32.0' })
  api = await import('../src/renderer/src/api.js')
})
after(async () => {
  if (srv) await srv.stop()
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let n = 0
const account = async () => {
  const a = await api.register(`suc${++n}x`, 'password123')
  await api.ackRecoveryKey(a.token)
  return a
}
async function world(admins = 2) {
  const owner = await account()
  const s = await api.createServer(owner.token, 'Vanished')
  const code = await api.createServerCode(owner.token, s.id, { singleUse: false, expiresInMinutes: null })
  const adm = []
  for (let i = 0; i < admins; i++) {
    const a = await account()
    await api.joinServerWithCode(a.token, code.code)
    await api.setMemberAdmin(owner.token, s.id, a.id, true)
    adm.push(a)
  }
  const member = await account()
  await api.joinServerWithCode(member.token, code.code)
  return { owner, s, adm, member }
}
const rejection = (p) => p.then(() => assert.fail('should have been refused'), (e) => e)

test('the claim goes through the app calls: refused while the owner is here, then started, voted on and passed', async () => {
  const w = await world()
  const [a, b] = w.adm
  const early = await rejection(api.startSuccessionClaim(a.token, w.s.id, 'password123'))
  assert.equal(early.status, 409)
  const view = await api.getServer(a.token, w.s.id)
  assert.equal(view.ownerStatus.dormant, false)
  assert.equal(view.succession, null)

  await sleep(DORMANT + 300)
  assert.equal((await api.getServer(a.token, w.s.id)).ownerStatus.dormant, true)
  assert.equal((await rejection(api.startSuccessionClaim(a.token, w.s.id, 'wrong-password'))).status, 401)
  await api.startSuccessionClaim(a.token, w.s.id, 'password123')

  // every member sees it, only the other admin can vote
  const seen = await api.getServer(w.member.token, w.s.id)
  assert.equal(seen.succession.claimantName, a.username)
  assert.equal(seen.succession.canVote, false)
  const mine = await api.getServer(b.token, w.s.id)
  assert.equal(mine.succession.canVote, true)
  await api.voteSuccession(b.token, w.s.id, 'yes')

  await sleep(2200)
  const after = await api.getServer(w.member.token, w.s.id)
  assert.equal(after.succession, null)
  assert.ok(after.notices.some((x) => x.kind === 'owner_changed' || /owner/i.test(x.text)), 'everyone is told')
  assert.equal((await api.getServer(a.token, w.s.id)).isOwner, true)
  assert.equal((await api.getServer(w.owner.token, w.s.id)).isOwner, false)
})

test('the owner signing in ends a claim at once', async () => {
  const w = await world()
  await sleep(DORMANT + 300)
  await api.startSuccessionClaim(w.adm[0].token, w.s.id, 'password123')
  assert.ok((await api.getServer(w.member.token, w.s.id)).succession)
  await api.getServer(w.owner.token, w.s.id)
  await sleep(300)
  assert.equal((await api.getServer(w.member.token, w.s.id)).succession, null)
})

test('a claimant can withdraw', async () => {
  const w = await world()
  await sleep(DORMANT + 300)
  await api.startSuccessionClaim(w.adm[0].token, w.s.id, 'password123')
  await api.withdrawSuccession(w.adm[0].token, w.s.id)
  assert.equal((await api.getServer(w.member.token, w.s.id)).succession, null)
})
