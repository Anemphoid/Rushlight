// Draws the app icon (build/icon.png and resources/icon.png) from the Rushlight mark in Lantern's dark colours, so the
// taskbar, launcher and window icon match the app. It needs Playwright's Chromium, found the way the screenshot tool
// finds it (see scripts/ui-shots/lib.mjs).
//
//   node scripts/make-icon.mjs
//
// The mark is the symbol in src/renderer/src/components/RushlightLogo.jsx; if that drawing changes, change it here too
// (the colours are read from the skin file, so a palette change needs no edit).
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findPlaywright, findChromium } from './ui-shots/lib.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'src/renderer/src/styles/skins/lantern.css'), 'utf8')
// the dark block is the first one that carries the colour names
const dark = css.slice(css.indexOf('/* dark */'), css.indexOf('/* light */') > 0 ? css.indexOf('/* light */') : undefined)
const c = (name) => dark.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))[1]

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <circle cx="512" cy="512" r="500" fill="${c('--bg-app')}"/>
  <circle cx="512" cy="512" r="486" fill="none" stroke="${c('--border')}" stroke-width="14"/>
  <g transform="translate(512 512) scale(3.5) translate(-130 -130)">
    <g fill="none" stroke-linecap="round" transform="rotate(-90 130 130)">
      <circle cx="130" cy="130" r="122" stroke="${c('--logo-ring1')}" stroke-width="3" pathLength="360" stroke-dasharray="170 8 110 8 56 8"/>
      <circle cx="130" cy="130" r="98" stroke="${c('--logo-ring2')}" stroke-width="3" pathLength="360" stroke-dasharray="36 9"/>
      <circle cx="130" cy="130" r="72" stroke="${c('--logo-ring3')}" stroke-width="3.5" pathLength="360" stroke-dasharray="74 14 52 14 70 14 108 14"/>
    </g>
    <path d="M114 146 Q114 138 130 138 Q146 138 146 146 L152 222 Q153 233 140 234 L120 234 Q107 233 108 222 Z" fill="${c('--logo-wax')}"/>
    <path d="M130 138 V130" stroke="${c('--logo-wick')}" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M130 84 C137 97 145 104 145 117 C145 127 138 134 130 134 C122 134 115 127 115 117 C115 105 125 98 130 84 Z" fill="${c('--logo-flame')}"/>
    <path d="M130 104 C134 111 138 115 138 122 C138 128 134 132 130 132 C126 132 122 128 122 122 C122 115 127 111 130 104 Z" fill="${c('--logo-flame-core')}"/>
  </g>
</svg>`

const { chromium } = findPlaywright()
const browser = await chromium.launch({ executablePath: findChromium() })
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } })
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)
const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } })
await browser.close()
for (const f of ['build/icon.png', 'resources/icon.png']) writeFileSync(join(root, f), png)
console.log('wrote build/icon.png and resources/icon.png (' + png.length + ' bytes)')
