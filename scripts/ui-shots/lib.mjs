// Shared set-up for the screenshot scripts: the built app served as files, a real server with a fixed world
// in it, and a Chromium with the Electron preload stubbed. See run.mjs for how to run it.
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, extname, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startWorld, seed, NOW } from './world.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const root = resolve(here, '..', '..')

export function findPlaywright() {
  const tries = [process.env.PLAYWRIGHT_DIR, join(root, 'node_modules', 'playwright'), '/opt/node22/lib/node_modules/playwright'].filter(Boolean)
  for (const t of tries) if (existsSync(t)) return createRequire(import.meta.url)(t)
  throw new Error('Playwright not found: set PLAYWRIGHT_DIR')
}
export function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM
  const base = '/opt/pw-browsers'
  const d = readdirSync(base).filter((n) => /^chromium-\d+$/.test(n)).sort().pop()
  return join(base, d, 'chrome-linux', 'chrome')
}

const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.json': 'application/json' }

// What Electron's preload gives the page, as stubs. `window.__cb` lets a script fire the callbacks.
const stub = (serverUrl, version) => `
  window.__cb = {}
  const ok = (v) => () => Promise.resolve(v)
  window.api = {
    windowMinimize: ok(), windowMaximizeToggle: ok(), windowClose: ok(), windowIsMaximized: ok(false),
    windowSetLoginSize: (w, h) => (window.__setLoginSize ? window.__setLoginSize(w, h) : Promise.resolve()), windowRestoreNormalSize: ok(), windowWiden: ok(),
    getServerConfig: ok({ serverUrl: ${JSON.stringify(serverUrl)} }), getVersion: ok(${JSON.stringify(version)}),
    getPendingUpdate: ok(null), installUpdate: ok(),
    onUpdateReady: (cb) => { window.__cb.updateReady = cb; return () => {} },
    setPttKey: ok({ ok: true, hookOk: false }), getPttHookStatus: ok({ ok: false, error: 'stub' }),
    onPttKey: (cb) => { window.__cb.ptt = cb; return () => {} },
    onWindowMaximizedChange: () => () => {}
  }
`

// Runs in the page. Every control a person can use, by what it is called, and whether it can actually be used:
// shown at all, and not covered by something else at its centre (the check that would have caught the Back bar).
function inventory() {
  const SELECTOR = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="link"], summary, [contenteditable="true"]'
  const nameOf = (el) => {
    const label = el.getAttribute('aria-label')
    if (label) return label.trim()
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
      if (l) return l.textContent.replace(/\s+/g, ' ').trim()
    }
    const wrap = el.closest('label')
    if (wrap && el.tagName !== 'BUTTON') {
      const t = wrap.textContent.replace(/\s+/g, ' ').trim()
      if (t) return t
    }
    const field = el.closest('.field')
    if (field && el.tagName !== 'BUTTON') {
      const l = field.querySelector('label')
      if (l) return l.textContent.replace(/\s+/g, ' ').trim()
    }
    const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
    if (text) return text
    return (el.getAttribute('title') || el.getAttribute('placeholder') || el.value || '').trim()
  }
  const out = []
  for (const el of document.querySelectorAll(SELECTOR)) {
    if (el.closest('[hidden]') || el.type === 'hidden') continue
    const style = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const shown = style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0 && Number(style.opacity) > 0
    let covered = false
    if (shown) {
      const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1)
      const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1)
      const inView = r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
      if (inView) {
        const top = document.elementFromPoint(x, y)
        covered = !!top && top !== el && !el.contains(top) && !top.contains(el)
      }
    }
    out.push({
      tag: el.tagName.toLowerCase() + (el.type && el.tagName === 'INPUT' ? ':' + el.type : ''),
      name: nameOf(el).slice(0, 80),
      disabled: !!el.disabled,
      shown,
      covered,
      w: Math.round(r.width),
      h: Math.round(r.height)
    })
  }
  return out
}

export async function setup({ outDir, only = null, distDir = join(root, 'out', 'renderer'), seedWorld = true, worldEnv = {}, fakeMedia = false, chromiumArgs = [] } = {}) {
  mkdirSync(outDir, { recursive: true })
  if (!existsSync(join(distDir, 'index.html'))) throw new Error('Run npm run build first')
  const web = createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0])
    if (p === '/') p = '/index.html'
    const f = join(distDir, p)
    if (!f.startsWith(distDir) || !existsSync(f)) {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' })
    res.end(readFileSync(f))
  })
  await new Promise((r) => web.listen(0, '127.0.0.1', r))
  const appUrl = `http://127.0.0.1:${web.address().port}/`
  const world = await startWorld(worldEnv)
  const cast = seedWorld ? await seed(world) : null
  const { chromium } = findPlaywright()
  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', ...(fakeMedia ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] : []), ...chromiumArgs]
  })
  const log = []
  const taken = []

  async function newPage({ session = null, width = 900, height = 670, skin, mode, density, iconSize, css = '', fixedClock = true, version = '0.14.0', init = '' } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height }, timezoneId: 'UTC', locale: 'en-US', deviceScaleFactor: 1, reducedMotion: process.env.UI_SHOTS_MOTION ? 'no-preference' : 'reduce' })
    const page = await ctx.newPage()
    if (fixedClock) await page.clock.setFixedTime(NOW)
    await page.addInitScript(stub(world.url, version))
    // a fixed sequence for anything the app picks at random (the guest's suggested name, which words to re-type)
    await page.addInitScript(() => {
      let seed = 1234567
      Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
    })
    await page.addInitScript(
      ({ session, skin, mode, density, iconSize, css, motion }) => {
        try {
          if (session) localStorage.setItem('rushlight-session', session)
          if (skin) localStorage.setItem('rushlight-skin', skin)
          if (mode) localStorage.setItem('rushlight-mode', mode)
          if (density) window.__density = density
          if (iconSize) window.__iconSize = iconSize
        } catch {}
        // no caret, no animation: two runs of the same build must match
        const s = document.createElement('style')
        s.textContent = (motion ? '* { caret-color: transparent !important; }' : '* { caret-color: transparent !important; animation: none !important; transition: none !important; }') + css
        document.addEventListener('DOMContentLoaded', () => document.head.appendChild(s))
      },
      { session, skin, mode, density, iconSize, css, motion: !!process.env.UI_SHOTS_MOTION }
    )
    // the login screens ask Electron to size the window to fit them; do the same with the viewport
    await page.exposeFunction('__setLoginSize', async (w, h) => {
      await page.setViewportSize({ width: Math.round(w), height: Math.round(h) }).catch(() => {})
    })
    if (init) await page.addInitScript(init)
    page.on('console', (m) => {
      // no LiveKit server here, so the voice connection always fails; that is expected, not a finding
      if (m.type() === 'error' && !/WebSocket connection to|ERR_UNSAFE_PORT/.test(m.text())) log.push(`[console] ${m.text().slice(0, 200)}`)
    })
    page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`))
    await page.goto(appUrl)
    return page
  }

  async function shot(page, name, { full = false, clip } = {}) {
    if (only && !name.includes(only)) return
    await page.evaluate(() => document.fonts && document.fonts.ready)
    await page.waitForTimeout(250)
    await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: full, clip })
    // what a person can click, type into or choose on this screen, so a restyle can be checked for lost controls
    const controls = await page.evaluate(inventory)
    writeFileSync(join(outDir, `${name}.controls.json`), JSON.stringify(controls, null, 1) + '\n')
    taken.push(name)
    console.log('  shot', name)
  }

  async function close() {
    await browser.close()
    web.close()
    await world.stop()
  }
  return { newPage, shot, close, world, cast, log, taken, appUrl, browser }
}
