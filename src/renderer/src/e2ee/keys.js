// One computer's encryption keys for one account on one server address: registers the device, picks up the
// server keys wrapped to it, starts a new epoch when an admin has to, hands keys on to other members' devices,
// and seals and opens chat text. It talks to the server only through `api` (api.js, or a stand-in in tests)
// and keeps keys only in `store` (keystore.js). No screens in here.
import {
  CryptoProblem,
  generateDeviceKeys,
  newServerKey,
  wrapServerKey,
  unwrapServerKey,
  sealMessage,
  openMessage,
  openPayload,
  sealPicture,
  messageEpoch,
  deriveVoiceKey,
  openCodePackage
} from './crypto.js'
import { makeInvite, refreshedInvite, secretOfInvite } from './invites.js'
import { joinFullCode, openApprovalChallenge } from './crypto.js'

const CHUNK = 400 // the server takes up to 500 envelopes a call

export function createKeyManager({ api, store, scope, label = 'This computer' }) {
  let devicePromise = null
  const held = new Map() // serverId -> Map(epoch -> bytes), filled from the store
  const offered = new Set() // "<serverId>|<epoch>|<deviceId>" already handed on in this run

  async function heldKeys(serverId) {
    if (!held.has(serverId)) held.set(serverId, await store.getServerKeys(scope, serverId))
    return held.get(serverId)
  }
  async function remember(serverId, epoch, bytes) {
    await store.putServerKey(scope, serverId, epoch, bytes)
    ;(await heldKeys(serverId)).set(epoch, bytes)
  }

  // This computer's identity, made and registered the first time, and again if the server no longer knows it
  // (it was removed from another computer). The private key never leaves the store.
  function ensureDevice(token) {
    devicePromise ||= (async () => {
      const stored = await store.getDevice(scope)
      if (stored) {
        const { devices } = await api.listMyDevices(token)
        if (devices.some((d) => d.id === stored.deviceId && d.publicKey === stored.publicKey)) return stored
      }
      const { privateKey, publicKey } = await generateDeviceKeys()
      const made = await api.registerDevice(token, publicKey, label)
      const device = { privateKey, publicKey, deviceId: made.id, label }
      await store.putDevice(scope, device) // the pairing code is not part of what is kept
      return made.pairing ? { ...device, pairing: made.pairing } : device
    })().catch((err) => {
      devicePromise = null // a failure must not stick
      throw err
    })
    return devicePromise
  }

  // Whether this computer has been approved, and for a waiting one when its code runs out. The code itself is only
  // ever known from the moment it was made (registration or renewal) and is kept in memory, never stored.
  // Times here are on THIS computer's clock: the server says how long a code has left, not when it ends by its own clock,
  // so a computer whose clock is a few minutes off still shows the right countdown.
  let pairing = null // { code, expiresAt }
  const fromNow = (ms) => Date.now() + Math.max(0, Number(ms) || 0)
  async function deviceStatus(token) {
    const device = await ensureDevice(token)
    if (device.pairing && !pairing) pairing = { code: device.pairing.code, expiresAt: fromNow(device.pairing.expiresInMs) }
    const { devices } = await api.listMyDevices(token)
    const mine = devices.find((d) => d.id === device.deviceId)
    const approved = !!mine && mine.approved !== false
    const left = mine && Number.isFinite(mine.pairingExpiresInMs) ? fromNow(mine.pairingExpiresInMs) : null
    return {
      deviceId: device.deviceId,
      approved,
      pairing: approved ? null : { code: pairing && left && pairing.expiresAt > Date.now() ? pairing.code : null, expiresAt: left },
      waiting: devices.filter((d) => d.approved === false && d.id !== device.deviceId).map((d) => ({ id: d.id, label: d.label, createdAt: d.createdAt }))
    }
  }
  async function renewPairingCode(token) {
    const device = await ensureDevice(token)
    const out = await api.renewPairingCode(token, device.deviceId)
    pairing = { code: out.pairing.code, expiresAt: fromNow(out.pairing.expiresInMs) }
    return pairing
  }

  // Approving another computer of this account, in two steps so the person sees what they are approving: begin looks up
  // the code and opens the challenge (which only this device's private key can); confirm sends it with the password.
  const approvals = new Map() // approvalId -> proof, held in memory until confirmed
  async function beginApproval(token, code) {
    const device = await ensureDevice(token)
    const status = await deviceStatus(token)
    if (!status.approved) throw new CryptoProblem('not_approved', 'This computer has not been approved yet, so it cannot approve another.')
    const begin = await api.beginDeviceApproval(token, code, device.deviceId)
    const proof = await openApprovalChallenge(begin.challenge, device.privateKey, { approvalId: begin.approvalId, deviceId: device.deviceId })
    approvals.set(begin.approvalId, proof)
    return { approvalId: begin.approvalId, device: begin.device }
  }
  async function confirmApproval(token, approvalId, password) {
    const proof = approvals.get(approvalId)
    if (!proof) throw new CryptoProblem('approval_expired', 'That approval has run out. Enter the code again.')
    try {
      const out = await api.confirmDeviceApproval(token, approvalId, password, proof)
      approvals.delete(approvalId)
      return out
    } catch (err) {
      // a wrong password can be tried again on the same approval (the server allows 3 tries); anything with a reason is over
      if (err.reason) approvals.delete(approvalId)
      throw err
    }
  }

  // Picks up every server key wrapped to this device that it does not hold yet.
  async function syncKeys(token, serverId) {
    const device = await ensureDevice(token)
    const answer = await api.getKeyEnvelopes(token, serverId, device.deviceId)
    const have = await heldKeys(serverId)
    const failed = []
    for (const env of answer.envelopes) {
      if (have.has(env.epoch)) continue
      try {
        const bytes = await unwrapServerKey(env.data, device.privateKey, { serverId, epoch: env.epoch, recipientDeviceId: device.deviceId })
        await remember(serverId, env.epoch, bytes)
      } catch {
        failed.push(env.epoch)
      }
    }
    return {
      epoch: answer.epoch,
      rekeyNeeded: answer.rekeyNeeded,
      epochs: [...have.keys()].sort((a, b) => a - b),
      hasCurrent: answer.epoch === 0 ? true : have.has(answer.epoch),
      failed
    }
  }

  // A new key for the server, wrapped to every device of every member. For admins: the first key, and the
  // new one after someone leaves. Tries again if a device joined or another admin got there first.
  async function startEpoch(token, serverId) {
    const device = await ensureDevice(token)
    for (let attempt = 0; attempt < 3; attempt++) {
      const { epoch, devices } = await api.getServerDevices(token, serverId)
      const next = epoch + 1
      const key = newServerKey()
      const envelopes = []
      for (const d of devices) {
        envelopes.push({ recipientDeviceId: d.id, data: await wrapServerKey(key, d.publicKey, { serverId, epoch: next, recipientDeviceId: d.id }) })
      }
      try {
        await api.rekeyServer(token, serverId, { epoch: next, senderDeviceId: device.deviceId, envelopes })
      } catch (err) {
        if (err.reason === 'rekey_incomplete' || err.reason === 'epoch_changed') continue
        throw err
      }
      await remember(serverId, next, key)
      return { epoch: next }
    }
    throw new CryptoProblem('rekey_failed', 'Could not start a new key. Try again.')
  }

  // Hands every key this computer holds to the other member devices. The server keeps what is already there
  // (it only ever adds), so this is safe to repeat; a device handled in this run is skipped.
  async function shareKeys(token, serverId) {
    const device = await ensureDevice(token)
    const have = await heldKeys(serverId)
    const { epoch: current, devices } = await api.getServerDevices(token, serverId)
    const jobs = []
    for (const [epoch, key] of have) {
      if (epoch > current) continue
      for (const d of devices) {
        if (d.id === device.deviceId) continue
        const tag = `${serverId}|${epoch}|${d.id}`
        if (offered.has(tag)) continue
        jobs.push({ tag, epoch, key, d })
      }
    }
    let added = 0
    for (const epoch of new Set(jobs.map((j) => j.epoch))) {
      const mine = jobs.filter((j) => j.epoch === epoch)
      for (let i = 0; i < mine.length; i += CHUNK) {
        const part = mine.slice(i, i + CHUNK)
        const envelopes = []
        for (const j of part) {
          envelopes.push({ recipientDeviceId: j.d.id, data: await wrapServerKey(j.key, j.d.publicKey, { serverId, epoch, recipientDeviceId: j.d.id }) })
        }
        const r = await api.postKeyEnvelopes(token, serverId, { epoch, senderDeviceId: device.deviceId, envelopes })
        added += r.added
        part.forEach((j) => offered.add(j.tag))
      }
    }
    return { added }
  }

  const latest = async (serverId) => {
    const have = await heldKeys(serverId)
    const epoch = Math.max(0, ...have.keys())
    return epoch ? { epoch, key: have.get(epoch) } : null
  }

  // Seals chat text with the newest key this computer holds. ctx = { type, spaceId, authorId }.
  async function seal(serverId, ctx, text) {
    const k = await latest(serverId)
    if (!k) throw new CryptoProblem('no_key', 'This computer does not have the key for this server yet')
    return sealMessage(k.key, { serverId, ...ctx, epoch: k.epoch }, text)
  }

  // Opens a message body, { t, img? }. Throws CryptoProblem 'no_key' when the message is from an epoch this computer
  // has no key for, 'cannot_open' when the key is wrong or the message was changed.
  async function openBody(serverId, ctx, ciphertext) {
    const epoch = messageEpoch(ciphertext)
    if (!epoch) throw new CryptoProblem('cannot_open', 'Not an encrypted message')
    const key = (await heldKeys(serverId)).get(epoch)
    if (!key) throw new CryptoProblem('no_key', 'No key for this part of the history')
    return openPayload(key, { serverId, ...ctx }, ciphertext)
  }

  // Opens chat text: the string.
  async function open(serverId, ctx, ciphertext) {
    return (await openBody(serverId, ctx, ciphertext)).t
  }

  // Seals a picture (bytes, { mime, width, height }) with a caption, with the newest key this computer holds.
  // Returns the body to upload.
  async function sealImage(serverId, ctx, bytes, info, caption) {
    const k = await latest(serverId)
    if (!k) throw new CryptoProblem('no_key', 'This computer does not have the key for this server yet')
    return sealPicture(k.key, { serverId, ...ctx, epoch: k.epoch }, bytes, info, caption)
  }

  // The voice keys for one space: the 32 bytes LiveKit's key provider takes, for every epoch this computer holds (the
  // newest 8 at most). [{ epoch, bytes }], oldest first.
  async function voiceKeys(serverId, ctx) {
    const have = await heldKeys(serverId)
    const epochs = [...have.keys()].sort((a, b) => a - b).slice(-8)
    const out = []
    for (const epoch of epochs) out.push({ epoch, bytes: await deriveVoiceKey(have.get(epoch), { serverId, ...ctx, epoch }) })
    return out
  }

  // --- invites that carry keys (invites.js) ---
  // A new invite for an encrypted server, from the keys this computer holds: { secret, body } (the body goes to the
  // server with the other options; the secret goes in the shared code).
  async function createInvite(serverId, scope) {
    return makeInvite(serverId, await heldKeys(serverId), scope)
  }

  // For an admin: brings every invite of the server up to the newest key epoch this computer holds, by adding that
  // epoch's keys to its package. Returns how many it updated. Losing a race to another admin is fine.
  async function refreshInvites(token, serverId, rows) {
    const have = await heldKeys(serverId)
    let updated = 0
    for (const row of rows) {
      const next = await refreshedInvite(serverId, have, row)
      if (!next) continue
      try {
        await api.putCodePackage(token, serverId, row.id, next)
        updated++
      } catch (err) {
        if (err.reason !== 'package_changed' && err.reason !== 'bad_epoch') throw err
      }
    }
    return updated
  }

  // The full shareable invite for a row of the server's list, or null if this computer cannot open its secret.
  async function fullInvite(serverId, row) {
    const secret = await secretOfInvite(serverId, await heldKeys(serverId), row)
    return secret ? joinFullCode(row.code, secret) : null
  }

  // A member joined with an invite: take the server keys it carries so they can read at once, without waiting for
  // another member's app. Returns how many epochs were new.
  async function takeInvite(serverId, secret, packageText) {
    const pkg = await openCodePackage(secret, serverId, packageText)
    if (pkg.kind !== 'server') return 0
    const have = await heldKeys(serverId)
    let added = 0
    for (const [epoch, bytes] of pkg.keys) {
      if (!have.has(epoch)) {
        await remember(serverId, epoch, bytes)
        added++
      }
    }
    return added
  }

  // Everything this computer knows about a server, for screens to decide what to show.
  async function epochsHeld(serverId) {
    return [...(await heldKeys(serverId)).keys()].sort((a, b) => a - b)
  }

  async function forgetAll() {
    held.clear()
    offered.clear()
    devicePromise = null
    await store.clear(scope)
  }

  async function storedDeviceId() {
    const stored = await store.getDevice(scope)
    return stored ? stored.deviceId : null
  }

  return { ensureDevice, deviceStatus, renewPairingCode, beginApproval, confirmApproval, storedDeviceId, syncKeys, startEpoch, shareKeys, seal, open, openBody, sealImage, voiceKeys, createInvite, refreshInvites, fullInvite, takeInvite, epochsHeld, forgetAll }
}
