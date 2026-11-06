// Drives the real production build in Chromium against a real server: the server's address can be changed on the sign-in
// screen (both layouts) and in Settings > Connection, with no file edit.
//   - "Change" opens one field, prefilled; a bad scheme is refused; Test says whether a server answers; an address nothing
//     answers at says so and offers "Save it anyway";
//   - an address typed with no scheme is found (https is tried, then http), saved, the app reloads and shows it, and the next
//     login goes to it; the saved config keeps `scopeId`, so the encryption keys stay filed where they were;
//   - when the server cannot be reached, login says so in a plain sentence naming the address and offers "Change server
//     address" right there, and fixing it gets the person in;
//   - Settings > Connection has the same field while signed in.
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

  const login = async (page) => {
    await page.fill('#auth-username', 'Mover')
    await page.fill('#auth-password', w.password)
    await page.click('button.auth-primary:has-text("Log in")')
  }
  for (const skin of ['parchment', 'cool-slate']) {
    const page = (pages[skin] = await h.newPage({ skin, width: 1100, height: 760, fixedClock: false, version: '0.33.0' }))
    await page.waitForSelector('.auth-server')
    assert.match(await page.textContent('.auth-server'), new RegExp(`Server\\s+127\\.0\\.0\\.1:${port}`))
    await h.shot(page, `address-${skin}-closed`)

    await page.click('.auth-server button:has-text("Change")')
    await page.waitForSelector('#server-address')
    assert.equal(await page.inputValue('#server-address'), `127.0.0.1:${port}`, 'prefilled with the current address')
    await page.fill('#server-address', 'ftp://somewhere')
    await page.click('.server-editor button[type=submit]')
    await page.waitForSelector('.server-editor .error-text')
    assert.match(await page.textContent('.server-editor .error-text'), /http/)

    await page.fill('#server-address', '127.0.0.1:1')
    await page.click('.server-editor button:has-text("Test")')
    await page.waitForSelector('.server-editor button:has-text("Save it anyway")')
    assert.match(await page.textContent('.server-editor .error-text'), /Couldn't reach/)
    await h.shot(page, `address-${skin}-unreachable`)
    await page.click('.server-editor button:has-text("Cancel")')
    assert.equal(await page.evaluate(() => window.__serverConfig.serverUrl), w.url, 'cancel changes nothing')

    // the same server, typed with no scheme: tested, found, saved, and the app reloads on it
    await page.click('.auth-server button:has-text("Change")')
    await page.fill('#server-address', `localhost:${port}`)
    await page.click('.server-editor button:has-text("Test")')
    await page.waitForSelector('.server-editor-ok')
    assert.match(await page.textContent('.server-editor-ok'), new RegExp(`answers at localhost:${port}`))
    await page.click('.server-editor button[type=submit]')
    await page.waitForSelector('.server-editor-ok:has-text("Reloading")')
    await h.shot(page, `address-${skin}-saved`)
    await page.waitForFunction((p) => !document.querySelector('.server-editor') && document.querySelector('.auth-server')?.textContent.includes(`localhost:${p}`), port, { timeout: 15000 })
    const config = await page.evaluate(() => window.__serverConfig)
    assert.equal(config.serverUrl, `http://localhost:${port}`)
    assert.equal(config.scopeId, w.url, 'the keys stay filed under the first address')

    // the next login goes to the new address
    const seen = []
    page.on('request', (r) => seen.push(r.url()))
    await login(page)
    await page.waitForSelector('.home-screen', { timeout: 20000 }).catch(async (e) => {
      console.log('after login:', (await page.textContent('body')).replace(/\s+/g, ' ').slice(0, 300), '| requests:', seen.join(' '))
      throw e
    })
    assert.ok(seen.some((u) => u.startsWith(`http://localhost:${port}/api/login`)), 'login went to the new address: ' + seen.join(' '))
    assert.ok(!seen.some((u) => u.startsWith(`${w.url}/api/login`)), 'login did not go to the old address')

    if (skin === 'parchment') {
      // Settings > Connection: the same field while signed in
      await page.click('button:has-text("Settings")')
      await page.click('.rl-nav-item:has-text("Connection")')
      await page.waitForSelector('#server-address')
      assert.equal(await page.inputValue('#server-address'), `localhost:${port}`)
      await page.click('.server-editor button:has-text("Test")')
      await page.waitForSelector('.server-editor-ok')
      await h.shot(page, 'address-settings-connection')
    }
  }

  // The server cannot be reached: a plain sentence naming the address, and the way to fix it right there.
  const lost = (pages.lost = await h.newPage({ width: 1100, height: 760, fixedClock: false, version: '0.33.0' }))
  await lost.waitForSelector('.auth-server')
  await lost.click('.auth-server button:has-text("Change")')
  await lost.fill('#server-address', '127.0.0.1:1')
  await lost.click('.server-editor button[type=submit]')
  await lost.click('.server-editor button:has-text("Save it anyway")')
  await lost.waitForFunction(() => !document.querySelector('.server-editor') && document.querySelector('.auth-server')?.textContent.includes('127.0.0.1:1'), null, { timeout: 15000 })
  await login(lost)
  await lost.waitForSelector('.auth-server-problem')
  const sentence = await lost.textContent('.auth-server-problem')
  assert.match(sentence, /Couldn't reach the server at 127\.0\.0\.1:1/)
  assert.ok(!/TypeError|Failed to fetch/.test(await lost.textContent('body')), 'no raw error text on the screen')
  await h.shot(lost, 'address-cannot-reach')
  await lost.click('.auth-server-problem button:has-text("Change server address")')
  await lost.fill('#server-address', `127.0.0.1:${port}`)
  await lost.click('.server-editor button[type=submit]')
  await lost.waitForFunction((p) => !document.querySelector('.server-editor') && document.querySelector('.auth-server')?.textContent.includes(`127.0.0.1:${p}`), port, { timeout: 15000 })
  await login(lost)
  await lost.waitForSelector('.home-screen', { timeout: 20000 })
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
