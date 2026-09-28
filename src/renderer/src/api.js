let cachedBaseUrl = null

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

// --- Servers ---

export const listServers = (token) => request('/api/servers', { token })

export const createServer = (token, name) =>
  request('/api/servers', { method: 'POST', token, body: { name } })

export const getServer = (token, serverId) => request(`/api/servers/${serverId}`, { token })

export const renameServer = (token, serverId, name) =>
  request(`/api/servers/${serverId}`, { method: 'PATCH', token, body: { name } })

export const joinServerWithCode = (token, code) =>
  request('/api/servers/join', { method: 'POST', token, body: { code } })

export const createServerCode = (token, serverId, options) =>
  request(`/api/servers/${serverId}/codes`, { method: 'POST', token, body: options })

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
