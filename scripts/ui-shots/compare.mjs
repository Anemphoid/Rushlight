// Compares two folders of screenshots (same file names) pixel by pixel, using the browser to decode them.
// Prints which pictures differ and where, and exits with 1 if any do. This is the "identical screenshots" check
// the UI refresh plan asks for after the tokens migration.
//
//   node scripts/ui-shots/compare.mjs before after [--ignore name1,name2] [--tolerance 0]
import { createRequire } from 'node:module'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const args = process.argv.slice(2)
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null)
const dirs = args.filter((a, i) => !a.startsWith('--') && !['--ignore', '--tolerance'].includes(args[i - 1]))
if (dirs.length !== 2) {
  console.error('usage: compare.mjs beforeDir afterDir [--ignore a,b] [--tolerance n]')
  process.exit(2)
}
const [before, after] = dirs.map((d) => resolve(d))
const ignore = new Set((opt('--ignore') || '').split(',').filter(Boolean))
const tolerance = Number(opt('--tolerance') || 0) // per-channel difference allowed before a pixel counts

const require = createRequire(import.meta.url)
const pw = [process.env.PLAYWRIGHT_DIR, join(root, 'node_modules', 'playwright'), '/opt/node22/lib/node_modules/playwright'].filter((p) => p && existsSync(p))[0]
const { chromium } = require(pw)
const base = '/opt/pw-browsers'
const exe = process.env.PLAYWRIGHT_CHROMIUM || join(base, readdirSync(base).filter((n) => /^chromium-\d+$/.test(n)).sort().pop(), 'chrome-linux', 'chrome')

const names = readdirSync(before).filter((n) => n.endsWith('.png')).sort()
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setContent('<canvas id=c></canvas>')
let different = 0
let missing = 0
let same = 0
for (const n of names) {
  if (ignore.has(n.replace(/\.png$/, '')) || ignore.has(n)) continue
  if (!existsSync(join(after, n))) {
    console.log(`MISSING  ${n}`)
    missing++
    continue
  }
  const a = readFileSync(join(before, n))
  const b = readFileSync(join(after, n))
  if (a.equals(b)) {
    same++
    continue
  }
  const r = await page.evaluate(
    async ({ a, b, tol }) => {
      const load = (b64) =>
        new Promise((ok, bad) => {
          const i = new Image()
          i.onload = () => ok(i)
          i.onerror = bad
          i.src = 'data:image/png;base64,' + b64
        })
      const [ia, ib] = await Promise.all([load(a), load(b)])
      if (ia.width !== ib.width || ia.height !== ib.height) return { size: [ia.width, ia.height, ib.width, ib.height] }
      const c = document.getElementById('c')
      c.width = ia.width
      c.height = ia.height
      const g = c.getContext('2d', { willReadFrequently: true })
      g.drawImage(ia, 0, 0)
      const da = g.getImageData(0, 0, c.width, c.height).data
      g.clearRect(0, 0, c.width, c.height)
      g.drawImage(ib, 0, 0)
      const db = g.getImageData(0, 0, c.width, c.height).data
      let count = 0
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
      for (let i = 0; i < da.length; i += 4) {
        if (Math.abs(da[i] - db[i]) > tol || Math.abs(da[i + 1] - db[i + 1]) > tol || Math.abs(da[i + 2] - db[i + 2]) > tol) {
          count++
          const p = i / 4
          const x = p % c.width
          const y = (p - x) / c.width
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
      }
      return { count, box: count ? [x0, y0, x1, y1] : null, total: c.width * c.height }
    },
    { a: a.toString('base64'), b: b.toString('base64'), tol: tolerance }
  )
  if (r.size) {
    console.log(`SIZE     ${n}  ${r.size[0]}x${r.size[1]} became ${r.size[2]}x${r.size[3]}`)
    different++
  } else if (r.count === 0) {
    same++ // bytes differ (PNG encoding) but every pixel is within tolerance
  } else {
    console.log(`DIFFERS  ${n}  ${r.count} pixels (${((100 * r.count) / r.total).toFixed(2)}%) in box x ${r.box[0]}-${r.box[2]}, y ${r.box[1]}-${r.box[3]}`)
    different++
  }
}
console.log(`\n${same} identical, ${different} different, ${missing} missing, ${ignore.size} ignored`)
await browser.close()
process.exit(different || missing ? 1 : 0)
