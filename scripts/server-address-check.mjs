// Drives the real production build in Chromium against a real server: the server's address can be changed on the sign-in
// screen, in both layouts (Lantern's split screen and Slate's card).
//   - "Change" opens an editor; a bad scheme is refused; an address nothing answers at says so and offers "Save it anyway";
//   - a good address (the same server written another way) is checked, saved, shown, and the next login goes to it;
//   - the keys stay filed under the first address (the saved config keeps `scopeId`).
// Needs `npm run build`, Playwright's Chromium and RUSHLIGHT_SERVER_DIR. Not part of `npm test`.
// Run: node scripts/server-address-check.mjs [outDir]
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { setup } from './ui-shots/lib.mjs'

const outDir = process.argv[2] || mkdtempSync(join(tmpdir(), 'server-address-'))
const h = await setup({ outDir, seedWorld: false })
const w = h.world
let failed = false
const pages = {}
try {
  const a = await w.call('POST', '/api/register', { username: 'Mover', password: w.password })
  await w.call('POST', '/api/me/recovery-key/ack', {}, a.token)
  const port = new URL(w.url).port

  for (const skin of ['parchment', 'cool-slate']) {
    const page = (pages[skin] = await h.newPage({ skin, width: 1100, height: 760, fixedClock: false, version: '0.33.0' }))
    await page.waitForSelector('.auth-server')
    assert.match(await page.textContent('.auth-server'), new RegExp(`Server\\s+127\\.0\\.0\\.1:${port}`))
    await h.shot(page, `address-${skin}-closed`)

    await page.click('.auth-server button:has-text("Change")')
    await page.waitForSelector('#auth-server-address')
    await page.fill('#auth-server-address', 'ftp://somewhere')
    await page.click('.auth-server-form button[type=submit]')
    await page.waitForSelector('.auth-server-form .error-text')
    assert.match(await page.textContent('.auth-server-form .error-text'), /http/)

    await page.fill('#auth-server-address', '127.0.0.1:1')
    await page.click('.auth-server-form button[type=submit]')
    await page.waitForSelector('.auth-server-form button:has-text("Save it anyway")')
    assert.match(await page.textContent('.auth-server-form .error-text'), /Couldn't reach/)
    await h.shot(page, `address-${skin}-unreachable`)
    await page.click('.auth-server-form button:has-text("Cancel")')
    assert.equal(await page.evaluate(() => window.__serverConfig.serverUrl), w.url, 'cancel changes nothing')

    // the same server, written another way: checked, saved, shown
    await page.click('.auth-server button:has-text("Change")')
    await page.fill('#auth-server-address', `localhost:${port}`)
    await page.click('.auth-server-form button[type=submit]')
    await page.waitForSelector('.auth-server-note')
    assert.match(await page.textContent('.auth-server'), new RegExp(`localhost:${port}`))
    const config = await page.evaluate(() => window.__serverConfig)
    assert.equal(config.serverUrl, `http://localhost:${port}`)
    assert.equal(config.scopeId, w.url, 'the keys stay filed under the first address')
    await h.shot(page, `address-${skin}-saved`)

    // the next login goes to the new address
    const seen = []
    page.on('request', (r) => seen.push(r.url()))
    await page.fill('#auth-username', 'Mover')
    await page.fill('#auth-password', w.password)
    await page.click('button.auth-primary:has-text("Log in")')
    await page.waitForSelector('.home-screen', { timeout: 20000 })
    assert.ok(seen.some((u) => u.startsWith(`http://localhost:${port}/api/login`)), 'login went to the new address: ' + seen.join(' '))
    assert.ok(!seen.some((u) => u.startsWith(`${w.url}/api/login`)), 'login did not go to the old address')
  }
  console.log('changing the server address in the real build: ok  (pictures in ' + outDir + ')')
} catch (err) {
  failed = true
  console.log('changing the server address: FAILED\n', err)
  for (const [name, p] of Object.entries(pages)) {
    try {
      console.log(`--- ${name}:\n` + (await p.textContent('body')).replace(/\s+/g, ' ').slice(0, 600))
    } catch {
      // page gone
    }
  }
} finally {
  await h.close()
}
process.exit(failed ? 1 : 0)
