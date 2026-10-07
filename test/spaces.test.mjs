import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spaceNameFor } from '../src/renderer/src/spaces.js'

const channels = [
  { id: 1, name: 'General', rooms: [{ id: 7, name: 'Lobby' }, { id: 8, name: 'Quiet' }] },
  { id: 2, name: 'Games', rooms: [] }
]

test('spaceNameFor names channels and rooms from presence keys', () => {
  assert.equal(spaceNameFor(channels, 'channel:2'), 'Games')
  assert.equal(spaceNameFor(channels, 'room:8'), 'General / Quiet')
})

test('spaceNameFor is null when it cannot tell', () => {
  assert.equal(spaceNameFor(channels, null), null)
  assert.equal(spaceNameFor(channels, 'room:99'), null)
  assert.equal(spaceNameFor(channels, 'channel:99'), null)
  assert.equal(spaceNameFor(undefined, 'channel:1'), null)
  assert.equal(spaceNameFor([], 'channel:1'), null)
})
