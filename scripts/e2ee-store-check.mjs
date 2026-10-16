// Checks the IndexedDB key store in a real Chromium (the engine Electron uses), which the unit tests cannot do:
//   - a non-extractable private key put in the store comes back after the page is reloaded, still unable to be
//     exported, and still opens an envelope that was wrapped to its public key before the reload;
//   - server keys come back byte for byte and in epoch order, scoped to the right account and server;
//   - clear() removes one account's keys and leaves another's.
// Not part of `npm test` (needs Playwright's Chromium). Run: node scripts/e2ee-store-check.mjs
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { findPlaywright, findChromium } from './ui-shots/lib.mjs'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer', 'src', 'e2ee')
const http = createServer((req, res) => {
  const name = req.url.split('?')[0].slice(1)
  if (!name) return res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>store check</title>')
  let body
  try {
    body = readFileSync(join(dir, name.replace(/[^a-z.]/g, '')))
  } catch {
    return res.writeHead(404).end()
  }
  res.writeHead(200, { 'content-type': 'text/javascript' }).end(body)
})
await new Promise((r) => http.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${http.address().port}/`

const { chromium } = findPlaywright()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
const ctx = await browser.newContext()
const code = {
  first: async () => {
    const c = await import('/crypto.js')
    const { indexedDbStore } = await import('/keystore.js')
    const store = indexedDbStore()
    const { privateKey, publicKey } = await c.generateDeviceKeys()
    const serverKey = c.newServerKey()
    const envelope = await c.wrapServerKey(serverKey, publicKey, { serverId: 1, epoch: 1, recipientDeviceId: 9 })
    await store.putDevice('a|1', { privateKey, publicKey, deviceId: 9 })
    await store.putDevice('a|2', { privateKey, publicKey, deviceId: 10 })
    for (const e of [3, 1, 2]) await store.putServerKey('a|1', 5, e, new Uint8Array(32).fill(e))
    await store.putServerKey('a|1', 50, 1, new Uint8Array(32).fill(99)) // another server whose id starts the same
    await store.putServerKey('a|2', 5, 1, new Uint8Array(32).fill(77)) // another account
    return { envelope, serverKey: Array.from(serverKey) }
  },
  second: async ({ envelope, serverKey }) => {
    const c = await import('/crypto.js')
    const { indexedDbStore } = await import('/keystore.js')
    const store = indexedDbStore()
    const d = await store.getDevice('a|1')
    let exported = 'refused'
    try {
      await crypto.subtle.exportKey('pkcs8', d.privateKey)
      exported = 'allowed'
    } catch {
      // expected
    }
    const opened = await c.unwrapServerKey(envelope, d.privateKey, { serverId: 1, epoch: 1, recipientDeviceId: 9 })
    const keys = await store.getServerKeys('a|1', 5)
    const result = {
      exported,
      extractable: d.privateKey.extractable,
      deviceId: d.deviceId,
      opened: Array.from(opened).join() === serverKey.join(),
      epochs: [...keys.keys()],
      bytes: [...keys.values()].map((k) => [k.length, k[0]]),
      otherServer: [...(await store.getServerKeys('a|1', 50)).keys()],
      otherAccount: [...(await store.getServerKeys('a|2', 5)).keys()],
      missing: await store.getDevice('a|3')
    }
    await store.clear('a|1')
    result.afterClear = { device: await store.getDevice('a|1'), keys: [...(await store.getServerKeys('a|1', 5)).keys()], otherServer: [...(await store.getServerKeys('a|1', 50)).keys()], kept: (await store.getDevice('a|2')).deviceId, keptKeys: [...(await store.getServerKeys('a|2', 5)).keys()] }
    return result
  }
}
let failed = false
try {
  const one = await ctx.newPage()
  await one.goto(url)
  const made = await one.evaluate(`(${code.first})()`)
  await one.close()
  const two = await ctx.newPage() // a new page of the same origin: what a restart of the app sees
  await two.goto(url)
  const got = await two.evaluate(`(${code.second})(${JSON.stringify(made)})`)
  assert.equal(got.exported, 'refused', 'a stored private key must stay non-extractable')
  assert.equal(got.extractable, false)
  assert.equal(got.deviceId, 9)
  assert.equal(got.opened, true, 'the stored key must still open an envelope made before')
  assert.deepEqual(got.epochs, [1, 2, 3])
  assert.deepEqual(got.bytes, [[32, 1], [32, 2], [32, 3]])
  assert.deepEqual(got.otherServer, [1])
  assert.deepEqual(got.otherAccount, [1])
  assert.equal(got.missing, null)
  assert.deepEqual(got.afterClear, { device: null, keys: [], otherServer: [], kept: 10, keptKeys: [1] })
  console.log('IndexedDB key store: ok (Chromium ' + browser.version() + ')')
} catch (err) {
  failed = true
  console.error('IndexedDB key store: FAILED\n', err)
} finally {
  await browser.close()
  http.close()
}
process.exit(failed ? 1 : 0)
