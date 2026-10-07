// What the client does with "you no longer have access". The server is a small
// stand-in here so both an old reply (no reason) and a new one (with a reason)
// can be shown; the real server's side is tested in its own repository.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { installBridge, rejection } from './helpers.mjs'
import { accessEndedNotice } from '../src/renderer/src/accessEnded.js'

let stub
let api

before(async () => {
  stub = createServer((req, res) => {
    res.writeHead(403, { 'content-type': 'application/json' })
    if (req.url.endsWith('/1')) {
      res.end(JSON.stringify({ error: 'Your access to this server has expired.', reason: 'expired' }))
    } else if (req.url.endsWith('/2')) {
      res.end(JSON.stringify({ error: 'You were banned from this server.', reason: 'banned' }))
    } else {
      res.end(JSON.stringify({ error: "You're not a member of that server" })) // an older server
    }
  })
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve))
  installBridge(`http://127.0.0.1:${stub.address().port}`)
  api = await import('../src/renderer/src/api.js')
})
after(async () => {
  await new Promise((resolve) => stub.close(resolve))
})

test('a 403 that carries a reason hands the reason to the caller', async () => {
  const err = await rejection(api.getServer('token', 1))
  assert.equal(err.status, 403)
  assert.equal(err.reason, 'expired')
  assert.equal(err.message, 'Your access to this server has expired.')
})

test('a 403 from an older server has no reason', async () => {
  const err = await rejection(api.getServer('token', 3))
  assert.equal(err.status, 403)
  assert.equal(err.reason, undefined)
})

test("the notice is the server's own message when there is a reason", async () => {
  assert.equal(accessEndedNotice(await rejection(api.getServer('token', 1))), 'Your access to this server has expired.')
  assert.equal(accessEndedNotice(await rejection(api.getServer('token', 2))), 'You were banned from this server.')
})

test('without a reason the old wording stays', async () => {
  assert.equal(accessEndedNotice(await rejection(api.getServer('token', 3))), 'You were removed from this server.')
  assert.equal(accessEndedNotice(new Error('boom')), 'You were removed from this server.')
  assert.equal(accessEndedNotice(null), 'You were removed from this server.')
})
