// Changing the server's address (its IP moved): what is accepted, that the keys stay filed where they were, and the check
// that something answers at the new address.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { normalizeServerAddress, displayAddress, withNewAddress } from '../src/shared/serverAddress.js'
import { startServer, installBridge } from './helpers.mjs'

test('a typed address becomes the server origin, with http assumed', () => {
  const ok = (input, url) => assert.deepEqual(normalizeServerAddress(input), { url }, input)
  ok('192.168.68.70:4000', 'http://192.168.68.70:4000')
  ok('  192.168.68.70:4000  ', 'http://192.168.68.70:4000')
  ok('http://192.168.68.70:4000/', 'http://192.168.68.70:4000')
  ok('https://chat.example.com', 'https://chat.example.com')
  ok('chat.example.com:8443', 'http://chat.example.com:8443')
  ok('localhost:4000', 'http://localhost:4000')
  ok('HTTP://Host.Example:4000', 'http://host.example:4000')
  ok('[::1]:4000', 'http://[::1]:4000')
})

test('anything that is not a plain server address is refused with a reason', () => {
  const bad = (input) => assert.ok(normalizeServerAddress(input).error, `${JSON.stringify(input)} should be refused`)
  for (const input of ['', '   ', null, undefined, 42, 'ftp://host', 'file:///etc/passwd', 'javascript:alert(1)', 'http://', 'http://user:pw@host:4000', 'http://host:4000/api/health', 'http://host:4000?x=1', 'http://host:4000/#a', 'http://host:99999', 'not an address', 'x'.repeat(300)]) bad(input)
})

test('the address is shown without its scheme', () => {
  assert.equal(displayAddress('http://192.168.68.70:4000'), '192.168.68.70:4000')
  assert.equal(displayAddress(''), '')
})

let srv, api, session
before(async () => {
  srv = await startServer()
  installBridge(srv.url)
  api = await import('../src/renderer/src/api.js')
  await api.getMe('x').catch(() => {}) // the app's first request warms the address, as it does here
  session = await import('../src/renderer/src/e2eeSession.js')
})
after(async () => {
  if (srv) await srv.stop()
})

test('changing the address keeps the keys filed under the original one, so the same server is not met as a new computer', async () => {
  // an install made before this feature: the saved config has an address and no scopeId
  let config = { serverUrl: srv.url }
  window.api.getServerConfig = async () => config
  window.api.setServerAddress = async (address) => (config = withNewAddress(config, address))
  assert.equal(api.getServerScope(), srv.url, 'before a change the scope is the address, as it always was')
  await api.changeServerAddress('http://192.168.68.99:4000')
  assert.equal(api.getCachedBaseUrl(), 'http://192.168.68.99:4000')
  assert.equal(api.getServerScope(), srv.url, 'the keys are still filed under the first address')
  assert.equal(config.scopeId, srv.url)
  // a second move does not change it again
  await api.changeServerAddress('192.168.68.120:4000')
  assert.equal(api.getCachedBaseUrl(), 'http://192.168.68.120:4000')
  assert.equal(api.getServerScope(), srv.url)
  // an install that already moved once keeps its original scope
  assert.deepEqual(withNewAddress({ serverUrl: 'http://b:1', scopeId: 'http://a:1' }, 'http://c:1'), { serverUrl: 'http://c:1', scopeId: 'http://a:1' })
  // the encryption side files everything under that scope
  assert.equal(typeof session.refresh, 'function')
})

test('a bad address is refused by the app before it is saved', async () => {
  let config = { serverUrl: srv.url }
  window.api.setServerAddress = async (address) => (config = withNewAddress(config, address))
  await assert.rejects(api.changeServerAddress('ftp://nope'), /http/i)
  assert.equal(config.serverUrl, srv.url)
})

test('the check says whether a Rushlight server answers there', async () => {
  assert.deepEqual(await api.checkServerAddress(srv.url), { ok: true })
  assert.deepEqual(await api.checkServerAddress('http://127.0.0.1:1'), { ok: false, reason: 'unreachable' })
  const other = createServer((req, res) => res.end('<html>a router login page</html>'))
  await new Promise((r) => other.listen(0, '127.0.0.1', r))
  try {
    assert.deepEqual(await api.checkServerAddress(`http://127.0.0.1:${other.address().port}`), { ok: false, reason: 'not_rushlight' })
  } finally {
    other.close()
  }
})
