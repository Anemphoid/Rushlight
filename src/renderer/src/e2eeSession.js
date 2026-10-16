// What the screens know about encryption. Kept outside React like voice.js and unread.js, so opening Settings does
// not drop keys or restart a sync. One key manager per account on this server address (e2ee/keys.js); one status per
// server that screens read with subscribe/getSnapshot.
//
//   status.state   'off'      the server is not encrypted
//                  'checking' keys are being fetched
//                  'ready'    this computer holds the server's current key
//                  'waiting'  it does not, yet: another member's Rushlight has to hand it over
//                  'problem'  something failed (status.message)
import * as api from './api.js'
import { createKeyManager } from './e2ee/keys.js'
import { pictureInfo } from './e2ee/crypto.js'
import { defaultStore } from './e2ee/keystore.js'

const store = defaultStore()
const managers = new Map() // scope -> manager
let statuses = {} // serverId -> status
const listeners = new Set()
const inFlight = new Map() // serverId -> promise
const lastShare = new Map() // serverId -> time keys were last offered to other devices
const plain = new Map() // "<accountId>:<serverId>:<messageId>" -> opened body ({ t, img? }); messages never change, but only their reader may see it
const SHARE_EVERY_MS = 4000 // about every check of the server (5 s): a new member or computer should not wait long

export function subscribe(l) {
  listeners.add(l)
  return () => listeners.delete(l)
}
export const getSnapshot = () => statuses
export const statusOf = (snapshot, serverId) => snapshot[serverId] || { state: 'off' }

function setStatus(serverId, status) {
  const old = statuses[serverId]
  if (old && old.state === status.state && old.epoch === status.epoch && old.message === status.message) return
  statuses = { ...statuses, [serverId]: status }
  listeners.forEach((l) => l())
}

function manager(accountId) {
  const scope = `${api.getCachedBaseUrl()}|${accountId}`
  if (!managers.has(scope)) managers.set(scope, createKeyManager({ api, store, scope }))
  return managers.get(scope)
}

// Brings this computer's keys up to date for one server. `e2ee` is what the server reported
// ({ enabled, epoch, rekeyNeeded }). Admins start the first key, and a new one after anyone is removed; every
// member hands the keys they hold on to other members' computers. Safe to call often: calls overlap into one.
export function refresh({ token, accountId, serverId, e2ee, isAdmin }) {
  if (!e2ee || !e2ee.enabled) {
    setStatus(serverId, { state: 'off' })
    return Promise.resolve()
  }
  if (inFlight.has(serverId)) return inFlight.get(serverId)
  const job = (async () => {
    const mgr = manager(accountId)
    if (!statuses[serverId] || statuses[serverId].state === 'off') setStatus(serverId, { state: 'checking', epoch: e2ee.epoch })
    try {
      let sync = await mgr.syncKeys(token, serverId)
      if (isAdmin && (e2ee.epoch === 0 || e2ee.rekeyNeeded || sync.epoch === 0)) {
        await mgr.startEpoch(token, serverId)
        sync = await mgr.syncKeys(token, serverId)
      }
      if (Date.now() - (lastShare.get(serverId) || 0) > SHARE_EVERY_MS) {
        lastShare.set(serverId, Date.now())
        await mgr.shareKeys(token, serverId)
      }
      setStatus(serverId, sync.hasCurrent && sync.epoch > 0 ? { state: 'ready', epoch: sync.epoch } : { state: 'waiting', epoch: sync.epoch })
    } catch (err) {
      // an old client being turned away is reported by the server's own words
      setStatus(serverId, { state: 'problem', epoch: e2ee.epoch, message: err.message })
    }
  })().finally(() => inFlight.delete(serverId))
  inFlight.set(serverId, job)
  return job
}

// The messages of one space with their text opened. Each gets `locked` instead of text when this computer cannot
// read it: 'no_key' (the key for that stretch of history has not arrived) or 'cannot_open'. Bot messages and
// messages that were never encrypted pass through untouched.
export async function openMessages(accountId, serverId, space, messages) {
  const mgr = manager(accountId)
  const out = []
  for (const m of messages) {
    if (!m.encrypted || m.redacted) {
      out.push(m)
      continue
    }
    const cacheKey = `${accountId}:${serverId}:${m.id}`
    let body = plain.get(cacheKey)
    if (!body) {
      try {
        body = await mgr.openBody(serverId, { type: space.type, spaceId: space.id, authorId: m.authorId }, m.text)
        plain.set(cacheKey, body)
      } catch (err) {
        out.push({ ...m, text: '', image: null, locked: err.code === 'no_key' ? 'no_key' : 'cannot_open' })
        continue
      }
    }
    if (m.image && m.image.sealed) {
      // The picture's type, shape and key are inside the sealed text. A message that says nothing usable about
      // its picture is shown as unreadable, never fetched.
      const info = pictureInfo(body)
      if (!info) {
        out.push({ ...m, text: '', image: null, locked: 'cannot_open' })
        continue
      }
      out.push({ ...m, text: body.t, image: { id: m.image.id, sealed: true, mime: info.mime, width: info.width, height: info.height, key: info.key } })
      continue
    }
    out.push({ ...m, text: body.t })
  }
  return out
}

// Seals text for sending. Throws a CryptoProblem with code 'no_key' if this computer has no key yet.
export const seal = (accountId, serverId, space, authorId, text) => manager(accountId).seal(serverId, { type: space.type, spaceId: space.id, authorId }, text)

// Seals a picture for sending: returns the body to upload. Throws a CryptoProblem ('no_key' ...).
export const sealPictureFor = (accountId, serverId, space, authorId, bytes, info, caption) =>
  manager(accountId).sealImage(serverId, { type: space.type, spaceId: space.id, authorId }, bytes, info, caption)

// Signing out: forget everything held in memory (opened text, key status). The keys on disk stay, so signing
// back in picks up where it left off.
export function lock() {
  plain.clear()
  managers.clear() // their keys held in memory go with them; the manager reloads from the store on next use
  statuses = {}
  lastShare.clear()
  listeners.forEach((l) => l())
}

// Signing out of this account on this computer, for good: forgets its device key and every server key.
export async function forgetAccount(accountId) {
  await manager(accountId).forgetAll()
  lock()
}
