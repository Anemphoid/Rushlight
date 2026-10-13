// Takes a screenshot of every screen of the real client (the production build in out/renderer) against a real
// server with a fixed world in it. It is not part of `npm test`: it needs Playwright's Chromium and ffmpeg.
//
//   npm run build
//   RUSHLIGHT_SERVER_DIR=../rushlight-server node scripts/ui-shots/run.mjs [outDir] [--only text]
//
// Playwright is not a dependency of the app: it is found at PLAYWRIGHT_DIR, in node_modules, or in the usual
// global place; the browser at PLAYWRIGHT_CHROMIUM or under /opt/pw-browsers. The server comes from
// RUSHLIGHT_SERVER_DIR (a checkout with npm ci run). The browser clock is frozen, so the same build gives
// the same pictures each time.
import { join, resolve } from 'node:path'
import { setup, root } from './lib.mjs'
import { flows } from './flows.mjs'

const args = process.argv.slice(2)
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null
const outDir = resolve(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--only') || join(root, 'docs', 'ui-audit', 'screens'))

const s = await setup({ outDir, only })
try {
  await flows(s)
} finally {
  console.log(`\n${s.taken.length} pictures in ${outDir}`)
  if (s.log.length) console.log('Browser errors seen:\n' + [...new Set(s.log)].join('\n'))
  await s.close()
}
