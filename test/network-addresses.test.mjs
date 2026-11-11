// The privacy policy says the app contacts no web address of its own: it talks to the server the person chose, and (when installed)
// to GitHub for updates, which comes from the updater's own settings and not from an address written in this code. This guards the
// part of that a test can: no web address may be written into the app's source unless it is listed here, on purpose, with why.
// If this fails you have added an address. Either it is not needed (remove it), or it is a real new place the app contacts, and then
// the privacy policy (section 5, "Whose policy this is" and the open points) must change BEFORE this list does.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Every web address written in the source today, and why none of them is a place the app contacts on its own.
const ALLOWED = {
  'http://': 'a scheme prefix in the server-address checker, not an address',
  'https://': 'a scheme prefix in the server-address checker, not an address',
  'https://.': 'a note about what the address checker rejects',
  'http://host': 'an example in a comment',
  'http://localhost:4000': 'the server a development run (npm run dev) talks to, on the same computer',
  'http://192.168.68.70:4000': "the default server address of this project's own server (src/main/defaults.js), replaced by the person's choice; the same address appears in a comment",
  'http://192.168.1.20:8096': 'placeholder text in the Jellyfin address field (Owner Tools > Music), never contacted'
}

const URL_PATTERN = /(?:https?|wss?):\/\/[^\s'"`)<>,;]*/g
const EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.html', '.css'])

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* sourceFiles(p)
    else if (EXTENSIONS.has(name.slice(name.lastIndexOf('.')))) yield p
  }
}

test('no web address is written into the app unless it is on the list above', () => {
  const unexpected = []
  for (const file of sourceFiles(join(root, 'src'))) {
    const text = readFileSync(file, 'utf8')
    // the page's own security policy names schemes, not hosts, and is checked separately below
    for (const m of text.matchAll(URL_PATTERN)) if (!(m[0] in ALLOWED)) unexpected.push(`${relative(root, file)}: ${m[0]}`)
  }
  assert.deepEqual(unexpected, [], 'a new web address is in the source. Is it a place the app contacts? If so, the privacy policy has to change first. See the top of this test.')
})

test('every address on the list is still in the source (the list does not rot)', () => {
  const seen = new Set()
  for (const file of sourceFiles(join(root, 'src'))) for (const m of readFileSync(file, 'utf8').matchAll(URL_PATTERN)) seen.add(m[0])
  const stale = Object.keys(ALLOWED).filter((a) => !seen.has(a))
  assert.deepEqual(stale, [], 'these listed addresses are no longer in the source; remove them from the list')
})

test('the main process uses no network module of its own (the updater is the only thing that reaches out)', () => {
  const found = []
  for (const file of sourceFiles(join(root, 'src', 'main'))) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/(?:from\s+|require\()\s*['"](node:)?(https?|net|tls|dgram|dns)['"]/g)) found.push(`${relative(root, file)}: ${m[0].trim()}`)
    if (/\bnet\.(request|fetch)\b|\bautoUpdater\.setFeedURL\b/.test(text)) found.push(`${relative(root, file)}: net.request/fetch or setFeedURL`)
  }
  assert.deepEqual(found, [], 'the main process now reaches the network itself; the privacy policy must say where to')
})

test('the page is only allowed to connect out by scheme, never to one named host (so a typed server address works)', () => {
  const html = readFileSync(join(root, 'src/renderer/index.html'), 'utf8')
  const connect = /connect-src([^;"]*)/.exec(html)
  assert.ok(connect, 'the security policy has a connect-src')
  assert.doesNotMatch(connect[1], /\/\/[A-Za-z0-9]/, 'connect-src names a host; it should list only schemes')
})
