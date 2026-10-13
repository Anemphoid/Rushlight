// Takes a screenshot of every screen of the real client (the production build in out/renderer) against a real
// server with a fixed world in it. It is not part of `npm test`: it needs Playwright's Chromium and ffmpeg.
//
//   npm run build
//   RUSHLIGHT_SERVER_DIR=../rushlight-server node scripts/ui-shots/run.mjs [outDir] [--only text] [--dist otherBuild/out/renderer]
//
// Playwright is not a dependency of the app: it is found at PLAYWRIGHT_DIR, in node_modules, or in the usual
// global place; the browser at PLAYWRIGHT_CHROMIUM or under /opt/pw-browsers. The server comes from
// RUSHLIGHT_SERVER_DIR (a checkout with npm ci run). The browser clock is frozen, so the same build gives
// the same pictures each time.
import { join, resolve } from 'node:path'
import { setup, root } from './lib.mjs'
import { flows } from './flows.mjs'

const args = process.argv.slice(2)
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
const only = opt('--only')
const dist = opt('--dist') // another build to photograph, e.g. main's, to compare with this one
const positional = args.find((a, i) => !a.startsWith('--') && !['--only', '--dist'].includes(args[i - 1]))
const outDir = resolve(positional || join(root, 'docs', 'ui-audit', 'screens'))

const s = await setup({ outDir, only, distDir: dist ? resolve(dist) : undefined })
try {
  await flows(s)
} finally {
  console.log(`\n${s.taken.length} pictures in ${outDir}`)
  if (s.log.length) console.log('Browser errors seen:\n' + [...new Set(s.log)].join('\n'))
  await s.close()
}
