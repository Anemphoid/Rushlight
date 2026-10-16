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
  deriveVoiceKey
} from './crypto.js'

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
      await store.putDevice(scope, device)
      return device
    })().catch((err) => {
      devicePromise = null // a failure must not stick
      throw err
    })
    return devicePromise
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

  // The 32 bytes LiveKit's key provider takes for a voice space (used by the voice step).
  async function voiceKey(serverId, ctx) {
    const k = await latest(serverId)
    if (!k) throw new CryptoProblem('no_key', 'This computer does not have the key for this server yet')
    return { epoch: k.epoch, bytes: await deriveVoiceKey(k.key, { serverId, ...ctx, epoch: k.epoch }) }
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

  return { ensureDevice, syncKeys, startEpoch, shareKeys, seal, open, openBody, sealImage, voiceKey, epochsHeld, forgetAll }
}
