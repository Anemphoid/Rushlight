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

async function request(path, { method = 'GET', body, token } = {}) {
  let baseUrl
  try {
    baseUrl = await getBaseUrl()
  } catch {
    throw new Error("Couldn't read the server address from config.")
  }

  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`

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
    // Set when the server says why someone lost access: 'expired', 'removed' or 'banned'.
    if (data.reason) err.reason = data.reason
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
