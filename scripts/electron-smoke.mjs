// Starts the real app (the Electron program, not a browser) and checks the things that differ from system to system: that the
// window appears, can be resized and maximized (the title bar buttons, through the real preload and main process), that the
// preload and the page agree which system this is, that the sign-in screen draws and says plainly when it cannot reach the server,
// and that the global push-to-talk hook (a native module) loads. There is no server: the config points at an address nothing
// listens on, which is also the "cannot reach the server" case.
//
//   npm run build && node scripts/electron-smoke.mjs                 runs from source with the Electron in node_modules
//   node scripts/electron-smoke.mjs --exe dist/win-unpacked/Rushlight.exe     runs an unpacked build (the Windows CI does this)
//   [--out DIR]   where the screenshots go
//
// On Windows every check must pass. Elsewhere the checks that need a window manager or the key hook are reported, not required
// (a virtual display has neither). Needs Playwright (PLAYWRIGHT_DIR, node_modules/playwright, or a global install).
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const outDir = resolve(arg('--out') || mkdtempSync(join(tmpdir(), 'electron-smoke-')))
mkdirSync(outDir, { recursive: true })

function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_DIR, join(root, 'node_modules', 'playwright'), '/opt/node22/lib/node_modules/playwright'].filter(Boolean)
  for (const t of tries) if (existsSync(t)) return createRequire(import.meta.url)(t)
  throw new Error('Playwright is not installed (npm i --no-save playwright, or set PLAYWRIGHT_DIR)')
}
const { _electron } = loadPlaywright()

const strict = process.platform === 'win32'
const results = []
const ok = (m) => {
  results.push(m)
  console.log('  ok   ' + m)
}
const note = (m) => console.log('  --   ' + m)

const userData = mkdtempSync(join(tmpdir(), 'rushlight-smoke-data-'))
writeFileSync(join(userData, 'server-config.json'), JSON.stringify({ serverUrl: 'http://127.0.0.1:9' }))

const exe = arg('--exe')
const launchArgs = [...(exe ? [] : [root]), `--user-data-dir=${userData}`]
// as root (the cloud sandbox) Chromium's sandbox refuses to start
if (process.platform === 'linux' && process.getuid && process.getuid() === 0) launchArgs.push('--no-sandbox')
const executablePath = exe ? resolve(exe) : createRequire(import.meta.url)('electron')

console.log(`Electron smoke test (${process.platform}${exe ? ', ' + exe : ', from source'})`)
const app = await _electron.launch({ executablePath, args: launchArgs, timeout: 90000 })
let failed = false
try {
  const page = await app.firstWindow()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  await page.waitForSelector('#auth-username', { timeout: 60000 })
  ok('the sign-in screen draws')
  await page.screenshot({ path: join(outDir, 'sign-in.png') })

  const facts = await app.evaluate(({ BrowserWindow, app: a }) => {
    const w = BrowserWindow.getAllWindows()[0]
    return { platform: process.platform, visible: w.isVisible(), resizable: w.isResizable(), maximizable: w.isMaximizable(), packaged: a.isPackaged, version: a.getVersion(), bounds: w.getBounds() }
  })
  assert.equal(facts.visible, true, 'the window is shown')
  assert.equal(facts.resizable, true, 'the sign-in window can be resized')
  assert.equal(facts.maximizable, true, 'the window can be maximized')
  ok(`the window is shown, resizable and maximizable (${facts.bounds.width}x${facts.bounds.height}, version ${facts.version}${facts.packaged ? ', packaged' : ''})`)

  const pageFacts = await page.evaluate(() => ({
    apiPlatform: window.api && window.api.platform,
    dataPlatform: document.documentElement.dataset.platform,
    radius: getComputedStyle(document.querySelector('.app-shell')).borderRadius
  }))
  assert.equal(pageFacts.apiPlatform, facts.platform, 'the preload says which system this is')
  assert.equal(pageFacts.dataPlatform, facts.platform, 'the page knows which system this is')
  assert.equal(pageFacts.radius, facts.platform === 'win32' ? '0px' : '10px', 'rounded corners only where the window is transparent')
  ok(`the page matches the system (${facts.platform}: corner radius ${pageFacts.radius})`)

  // the title bar buttons, which go through the preload to the main process and back
  try {
    await page.click('button[title="Maximize"]', { timeout: 5000 })
    await page.waitForSelector('.app-shell.maximized', { timeout: 8000 })
    const max = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())
    assert.equal(max, true)
    await page.click('button[title="Restore"]', { timeout: 5000 })
    await page.waitForSelector('.app-shell:not(.maximized)', { timeout: 8000 })
    ok('maximize and restore work from the title bar')
  } catch (e) {
    if (strict) throw e
    note('maximize and restore not confirmed here (a virtual display has no window manager): ' + String(e.message).split('\n')[0])
  }

  const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 700))
  await page.waitForTimeout(400)
  const after = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
  assert.ok(Math.abs(after.width - 1000) <= 40 && Math.abs(after.height - 700) <= 40, `resized to about 1000x700, got ${after.width}x${after.height} (was ${before.width}x${before.height})`)
  ok('the window can be resized')

  const hook = await page.evaluate(() => window.api.getPttHookStatus())
  if (hook.ok) ok('the global push-to-talk hook (native module) loaded')
  else if (strict) assert.fail('the push-to-talk hook did not load: ' + hook.error)
  else note('the push-to-talk hook did not load here: ' + hook.error)

  // no server: the sign-in says so, in a plain sentence naming the address
  await page.fill('#auth-username', 'nobody')
  await page.fill('#auth-password', 'password123')
  await page.click('button.auth-primary:has-text("Log in")')
  await page.waitForSelector('.auth-server:has-text("reach the server")', { timeout: 20000 })
  const sentence = await page.textContent('.auth-server')
  assert.match(sentence, /127\.0\.0\.1:9/, 'names the address')
  assert.doesNotMatch(sentence, /Failed to fetch/, 'never the raw browser message')
  ok('with no server, sign-in says so plainly and names the address')
  await page.screenshot({ path: join(outDir, 'cannot-reach.png') })

  assert.deepEqual(pageErrors, [], 'no uncaught errors in the page')
  ok('no uncaught errors in the page')
} catch (e) {
  failed = true
  console.error('  FAIL ' + (e && e.message ? e.message : e))
  try {
    const page = app.windows()[0]
    if (page) await page.screenshot({ path: join(outDir, 'failure.png') })
  } catch {
    // the window may be gone
  }
}
await app.close().catch(() => {})
console.log(`Screenshots in ${outDir}`)
if (failed) process.exit(1)
console.log(`All ${results.length} Electron checks passed.`)
