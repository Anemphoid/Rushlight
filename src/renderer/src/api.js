let cachedBaseUrl = null

// Synchronous on purpose: an <img src> can't await anything. By the time
// anything tries to render an avatar, some earlier request has already
// warmed this cache — there's no code path that shows account data before
// the app has talked to the server at least once.
export function getCachedBaseUrl() {
  return cachedBaseUrl
}

// null if the server address isn't known yet, or the account has no custom
// image — either way the caller should fall back to the color swatch.
export function avatarUrl(accountId, avatarUpdatedAt) {
  if (!accountId || !avatarUpdatedAt || !cachedBaseUrl) return null
  return `${cachedBaseUrl}/api/avatars/${accountId}?v=${avatarUpdatedAt}`
}

async function getBaseUrl() {
  if (cachedBaseUrl) return cachedBaseUrl
  const config = await window.api.getServerConfig()
  cachedBaseUrl = config.serverUrl
  return cachedBaseUrl
}

// A 401 from the server that carries a `reason` of session_ended (the password was changed
// or reset somewhere) or session_expired (the token ran out, or the account is gone) means this
// session is over, whatever request noticed first. The app registers one handler to send the
// person to sign-in with the server's message. A wrong password on a route that asks for one is
// also a 401, but carries no reason, so it never triggers this.
let sessionEndedHandler = null
export function setSessionEndedHandler(fn) {
  sessionEndedHandler = fn
}

// Encrypted servers refuse clients that don't say which version they are (and turn away old ones). The
// version comes from the app; a development build has no real one, so it says it is new enough.
let cachedClientVersion = null
async function clientVersion() {
  if (cachedClientVersion) return cachedClientVersion
  let v = null
  try {
    if (typeof window !== 'undefined' && window.api && window.api.getVersion) v = await window.api.getVersion()
  } catch {
    // no version; the header is left off
  }
  if (import.meta.env && import.meta.env.DEV) v = '999.0.0'
  if (v) cachedClientVersion = v
  return v
}

const versionHeader = async () => {
  const v = await clientVersion()
  return v ? { 'X-Rushlight-Client': v } : {}
}

async function request(path, { method = 'GET', body, token } = {}) {
  let baseUrl
  try {
    baseUrl = await getBaseUrl()
  } catch {
    throw new Error("Couldn't read the server address from config.")
  }

  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const version = await clientVersion()
  if (version) headers['X-Rushlight-Client'] = version

  let res
  try {
    res = await fetch(baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } catch (err) {
    console.error('Rushlight server request failed:', err)
    throw new Error(
      `Couldn't reach ${baseUrl} — ${err.name}: ${err.message}. Check the server is ` +
        'running and server-config.json has the right address.'
    )
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`)
    err.status = res.status
    if (token && res.status === 401 && (data.reason === 'session_ended' || data.reason === 'session_expired')) {
      try {
        if (sessionEndedHandler) sessionEndedHandler({ token, reason: data.reason, message: err.message })
      } catch {
        // the request still fails below
      }
    }
    // Set when the server says why someone lost access: 'expired', 'removed' or 'banned'.
    if (data.reason) err.reason = data.reason
    // A new key that left a member device out names who (rekey_incomplete); epoch_changed says the current one.
    if (Array.isArray(data.missing)) err.missing = data.missing
    if (Number.isInteger(data.epoch)) err.epoch = data.epoch
    if (data.minClient) err.minClient = data.minClient
    // The servers an owner still has to hand over or delete before deleting their account.
    if (Array.isArray(data.servers)) err.servers = data.servers
    throw err
  }
  return data
}

function formatTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function withTime(m) {
  return { ...m, time: formatTime(m.createdAt) }
}

// --- Accounts ---

export const register = (username, password) =>
  request('/api/register', { method: 'POST', body: { username, password } })

export const login = (username, password) =>
  request('/api/login', { method: 'POST', body: { username, password } })

export const getMe = (token) => request('/api/me', { token })

// --- Recovery key, password change and reset ---
// Sign-up (register) and a reset (recoverAccount) answer with `recoveryKey`: 12 words,
// shown once. Nothing but a hash is kept, so it cannot be fetched again. It only counts
// once ackRecoveryKey confirms the person saved it. login and getMe say whether they have
// confirmed one (`recoveryKeyAcked`).
export const createRecoveryKey = (token, password) =>
  request('/api/me/recovery-key', { method: 'POST', token, body: { password } })

// Permanent and immediate. Refused (409, reason 'owns_servers', err.servers) while the account owns a
// server. Their messages stay but are wiped and redacted, and the username becomes free.
export const deleteAccount = (token, password) =>
  request('/api/me', { method: 'DELETE', token, body: { password } })

export const ackRecoveryKey = (token) => request('/api/me/recovery-key/ack', { method: 'POST', token })

// Answers with a fresh `token`: every other session of the account ends.
export const changePassword = (token, currentPassword, newPassword) =>
  request('/api/me/password', { method: 'POST', token, body: { currentPassword, newPassword } })

// Forgot the password: username + recovery key + new password. Answers like a login, plus
// the next `recoveryKey` to confirm.
export const recoverAccount = (username, key, newPassword) =>
  request('/api/recover', { method: 'POST', body: { username, key, newPassword } })

// image: base64 (no data: prefix), mime: one of image/jpeg, image/png, image/webp
export const uploadAvatar = (token, image, mime) =>
  request('/api/me/avatar', { method: 'POST', token, body: { image, mime } })

export const deleteAvatar = (token) => request('/api/me/avatar', { method: 'DELETE', token })

// --- Servers ---

export const listServers = (token) => request('/api/servers', { token })

export const createServer = (token, name) =>
  request('/api/servers', { method: 'POST', token, body: { name } })

export const getServer = (token, serverId) => request(`/api/servers/${serverId}`, { token })

// Owner only: how many months persistent history is kept (3, 6, 9 or 12). With dryRun the server only says how
// many messages that window would remove at the next cleanup, and changes nothing.
export const setRetention = (token, serverId, months, { dryRun = false } = {}) =>
  request(`/api/servers/${serverId}/retention`, { method: 'PUT', token, body: dryRun ? { months, dryRun: true } : { months } })

// Owner only. The preview says what switching on would wipe and how many members are ready; enabling needs the owner's
// password and, when there is anything to wipe, wipe: true. It cannot be switched back off.
export const getEncryptionPreview = (token, serverId) => request(`/api/servers/${serverId}/encryption`, { token })
export const enableEncryption = (token, serverId, { password, wipe }) =>
  request(`/api/servers/${serverId}/encryption/enable`, { method: 'POST', token, body: { password, wipe } })

export const renameServer = (token, serverId, name) =>
  request(`/api/servers/${serverId}`, { method: 'PATCH', token, body: { name } })

// Owner only, both need the owner's password. Handing the server to another member is
// immediate: the old owner stays an admin. Deleting removes every channel, room, message,
// code and membership.
export const transferServer = (token, serverId, accountId, password) =>
  request(`/api/servers/${serverId}/transfer`, { method: 'POST', token, body: { accountId, password } })

export const deleteServer = (token, serverId, password) =>
  request(`/api/servers/${serverId}`, { method: 'DELETE', token, body: { password } })

export const joinServerWithCode = (token, code) =>
  request('/api/servers/join', { method: 'POST', token, body: { code } })

export const createServerCode = (token, serverId, options) =>
  request(`/api/servers/${serverId}/codes`, { method: 'POST', token, body: options })

// Admin only. The codes that can still bring someone in (spent, expired and
// revoked ones are not listed): [{ id, code, persistent, singleUse, expiresAt,
// createdAt, guestsNow, used, scope }]. A used single-use code is listed while a guest
// who came in with it is still here. where scope is null (whole server) or
// { type: 'channel' | 'room', id, name }. Create with options.scope = { type, id }
// to limit a code to one voice channel or room; those codes are for guests only.
export const listServerCodes = (token, serverId) =>
  request(`/api/servers/${serverId}/codes`, { token })

// Admin only. Also removes the guests who joined with this code, including from
// live voice. People who made an account with it keep their membership.
export const revokeServerCode = (token, serverId, codeId) =>
  request(`/api/servers/${serverId}/codes/${codeId}`, { method: 'DELETE', token })

// Admin only. Ends one guest's session without revoking their code, so the other
// guests of a reusable code stay. LiveKit is told first, then presence clears.
export const removeServerGuest = (token, serverId, identity) =>
  request(`/api/servers/${serverId}/guests/${encodeURIComponent(identity)}`, { method: 'DELETE', token })

// Admin only. The guests here now (they have no account, so they are not in the
// members list): [{ identity, name, code, codeId, joinedAt, expiresAt, space }],
// where space is 'channel:3' / 'room:7' once they are in a room, or null.
export const listServerGuests = (token, serverId) =>
  request(`/api/servers/${serverId}/guests`, { token })

// --- Moderation ---
// Owner only. Makes an account-holding member an admin, or takes it away (admin: false). No
// password: it is undone with the same button. The owner is always an admin.
export const setMemberAdmin = (token, serverId, accountId, admin) =>
  request(`/api/servers/${serverId}/members/${accountId}/admin`, { method: 'POST', token, body: { admin } })

export const getMembers = (token, serverId) =>
  request(`/api/servers/${serverId}/members`, { token })

export const getBans = (token, serverId) => request(`/api/servers/${serverId}/bans`, { token })

export const kickMember = (token, serverId, accountId) =>
  request(`/api/servers/${serverId}/members/${accountId}/kick`, { method: 'POST', token })

export const banMember = (token, serverId, accountId, reason) =>
  request(`/api/servers/${serverId}/members/${accountId}/ban`, { method: 'POST', token, body: { reason } })

export const unbanMember = (token, serverId, accountId) =>
  request(`/api/servers/${serverId}/bans/${accountId}`, { method: 'DELETE', token })

// patch: { muted?: boolean, accessExpiresInMinutes?: number|null }
export const patchMember = (token, serverId, accountId, patch) =>
  request(`/api/servers/${serverId}/members/${accountId}`, { method: 'PATCH', token, body: patch })

// Anonymous: no account, no persistent membership. Returns a LiveKit token
// plus a snapshot of the server's real channel tree.
export const joinWithCode = (code, screenName) =>
  request('/api/join', { method: 'POST', body: { code, screenName } })

// A LiveKit token for one channel/room's voice. Works with an account session
// or a guest token — the server decides what each is allowed to enter.
export const getVoiceToken = (token, type, id) =>
  request('/api/voice/token', { method: 'POST', token, body: { type, id } })

// --- Persistence votes ---
// Turning an ephemeral chat persistent needs a vote of everyone who has a
// message in it. If nobody else does, this switches it on straight away.
export const startPersistVote = (token, serverId, type, channelId, roomId) =>
  request(
    type === 'channel'
      ? `/api/servers/${serverId}/channels/${channelId}/persist-vote`
      : `/api/servers/${serverId}/channels/${channelId}/rooms/${roomId}/persist-vote`,
    { method: 'POST', token }
  )

export const castVote = (token, proposalId, vote) =>
  request(`/api/proposals/${proposalId}/vote`, { method: 'POST', token, body: { vote } })

export const withdrawVote = (token, proposalId) =>
  request(`/api/proposals/${proposalId}`, { method: 'DELETE', token })

// --- Channels & rooms ---

export const createChannel = (token, serverId, data) =>
  request(`/api/servers/${serverId}/channels`, { method: 'POST', token, body: data })

export const patchChannel = (token, serverId, channelId, patch) =>
  request(`/api/servers/${serverId}/channels/${channelId}`, { method: 'PATCH', token, body: patch })

export const deleteChannel = (token, serverId, channelId) =>
  request(`/api/servers/${serverId}/channels/${channelId}`, { method: 'DELETE', token })

export const createRoom = (token, serverId, channelId, data) =>
  request(`/api/servers/${serverId}/channels/${channelId}/rooms`, {
    method: 'POST',
    token,
    body: data
  })

export const patchRoom = (token, serverId, channelId, roomId, patch) =>
  request(`/api/servers/${serverId}/channels/${channelId}/rooms/${roomId}`, {
    method: 'PATCH',
    token,
    body: patch
  })

export const deleteRoom = (token, serverId, channelId, roomId) =>
  request(`/api/servers/${serverId}/channels/${channelId}/rooms/${roomId}`, {
    method: 'DELETE',
    token
  })

// --- Messages (type is 'channel' or 'room') ---

export async function getMessages(token, type, id) {
  const path = type === 'channel' ? `/api/channels/${id}/messages` : `/api/rooms/${id}/messages`
  const { messages } = await request(path, { token })
  return messages.map(withTime)
}

export async function postMessage(token, type, id, { text, avatarColor }) {
  const path = type === 'channel' ? `/api/channels/${id}/messages` : `/api/rooms/${id}/messages`
  const message = await request(path, { method: 'POST', token, body: { text, avatarColor } })
  return withTime(message)
}

// A slash command for the music bot. Encrypted servers can't read chat, so commands go on their own route
// and are never stored as messages; the bot answers in the chat as before.
export const postCommand = (token, type, id, text) =>
  request(type === 'channel' ? `/api/channels/${id}/commands` : `/api/rooms/${id}/commands`, { method: 'POST', token, body: { text } })

// --- Encryption: devices and wrapped keys (needs server v0.13.0; the crypto is in e2ee/) ---
export const registerDevice = (token, publicKey, label) => request('/api/devices', { method: 'POST', token, body: { publicKey, label } })
export const listMyDevices = (token) => request('/api/devices', { token })
export const removeDevice = (token, deviceId) => request(`/api/devices/${deviceId}`, { method: 'DELETE', token })
export const getServerDevices = (token, serverId) => request(`/api/servers/${serverId}/devices`, { token })
export const getKeyEnvelopes = (token, serverId, deviceId) => request(`/api/servers/${serverId}/key-envelopes?deviceId=${deviceId}`, { token })
export const postKeyEnvelopes = (token, serverId, body) => request(`/api/servers/${serverId}/key-envelopes`, { method: 'POST', token, body })
// Invites that carry keys (needs server v0.16.0): an admin's app adds a newer epoch to an invite's package, and a guest
// asks again for the package of the invite it came in with.
export const putCodePackage = (token, serverId, codeId, body) =>
  request(`/api/servers/${serverId}/codes/${codeId}/package`, { method: 'PUT', token, body })
// Looks at a code without using it up: whether the server is encrypted and the sealed keys the invite carries.
export const checkCode = (code) => request('/api/code-check', { method: 'POST', body: { code } })
export const getGuestKeyPackage = (guestToken) => request('/api/guest/key-package', { token: guestToken })
export const rekeyServer = (token, serverId, body) => request(`/api/servers/${serverId}/rekey`, { method: 'POST', token, body })

// Send a picture (a Blob already prepared by imagePrep.js) as its own message, with an optional caption.
// The server checks and cleans it. Throws with the server's wording on failure.
export async function postImage(token, type, id, blob, { text = '', avatarColor } = {}) {
  let baseUrl
  try {
    baseUrl = await getBaseUrl()
  } catch {
    throw new Error("Couldn't read the server address from config.")
  }
  const path = type === 'channel' ? `/api/channels/${id}/images` : `/api/rooms/${id}/images`
  const query = new URLSearchParams()
  if (text) query.set('text', text)
  if (avatarColor) query.set('avatarColor', avatarColor)
  let res
  try {
    res = await fetch(`${baseUrl}${path}${query.size ? '?' + query : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': blob.type, Authorization: `Bearer ${token}`, ...(await versionHeader()) },
      body: blob
    })
  } catch (err) {
    console.error('Rushlight picture upload failed:', err)
    throw new Error(`Couldn't reach ${baseUrl} to send the picture.`)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `The picture wasn't sent (${res.status})`)
    err.status = res.status
    if (data.reason) err.reason = data.reason
    if (data.minClient) err.minClient = data.minClient
    if (token && res.status === 401 && (data.reason === 'session_ended' || data.reason === 'session_expired')) {
      try {
        if (sessionEndedHandler) sessionEndedHandler({ token, reason: data.reason, message: err.message })
      } catch {
        // the request still fails below
      }
    }
    throw err
  }
  return withTime(data)
}

// A picture from the chat needs the sign-in token, so it is fetched and shown from a local address
// (null if it can't be had). The caller revokes the address when done.
export async function fetchChatImage(token, imageId) {
  try {
    const baseUrl = await getBaseUrl()
    const res = await fetch(`${baseUrl}/api/images/${imageId}`, { headers: { Authorization: `Bearer ${token}`, ...(await versionHeader()) } })
    if (!res.ok) return null
    return URL.createObjectURL(await res.blob())
  } catch {
    return null
  }
}

// A sealed picture's bytes (encrypted servers): the server returns them as they were sent, and the app opens them
// with the key from the message. Null if they can't be had.
export async function fetchChatImageBytes(token, imageId) {
  try {
    const baseUrl = await getBaseUrl()
    const res = await fetch(`${baseUrl}/api/images/${imageId}`, { headers: { Authorization: `Bearer ${token}`, ...(await versionHeader()) } })
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  }
}

// --- Presence ---
// Check in to a channel/room; returns everyone currently in this server's
// spaces. Called every few seconds while a space is open.
export const sendPresence = (token, type, id, avatarColor) =>
  request('/api/presence', { method: 'POST', token, body: { type, id, avatarColor } })

export const leavePresence = (token) => request('/api/presence/leave', { method: 'POST', token })

// For when the window is closing: an ordinary request can be cut off with the page, a
// keepalive one is allowed to finish. Fire and forget; the server's 20 second
// timeout is still the backstop for a crash or a dropped network.
export function leavePresenceOnExit(token) {
  if (!token || !cachedBaseUrl) return
  try {
    fetch(cachedBaseUrl + '/api/presence/leave', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: '{}'
    }).catch(() => {})
  } catch {
    // closing anyway
  }
}

// Jellybox, the music bot. The owner links one Jellyfin library per server. Everything goes through
// the Rushlight server: the client never learns the Jellyfin address of anyone else's server or its token.
export const getMusic = (token, serverId) => request(`/api/servers/${serverId}/music`, { token })
export const linkMusic = (token, serverId, details) =>
  request(`/api/servers/${serverId}/music`, { method: 'PUT', token, body: details })
export const testMusic = (token, serverId) => request(`/api/servers/${serverId}/music/test`, { method: 'POST', token, body: {} })
export const unlinkMusic = (token, serverId) => request(`/api/servers/${serverId}/music`, { method: 'DELETE', token })
export const getMusicState = (token, type, spaceId) => request(`/api/music/${type}/${spaceId}/state`, { token })
// An admin allows or stops Jellybox in one room of an encrypted server (the room's voice then runs without the
// end-to-end layer, because the bot's audio comes from the server).
export const setJellyboxAllowed = (token, type, spaceId, open) =>
  request(`/api/music/${type}/${spaceId}/allowed`, { method: 'PUT', token, body: { open } })
export const musicControl = (token, type, spaceId, body) =>
  request(`/api/music/${type}/${spaceId}/control`, { method: 'POST', token, body })
export const searchMusic = (token, serverId, q) =>
  request(`/api/servers/${serverId}/music/search?q=${encodeURIComponent(q)}`, { token })

// Cover art needs the session token, which an <img src> cannot send, so fetch it and hand back a blob
// address (null if there is no cover). The caller revokes it when done.
export async function fetchMusicCover(token, serverId, itemId) {
  try {
    const baseUrl = await getBaseUrl()
    const res = await fetch(`${baseUrl}/api/servers/${serverId}/music/cover/${encodeURIComponent(itemId)}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) return null
    return URL.createObjectURL(await res.blob())
  } catch {
    return null
  }
}

// Browsing the library without searching (admins): an alphabetical page of artists, albums or songs, optionally by
// first letter ('#' is digits and symbols), and what is inside one artist or album.
export const browseMusic = (token, serverId, { kind, letter = '', start = 0 }) =>
  request(`/api/servers/${serverId}/music/browse?kind=${kind}${letter ? `&letter=${encodeURIComponent(letter)}` : ''}&start=${start}`, { token })
export const musicChildren = (token, serverId, kind, itemId) =>
  request(`/api/servers/${serverId}/music/browse/${kind}/${itemId}`, { token })

