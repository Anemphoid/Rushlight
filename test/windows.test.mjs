// The Windows build, as far as a Linux machine can see it: how the window is made on each system, when the app updates itself, and
// that the installer is set up to need no administrator rights and keep one file name. (The real checks run on Windows itself:
// scripts/electron-smoke.mjs, in the CI "windows" job.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { windowFrame, canSelfUpdate } from '../src/main/windowOptions.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

test('Windows gets a solid frameless window, because a transparent one cannot be resized there', () => {
  const win = windowFrame('win32')
  assert.equal(win.frame, false)
  assert.equal(win.transparent, false)
  assert.match(win.backgroundColor, /^#[0-9a-f]{6}$/i)
})

test('Linux and Mac keep the transparent frameless window with the page drawing its own corners', () => {
  for (const p of ['linux', 'darwin']) assert.deepEqual(windowFrame(p), { frame: false, transparent: true })
})

test('the page squares its corners exactly where the window is solid', () => {
  const css = read('src/renderer/src/index.css')
  assert.match(css, /html\[data-platform="win32"\]\s+\.app-shell\s*\{\s*border-radius:\s*0/)
  const main = read('src/renderer/src/main.jsx')
  assert.match(main, /dataset\.platform\s*=\s*window\.api\.platform/)
  assert.match(read('src/preload/index.js'), /platform:\s*process\.platform/)
})

test('the main process builds its window from windowFrame, not a hard-coded transparent flag', () => {
  const index = read('src/main/index.js')
  assert.match(index, /\.\.\.windowFrame\(process\.platform\)/)
  assert.doesNotMatch(index, /transparent:\s*true/)
})

test('the app updates itself when installed on Windows or run as an AppImage, never from source', () => {
  assert.equal(canSelfUpdate({ platform: 'win32', packaged: true }), true)
  assert.equal(canSelfUpdate({ platform: 'win32', packaged: false }), false)
  assert.equal(canSelfUpdate({ platform: 'linux', packaged: true, appImage: '/x/Rushlight.AppImage' }), true)
  assert.equal(canSelfUpdate({ platform: 'linux', packaged: true }), false)
  assert.equal(canSelfUpdate({ platform: 'linux', packaged: false, appImage: '/x' }), false)
})

test('the Windows installer is per person (no administrator rights) and has one fixed file name', () => {
  const yml = read('electron-builder.yml')
  assert.match(yml, /^win:\s*\n\s+target:\s*\n\s+- target: nsis/m)
  assert.match(yml, /perMachine:\s*false/)
  assert.match(yml, /allowElevation:\s*false/)
  assert.match(yml, /oneClick:\s*true/)
  assert.match(yml, /artifactName:\s*\$\{productName\}-Setup\.\$\{ext\}/)
})

test('only one copy runs at a time, and Windows gets its notification id', () => {
  const index = read('src/main/index.js')
  assert.match(index, /requestSingleInstanceLock\(\)/)
  assert.match(index, /on\('second-instance'/)
  assert.match(index, /setAppUserModelId\('cc\.rushlight\.app'\)/)
  // the id must be the one the installer is built with
  assert.match(read('electron-builder.yml'), /^appId: cc\.rushlight\.app$/m)
})

test('the release step on Windows runs in bash, because PowerShell splits -c.publish.x=y at the dot (v0.34.0 failed on it)', () => {
  const step = read('.github/workflows/release.yml').split('Build and publish the Windows installer')[1]
  assert.ok(step, 'the Windows publish step exists')
  const head = step.split('\n      - ')[0]
  assert.match(head, /shell: bash/)
})
