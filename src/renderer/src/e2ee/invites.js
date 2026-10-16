// What an invite to an encrypted server carries, and what is done with it. Pure functions over a map of server keys
// (epoch -> 32 bytes); keys.js and e2eeSession.js wrap them with storage and the server.
//
// Three kinds of package, so nobody holds more than their invite is for:
//   server   the server keys, for an invite to the whole server (a member, or a guest who can use any voice room)
//   channel  the channel's voice base key per epoch, for a guest invite to a channel (it covers the rooms in it, now
//            and later: every room's voice key derives from the base)
//   room     the voice key of one room per epoch, for a guest invite to that room
import {
  CryptoProblem,
  deriveChannelVoiceBase,
  deriveVoiceKey,
  deriveVoiceKeyFromBase,
  newCodeSecret,
  sealCodePackage,
  openCodePackage,
  packagePayload,
  sealCodeSecret,
  openCodeSecret,
  codeSecretEpoch
} from './crypto.js'

export const INVITE_EPOCHS = 8 // how many of the newest epochs a package holds

const newest = (epochs, n = INVITE_EPOCHS) => [...epochs].sort((a, b) => a - b).slice(-n)

// The scope an invite was made for, as the server's `scope` field (and null for the whole server).
export const scopeOfPackage = (pkg) =>
  pkg.kind === 'channel' ? { type: 'channel', id: pkg.channelId } : pkg.kind === 'room' ? { type: 'room', id: pkg.roomId, channelId: pkg.channelId } : null

// The key a package of this scope holds for one epoch, from that epoch's server key.
async function keyForScope(scope, serverId, epoch, serverKey) {
  if (!scope) return serverKey
  if (scope.type === 'channel') return new Uint8Array(await deriveChannelVoiceBase(serverKey, { serverId, channelId: scope.id, epoch }))
  return new Uint8Array(await deriveVoiceKey(serverKey, { serverId, type: 'room', spaceId: scope.id, channelId: scope.channelId, epoch }))
}

function metaOf(scope) {
  if (!scope) return { kind: 'server' }
  return scope.type === 'channel' ? { kind: 'channel', channelId: scope.id } : { kind: 'room', channelId: scope.channelId, roomId: scope.id }
}

// A new invite: the secret half to put in the shared code, and the body for creating it on the server. `scope` is
// null (the whole server), { type: 'channel', id } or { type: 'room', id, channelId }.
export async function makeInvite(serverId, serverKeys, scope) {
  const epochs = newest(serverKeys.keys())
  if (epochs.length === 0) throw new CryptoProblem('no_key', 'This computer does not have the key for this server yet')
  const latest = epochs[epochs.length - 1]
  const keys = new Map()
  for (const e of epochs) keys.set(e, await keyForScope(scope, serverId, e, serverKeys.get(e)))
  const secret = newCodeSecret()
  return {
    secret,
    body: {
      package: await sealCodePackage(secret, serverId, packagePayload({ ...metaOf(scope), keys })),
      secret: await sealCodeSecret(serverKeys.get(latest), { serverId, epoch: latest }, secret),
      epoch: latest
    }
  }
}

// An invite from the server's list, given the newest keys this computer holds: the package with the keys of the
// epochs it is missing added (and the oldest dropped past the newest eight), or null if it has nothing to add or this
// computer cannot open it.
export async function refreshedInvite(serverId, serverKeys, row) {
  const have = newest(serverKeys.keys())
  const latest = have[have.length - 1]
  if (!row.e2ee || !latest || row.e2ee.epoch >= latest) return null
  try {
    const secretEpoch = codeSecretEpoch(row.e2ee.secret)
    const secretKey = serverKeys.get(secretEpoch)
    if (!secretKey) return null
    const secret = await openCodeSecret(secretKey, serverId, row.e2ee.secret)
    const pkg = await openCodePackage(secret, serverId, row.e2ee.package)
    const scope = scopeOfPackage(pkg)
    const keys = new Map(pkg.keys)
    for (const e of have) if (!keys.has(e)) keys.set(e, await keyForScope(scope, serverId, e, serverKeys.get(e)))
    const kept = new Map(newest(keys.keys()).map((e) => [e, keys.get(e)]))
    return { package: await sealCodePackage(secret, serverId, packagePayload({ ...metaOf(scope), keys: kept })), epoch: latest, version: row.e2ee.version }
  } catch {
    return null
  }
}

// The full shareable invite for a row of the server's list (the visible code, a dot and the secret in groups), or null
// if this computer cannot open the secret (it does not hold that epoch's key, or the invite carries none).
export async function secretOfInvite(serverId, serverKeys, row) {
  if (!row.e2ee) return null
  const key = serverKeys.get(codeSecretEpoch(row.e2ee.secret))
  if (!key) return null
  try {
    return await openCodeSecret(key, serverId, row.e2ee.secret)
  } catch {
    return null
  }
}

// The voice keys a package gives for one space, oldest epoch first: [{ epoch, bytes }]. `space` = { type,
// id, channelId } (channelId of the room's channel; for a channel its own id). Empty if the package is not for that space.
export async function voiceKeysFromPackage(serverId, pkg, space) {
  const channelId = space.type === 'channel' ? space.id : space.channelId
  const out = []
  for (const epoch of newest(pkg.keys.keys())) {
    const key = pkg.keys.get(epoch)
    const ctx = { serverId, type: space.type, spaceId: space.id, channelId, epoch }
    if (pkg.kind === 'server') out.push({ epoch, bytes: await deriveVoiceKey(key, ctx) })
    else if (pkg.kind === 'channel' && pkg.channelId === channelId) out.push({ epoch, bytes: await deriveVoiceKeyFromBase(key, ctx) })
    else if (pkg.kind === 'room' && space.type === 'room' && pkg.roomId === space.id) out.push({ epoch, bytes: key })
  }
  return out
}
