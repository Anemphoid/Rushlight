// The notice an admin gets when the server's computer has a new address. What the server sends is checked before it is shown or
// copied: only a plain IPv4 address, and only a message that names the suggested address.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { addressNoticeOf } from '../src/renderer/src/addressNotice.js'

test('no notice unless the server sent one', () => {
  assert.equal(addressNoticeOf(null), null)
  assert.equal(addressNoticeOf({}), null)
  assert.equal(addressNoticeOf({ addressChange: 'x' }), null)
})

test('a good notice carries the old and new address and the message for friends', () => {
  const n = addressNoticeOf({
    addressChange: { configured: '192.168.70.15', suggested: '192.168.70.11', others: [], message: "The server's address changed. New address: http://192.168.70.11:4000. Type it in." }
  })
  assert.equal(n.configured, '192.168.70.15')
  assert.equal(n.suggested, '192.168.70.11')
  assert.match(n.message, /New address: http:\/\/192\.168\.70\.11:4000/)
})

test('with no new address it still says so, without a message to copy', () => {
  const n = addressNoticeOf({ addressChange: { configured: '192.168.70.15', suggested: null, others: [], message: null } })
  assert.equal(n.suggested, '')
  assert.equal(n.message, '')
})

test('nothing odd from the server is shown or copied', () => {
  assert.equal(addressNoticeOf({ addressChange: { configured: '<img src=x>', suggested: '1.2.3.4', message: 'x' } }), null)
  const bad = addressNoticeOf({ addressChange: { configured: '10.0.0.1', suggested: '10.0.0.2', message: 'Visit http://evil.example/ now' } })
  assert.equal(bad.message, '', 'a message that does not name the suggested address is not copied')
  const notAddress = addressNoticeOf({ addressChange: { configured: '10.0.0.1', suggested: 'evil.example', message: 'http://evil.example:4000' } })
  assert.equal(notAddress.suggested, '')
  assert.equal(notAddress.message, '')
  const ctrl = addressNoticeOf({ addressChange: { configured: '10.0.0.1', suggested: '10.0.0.2', message: 'New address: http://10.0.0.2:4000\u0000\n' + 'a'.repeat(500) } })
  assert.equal(/[\u0000-\u001f]/.test(ctrl.message), false)
  assert.ok(ctrl.message.length <= 300)
})

test('the tree shows it to admins, from the server check, and the unreachable wording mentions a move', () => {
  const tree = readFileSync(new URL('../src/renderer/src/screens/ChannelTreeScreen.jsx', import.meta.url), 'utf8')
  assert.match(tree, /addressNoticeOf\(data\)/)
  assert.match(tree, /<AddressChangeNotice notice=\{addressNotice\}/)
  const api = readFileSync(new URL('../src/renderer/src/api.js', import.meta.url), 'utf8')
  assert.match(api, /may have moved to a new address/)
  const sa = readFileSync(new URL('../src/renderer/src/components/ServerAddress.jsx', import.meta.url), 'utf8')
  assert.match(sa, /may have moved to a new address/)
})
