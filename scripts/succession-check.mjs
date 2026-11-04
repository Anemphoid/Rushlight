// Drives the real production build in Chromium against a real server (v0.21.0 or later) started with short succession timers
// (the harness's frozen server clock is switched off; dormant after 4 s, a claim waits 6 s):
//   - an admin's Admin Tools > "Owner away?" says the owner is here, then, once the owner has been quiet, starts a claim with
//     the password;
//   - a plain member sees the claim banner (no vote buttons), the other admin sees Vote yes / Vote no;
//   - the yes vote passes it: everyone is told in a banner and the claimant is the owner (Owner Tools button);
//   - the owner opening the app cancels a second claim.
// Needs `npm run build`, Playwright's Chromium and RUSHLIGHT_SERVER_DIR. Not part of `npm test`.
// Run: node scripts/succession-check.mjs [outDir]
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { setup } from './ui-shots/lib.mjs'

const outDir = process.argv[2] || mkdtempSync(join(tmpdir(), 'succession-'))
const h = await setup({
  outDir,
  seedWorld: false,
  worldEnv: { FIXED_NOW: '', OWNER_DORMANT_MS: '4000', SUCCESSION_NOTICE_MS: '6000', SUCCESSION_CHECK_MS: '200', SEEN_EVERY_MS: '100', NOTICE_KEEP_MS: '600000' }
})
const w = h.world
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, what, ms = 30000) => {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error('timed out waiting for ' + what)
    await sleep(250)
  }
}
const text = (p, sel) => p.textContent(sel).catch(() => '')
let failed = false
const pages = {}
try {
  const reg = async (name) => {
    const a = await w.call('POST', '/api/register', { username: name, password: w.password })
    await w.call('POST', '/api/me/recovery-key/ack', {}, a.token)
    return a
  }
  const owner = await reg('Olive')
  const ann = await reg('Ann')
  const bo = await reg('Bobby')
  const cy = await reg('Cyrus')
  const server = await w.call('POST', '/api/servers', { name: 'Hall' }, owner.token)
  const code = await w.call('POST', `/api/servers/${server.id}/codes`, { singleUse: false, expiresInMinutes: null }, owner.token)
  for (const a of [ann, bo, cy]) await w.call('POST', '/api/servers/join', { code: code.code }, a.token)
  for (const a of [ann, bo]) await w.call('POST', `/api/servers/${server.id}/members/${a.id}/admin`, { admin: true }, owner.token)

  const open = async (name, a) => {
    const p = (pages[name] = await h.newPage({ session: a.token, width: 1100, height: 760, fixedClock: false, version: '0.32.0' }))
    await p.click('.rail-btn[title="Hall"]')
    await p.waitForSelector('.channel-tree, .tree-main-col')
    return p
  }
  const annP = await open('ann', ann)
  const boP = await open('bo', bo)
  const cyP = await open('cy', cy)
  await sleep(4500) // the owner is quiet from here on

  await annP.click('button[title="Admin Tools"]')
  await annP.click('.rl-nav-item:has-text("Owner away?")')
  await annP.waitForSelector('#claim-password')
  await annP.fill('#claim-password', w.password)
  await annP.click('button:has-text("Start a claim to become the owner")')
  await boP.waitForSelector('.device-notices:has-text("started a claim")', { timeout: 20000 })
  await cyP.waitForSelector('.device-notices:has-text("started a claim")', { timeout: 20000 })
  assert.equal(await cyP.$('button:has-text("Vote yes")'), null, 'a plain member cannot vote')
  await h.shot(boP, 'succession-claim')
  await boP.click('button:has-text("Vote yes")')
  await until(async () => /You voted yes/.test(await text(boP, '.device-notices')), 'the vote to show')

  await cyP.waitForSelector('.device-notices:has-text("owner")', { timeout: 20000 })
  await until(async () => !(await cyP.$('button:has-text("Vote yes")')) && !/started a claim/.test(await text(cyP, '.device-notices')), 'the claim to end')
  await h.shot(cyP, 'succession-passed')
  await annP.waitForSelector('button[title="Owner Tools"]', { state: 'attached', timeout: 20000 })
  assert.equal((await w.call('GET', `/api/servers/${server.id}`, undefined, ann.token)).isOwner, true)
  console.log('owner succession in the real build: ok  (pictures in ' + outDir + ')')
} catch (err) {
  failed = true
  console.log('owner succession: FAILED\n', err)
  for (const [name, p] of Object.entries(pages)) {
    try {
      console.log(`--- ${name}:\n` + (await p.textContent('body')).replace(/\s+/g, ' ').slice(0, 700))
    } catch {}
  }
} finally {
  await h.close()
}
process.exit(failed ? 1 : 0)
