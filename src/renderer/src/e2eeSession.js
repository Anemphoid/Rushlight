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
import { pictureInfo, openCodePackage } from './e2ee/crypto.js'
import { voiceKeysFromPackage } from './e2ee/invites.js'
import { defaultStore } from './e2ee/keystore.js'

const store = defaultStore()
const managers = new Map() // scope -> manager
let statuses = {} // serverId -> status
const listeners = new Set()
const inFlight = new Map() // serverId -> promise
const invitesAt = new Map() // serverId -> the key epoch this admin last brought the invites up to
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
      // A new key epoch: bring the server's invites up to it, so people who join (or guests already in) get it too.
      if (isAdmin && sync.hasCurrent && sync.epoch > 0 && invitesAt.get(serverId) !== sync.epoch) {
        invitesAt.set(serverId, sync.epoch)
        try {
          const { codes } = await api.listServerCodes(token, serverId)
          await mgr.refreshInvites(token, serverId, codes)
        } catch {
          invitesAt.delete(serverId) // try again on the next check
        }
      }
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

// A voice space as the key code wants it: a room also says which channel it is in (a channel is its own).
const voiceCtx = (space) => ({ type: space.type, spaceId: space.id, channelId: space.type === 'channel' ? space.id : space.channelId })

// The voice keys for a space, oldest epoch first: [{ epoch, bytes }] (empty when this computer holds none yet).
export const voiceKeysFor = (accountId, serverId, space) => manager(accountId).voiceKeys(serverId, voiceCtx(space))

// The keys to join an encrypted call with: this computer's keys brought up to date first, and only if it holds the key of
// the room's current epoch (`epoch`, from the voice token). An older key alone would send audio the others cannot open,
// so that counts as no key and the call does not start. [{ epoch, bytes }], or [] for "no key yet".
export async function prepareVoiceKeys({ token, accountId, serverId, space, epoch }) {
  const mgr = manager(accountId)
  await mgr.syncKeys(token, serverId)
  const keys = await mgr.voiceKeys(serverId, voiceCtx(space))
  const newest = keys.length ? keys[keys.length - 1].epoch : 0
  return newest >= epoch ? keys : []
}

// Seals a picture for sending: returns the body to upload. Throws a CryptoProblem ('no_key' ...).
export const sealPictureFor = (accountId, serverId, space, authorId, bytes, info, caption) =>
  manager(accountId).sealImage(serverId, { type: space.type, spaceId: space.id, authorId }, bytes, info, caption)

// --- invites that carry keys ---

// A new invite for an encrypted server: { secret, body }. scope: null, { type: 'channel', id } or { type: 'room', id, channelId }.
export const createInvite = (accountId, serverId, scope) => manager(accountId).createInvite(serverId, scope)

// The rows of the server's invite list with `fullCode` added: the shareable code with its secret half, or null if this
// computer cannot open that invite's secret (it was made before encryption, or this computer lacks that epoch's key).
export async function withFullCodes(accountId, serverId, rows) {
  const mgr = manager(accountId)
  const out = []
  for (const row of rows) out.push({ ...row, fullCode: row.e2ee ? await mgr.fullInvite(serverId, row) : null })
  return out
}

// A member joined with an invite: take the server keys it carries.
export const takeInviteKeys = (accountId, serverId, secret, packageText) => manager(accountId).takeInvite(serverId, secret, packageText)

// A guest holds no account and no device; what they hold is the package of the invite they came in with, kept in
// memory for the session. { serverId, secret, pkg }.
let guest = null

// Opens a guest's invite package. Throws CryptoProblem('cannot_open') if the secret half is wrong.
export async function setGuestInvite({ serverId, secret, packageText }) {
  guest = { serverId, secret, pkg: await openCodePackage(secret, serverId, packageText) }
}

// The voice keys a guest holds for a space ({ type, id, channelId }), but only if they hold the key of the room's
// current epoch (anything older alone would send audio the others cannot open): [{ epoch, bytes }] or [].
export async function guestVoiceKeys(space, epoch) {
  if (!guest) return []
  const keys = await voiceKeysFromPackage(guest.serverId, guest.pkg, space)
  const newest = keys.length ? keys[keys.length - 1].epoch : 0
  return newest >= epoch ? keys : []
}

// Asks the server again for the guest's invite package, to pick up a newer key epoch (admins' apps add them).
// Returns true if the guest now holds keys it did not before.
export async function refreshGuest(guestToken) {
  if (!guest) return false
  const answer = await api.getGuestKeyPackage(guestToken)
  const have = guest.pkg.keys.size ? Math.max(...guest.pkg.keys.keys()) : 0
  if (!answer.package || answer.packageEpoch <= have) return false
  guest = { ...guest, pkg: await openCodePackage(guest.secret, guest.serverId, answer.package) }
  return true
}

// Signing out: forget everything held in memory (opened text, key status). The keys on disk stay, so signing
// back in picks up where it left off.
export function lock() {
  plain.clear()
  managers.clear() // their keys held in memory go with them; the manager reloads from the store on next use
  statuses = {}
  lastShare.clear()
  invitesAt.clear()
  guest = null
  listeners.forEach((l) => l())
}

// Signing out of this account on this computer, for good: forgets its device key and every server key.
export async function forgetAccount(accountId) {
  await manager(accountId).forgetAll()
  lock()
}
