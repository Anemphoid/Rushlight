import { useState, useRef, useEffect } from 'react'
import CreateItemForm from '../components/CreateItemForm'
import UserFooter from '../components/UserFooter'
import ContextMenu from '../components/ContextMenu'
import PersistenceVote from '../components/PersistenceVote'
import TextChatView from '../components/TextChatView'
import VoicePanel from '../components/VoicePanel'
import Avatar from '../components/Avatar'
import * as api from '../api'
import { playSound } from '../sounds'

const MODE_LABEL = { voice: 'v', text: 't', both: 'v/t' }
const MIN_SIDEBAR_WIDTH = 200
const MAX_SIDEBAR_WIDTH = 440

const PRESENCE_BEAT_MS = 5000

// Votes whose progress or result the proposer has already seen and dismissed.
// Kept outside the component because the tree screen is rebuilt whenever you
// visit Settings, and the server lists a finished vote for a minute. Keyed by
// creation time too, since vote numbers start over if the server restarts.
const acknowledgedVotes = new Set()
const voteKey = (p) => `${p.id}:${p.createdAt}:${p.status}`

function spaceId(space) {
  return space.type === 'channel' ? space.channelId : space.roomId
}

function spaceKey(space) {
  return `${space.type}:${spaceId(space)}`
}

// Replace one channel's/room's messages wholesale — the server is the source
// of truth for history.
function withMessages(channels, space, messages) {
  return channels.map((ch) => {
    if (ch.id !== space.channelId) return ch
    if (space.type === 'channel') return { ...ch, messages }
    return {
      ...ch,
      rooms: ch.rooms.map((r) => (r.id === space.roomId ? { ...r, messages } : r))
    }
  })
}

function withAppendedMessage(channels, space, message) {
  return channels.map((ch) => {
    if (ch.id !== space.channelId) return ch
    if (space.type === 'channel') {
      if (message.id != null && ch.messages.some((m) => m.id === message.id)) return ch
      return { ...ch, messages: [...ch.messages, message] }
    }
    return {
      ...ch,
      rooms: ch.rooms.map((r) => {
        if (r.id !== space.roomId) return r
        if (message.id != null && r.messages.some((m) => m.id === message.id)) return r
        return { ...r, messages: [...r.messages, message] }
      })
    }
  })
}

// Fold a freshly fetched tree into local state without throwing away the
// message history that's already been loaded for each space.
function mergeTree(prev, fresh) {
  const prevById = new Map(prev.map((c) => [c.id, c]))
  return fresh.map((ch) => {
    const old = prevById.get(ch.id)
    const oldRooms = new Map((old ? old.rooms : []).map((r) => [r.id, r]))
    return {
      ...ch,
      messages: old ? old.messages : [],
      rooms: ch.rooms.map((r) => ({
        ...r,
        messages: oldRooms.get(r.id) ? oldRooms.get(r.id).messages : []
      }))
    }
  })
}

function ChannelTreeScreen({
  screenName,
  avatarColor,
  onLeave,
  leaveLabel,
  onOpenSettings,
  onOpenProfile,
  onOpenAdminTools,
  serverId,
  serverName,
  onServerRenamed,
  sessionToken,
  accountName,
  pttKey,
  pttHookOk,
  onRetryVoice,
  presence,
  setPresence,
  channels,
  setChannels,
  sidebarWidth,
  setSidebarWidth,
  isAdmin,
  openSpace,
  setOpenSpace
}) {
  const [resizing, setResizing] = useState(false)
  const dragStart = useRef(null) // { startX, startWidth }

  function handleResizeStart(e) {
    dragStart.current = { startX: e.clientX, startWidth: sidebarWidth }
    setResizing(true)

    function handleMouseMove(moveEvent) {
      const { startX, startWidth } = dragStart.current
      const next = startWidth + (moveEvent.clientX - startX)
      setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, next)))
    }
    function handleMouseUp() {
      setResizing(false)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  const [creatingChannel, setCreatingChannel] = useState(false)
  const [creatingRoomFor, setCreatingRoomFor] = useState(null)

  const [confirmDeleteChannel, setConfirmDeleteChannel] = useState(null)
  const [confirmDeleteRoom, setConfirmDeleteRoom] = useState(null)

  const [dragOverId, setDragOverId] = useState(null) // 'c<id>' or 'r<id>' — channel and room ids overlap
  const dragItem = useRef(null) // { type: 'channel', id } | { type: 'room', channelId, id }

  const [contextMenu, setContextMenu] = useState(null) // { x, y, type, channelId, roomId? }
  const [proposals, setProposals] = useState([]) // persistence votes this person started or is asked about
  const [, refreshAcknowledged] = useState(0)
  const [actionError, setActionError] = useState('')

  // Polling bookkeeping. The version counters let a poll that started before
  // a local change throw its (now stale) result away instead of overwriting it.
  const mutationVersion = useRef(0)
  const messageVersion = useRef(0)
  const live = useRef({})
  live.current = { onLeave, onServerRenamed, serverName, openSpace, channels, accountName }
  // Who else was in the open space at the last check — the baseline the
  // join/leave sounds are measured against.
  const prevOthers = useRef({ key: null, names: new Set() })

  // Poll the server's tree so changes other admins make show up without a
  // reload. A stopgap until real-time push exists with the LiveKit work.
  useEffect(() => {
    if (!sessionToken) return
    let cancelled = false
    const timer = setInterval(async () => {
      const version = mutationVersion.current
      try {
        const data = await api.getServer(sessionToken, serverId)
        if (cancelled || mutationVersion.current !== version) return
        setChannels((prev) => mergeTree(prev, data.channels))
        setPresence(data.presence || {})
        setProposals(data.proposals || [])
        if (data.name !== live.current.serverName) live.current.onServerRenamed(data.name)
        const cur = live.current.openSpace
        if (cur) {
          const ch = data.channels.find((c) => c.id === cur.channelId)
          const exists = cur.type === 'channel' ? !!ch : !!(ch && ch.rooms.find((r) => r.id === cur.roomId))
          if (!exists) setOpenSpace(null)
        }
      } catch (err) {
        // Removed from the server, or it was deleted — nothing left to show.
        if (err.status === 403 || err.status === 404) live.current.onLeave()
      }
    }, 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [sessionToken, serverId])

  // Keep the open chat's history fresh — same stopgap as above.
  useEffect(() => {
    if (!sessionToken || !openSpace || openSpace.mode === 'voice') return
    const space = openSpace
    let cancelled = false
    async function load() {
      const version = messageVersion.current
      try {
        const msgs = await api.getMessages(sessionToken, space.type, spaceId(space))
        if (cancelled || messageVersion.current !== version) return
        setChannels((prev) => withMessages(prev, space, msgs))
      } catch {
        // transient; the next tick tries again
      }
    }
    load()
    const timer = setInterval(load, 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
      // An ephemeral space is wiped once everyone has left, so don't keep a
      // local copy of it around. It reloads from the server on the way back in.
      const ch = live.current.channels.find((c) => c.id === space.channelId)
      const target = space.type === 'channel' ? ch : ch && ch.rooms.find((r) => r.id === space.roomId)
      if (target && !target.persistent) setChannels((prev) => withMessages(prev, space, []))
    }
  }, [sessionToken, openSpace && openSpace.type, openSpace && openSpace.channelId, openSpace && openSpace.roomId])

  function othersIn(list) {
    return new Set((list || []).map((p) => p.name).filter((n) => n !== live.current.accountName))
  }

  // Check in to the open space every few seconds. This is what tells the
  // server someone is here, so it knows when an ephemeral space has emptied.
  useEffect(() => {
    if (!sessionToken || !openSpace) return
    const space = openSpace
    const key = spaceKey(space)
    let cancelled = false
    let first = true
    prevOthers.current = { key: null, names: new Set() }

    async function beat() {
      try {
        const { presence: next } = await api.sendPresence(
          sessionToken,
          space.type,
          spaceId(space),
          avatarColor
        )
        if (cancelled) return
        if (first) {
          first = false
          // Whoever is already here when I arrive isn't news.
          prevOthers.current = { key, names: othersIn(next[key]) }
        }
        setPresence(next)
      } catch {
        // transient; the next beat tries again
      }
    }
    beat()
    const timer = setInterval(beat, PRESENCE_BEAT_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [sessionToken, openSpace && openSpace.type, openSpace && openSpace.channelId, openSpace && openSpace.roomId, avatarColor])

  // Actually leaving (going home, another server, or the space being removed)
  // tells the server right away instead of waiting for the check-in to expire.
  // Switching straight to another space doesn't — the next check-in moves me.
  const inSpace = !!openSpace
  useEffect(() => {
    if (!sessionToken || !inSpace) return
    return () => {
      api.leavePresence(sessionToken).catch(() => {})
    }
  }, [sessionToken, inSpace])

  // Someone else arriving in or leaving the space I'm in.
  useEffect(() => {
    if (!sessionToken || !openSpace || openSpace.mode !== 'text') return
    const key = spaceKey(openSpace)
    const prev = prevOthers.current
    if (prev.key !== key) return
    const now = othersIn(presence[key])
    let joined = false
    let left = false
    now.forEach((n) => {
      if (!prev.names.has(n)) joined = true
    })
    prev.names.forEach((n) => {
      if (!now.has(n)) left = true
    })
    prevOthers.current = { key, names: now }
    if (joined) playSound('other-join')
    if (left) playSound('other-leave')
  }, [presence])

  // Entering, or moving between, spaces — same sounds Alpha 1 used.
  function selectSpace(space) {
    if (openSpace && spaceKey(openSpace) === spaceKey(space)) return
    playSound(openSpace ? 'room-switch' : 'self-join')
    setOpenSpace(space)
  }

  // Everyone currently in a space, straight from the server. Guests aren't
  // tracked (no account to check in with), so they're shown locally.
  function occupantsFor(key) {
    const list = presence[key] || []
    if (!sessionToken && openSpace && spaceKey(openSpace) === key) {
      return [...list, { id: 'self', name: screenName, avatarColor }]
    }
    return list
  }

  async function runMutation(fn) {
    setActionError('')
    mutationVersion.current++
    try {
      return await fn()
    } catch (err) {
      setActionError(err.message)
      return undefined
    } finally {
      mutationVersion.current++
    }
  }

  async function commitServerName() {
    setEditingName(false)
    const next = nameDraft.trim()
    if (!next || next === serverName) return
    const ok = await runMutation(() => api.renameServer(sessionToken, serverId, next))
    if (ok) onServerRenamed(next)
  }

  function openChannelMenu(e, channelId) {
    if (!isAdmin) return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'channel', channelId })
  }

  function openRoomMenu(e, channelId, roomId) {
    if (!isAdmin) return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'room', channelId, roomId })
  }

  function requestPersistentToggle(type, channelId, roomId) {
    const channel = channels.find((c) => c.id === channelId)
    const target = type === 'channel' ? channel : channel.rooms.find((r) => r.id === roomId)
    if (target.persistent) {
      // Persistent -> ephemeral needs no consent, just apply it
      setPersistent(type, channelId, roomId, false)
    } else {
      // Ephemeral -> persistent means history starts being kept, so everyone
      // with a message in the chat gets a vote. If nobody else has written in
      // it, the server just switches it on.
      startPersistVote(type, channelId, roomId)
    }
  }

  async function startPersistVote(type, channelId, roomId) {
    const result = await runMutation(() =>
      api.startPersistVote(sessionToken, serverId, type, channelId, roomId)
    )
    if (!result) return
    if (result.immediate) {
      applyPersistentLocally(type, channelId, roomId, true)
    } else if (result.proposal) {
      setProposals((prev) => [...prev.filter((p) => p.id !== result.proposal.id), result.proposal])
      // If it was decided on the spot, the tree poll will also show the new state.
      if (result.proposal.status === 'passed') applyPersistentLocally(type, channelId, roomId, true)
    }
  }

  async function castBallot(proposal, vote) {
    const result = await runMutation(() => api.castVote(sessionToken, proposal.id, vote))
    if (result && result.proposal) {
      setProposals((prev) => prev.map((p) => (p.id === proposal.id ? result.proposal : p)))
    }
  }

  async function withdrawOwnVote(proposal) {
    const result = await runMutation(() => api.withdrawVote(sessionToken, proposal.id))
    if (result && result.proposal) {
      setProposals((prev) => prev.filter((p) => p.id !== proposal.id))
      // The server keeps a closed vote around for a minute. Without this, the
      // next refresh would tell you about a cancellation you just did yourself.
      acknowledgeVote({ ...proposal, status: 'cancelled' })
    }
  }

  function acknowledgeVote(proposal) {
    acknowledgedVotes.add(voteKey(proposal))
    refreshAcknowledged((n) => n + 1)
  }

  async function setPersistent(type, channelId, roomId, value) {
    const result = await runMutation(() =>
      type === 'channel'
        ? api.patchChannel(sessionToken, serverId, channelId, { persistent: value })
        : api.patchRoom(sessionToken, serverId, channelId, roomId, { persistent: value })
    )
    if (!result) return
    applyPersistentLocally(type, channelId, roomId, value)
  }

  function applyPersistentLocally(type, channelId, roomId, value) {
    setChannels((prev) =>
      prev.map((ch) => {
        if (ch.id !== channelId) return ch
        if (type === 'channel') return { ...ch, persistent: value }
        return {
          ...ch,
          rooms: ch.rooms.map((r) => (r.id === roomId ? { ...r, persistent: value } : r))
        }
      })
    )
  }

  async function addChannel({ name, mode, persistent }) {
    const created = await runMutation(() =>
      api.createChannel(sessionToken, serverId, { name, mode, persistent })
    )
    if (!created) return
    setChannels((prev) => [...prev, { ...created, rooms: [], messages: [] }])
    setCreatingChannel(false)
  }

  async function addRoom(channelId, { name, mode, persistent }) {
    const created = await runMutation(() =>
      api.createRoom(sessionToken, serverId, channelId, { name, mode, persistent })
    )
    if (!created) return
    setChannels((prev) =>
      prev.map((ch) =>
        ch.id === channelId
          ? { ...ch, rooms: [...ch.rooms, { ...created, messages: [] }] }
          : ch
      )
    )
    setCreatingRoomFor(null)
  }

  // Throws on failure so the chat composer can keep the draft and say why.
  async function sendMessageToOpenSpace(message) {
    if (!openSpace) return
    const space = openSpace
    if (!sessionToken) {
      // Anonymous guests have no session to save history under — local only.
      setChannels((prev) => withAppendedMessage(prev, space, message))
      return
    }
    messageVersion.current++
    try {
      const saved = await api.postMessage(sessionToken, space.type, spaceId(space), {
        text: message.text,
        avatarColor: message.avatarColor
      })
      setChannels((prev) => withAppendedMessage(prev, space, saved))
    } finally {
      messageVersion.current++
    }
  }

  async function deleteChannel(channelId) {
    const ok = await runMutation(() => api.deleteChannel(sessionToken, serverId, channelId))
    setConfirmDeleteChannel(null)
    if (!ok) return
    setChannels((prev) => prev.filter((ch) => ch.id !== channelId))
    if (openSpace && openSpace.channelId === channelId) setOpenSpace(null)
  }

  async function deleteRoom(channelId, roomId) {
    const ok = await runMutation(() => api.deleteRoom(sessionToken, serverId, channelId, roomId))
    setConfirmDeleteRoom(null)
    if (!ok) return
    setChannels((prev) =>
      prev.map((ch) =>
        ch.id === channelId ? { ...ch, rooms: ch.rooms.filter((r) => r.id !== roomId) } : ch
      )
    )
    if (openSpace && openSpace.type === 'room' && openSpace.roomId === roomId) setOpenSpace(null)
  }

  async function persistPositions(ids, patchOne) {
    await runMutation(async () => {
      for (let i = 0; i < ids.length; i++) await patchOne(ids[i], i)
    })
  }

  function handleChannelDrop(targetId) {
    const d = dragItem.current
    setDragOverId(null)
    if (!d || d.type !== 'channel' || d.id === targetId) return
    const from = channels.findIndex((c) => c.id === d.id)
    const to = channels.findIndex((c) => c.id === targetId)
    if (from < 0 || to < 0) return
    const updated = [...channels]
    const [moved] = updated.splice(from, 1)
    updated.splice(to, 0, moved)
    setChannels(updated)
    persistPositions(
      updated.map((c) => c.id),
      (id, position) => api.patchChannel(sessionToken, serverId, id, { position })
    )
  }

  function handleRoomDrop(channelId, targetRoomId) {
    const d = dragItem.current
    setDragOverId(null)
    if (!d || d.type !== 'room' || d.channelId !== channelId || d.id === targetRoomId) return
    const channel = channels.find((c) => c.id === channelId)
    if (!channel) return
    const from = channel.rooms.findIndex((r) => r.id === d.id)
    const to = channel.rooms.findIndex((r) => r.id === targetRoomId)
    if (from < 0 || to < 0) return
    const updatedRooms = [...channel.rooms]
    const [moved] = updatedRooms.splice(from, 1)
    updatedRooms.splice(to, 0, moved)
    setChannels((prev) => prev.map((ch) => (ch.id === channelId ? { ...ch, rooms: updatedRooms } : ch)))
    persistPositions(
      updatedRooms.map((r) => r.id),
      (id, position) => api.patchRoom(sessionToken, serverId, channelId, id, { position })
    )
  }

  return (
    <div className="tree-screen">
      <div className="tree-sidebar" style={{ width: sidebarWidth }}>
        <div className="tree-sidebar-scroll">
          {actionError && (
            <div
              className="error-text"
              style={{ margin: '0 0 8px', cursor: 'pointer' }}
              title="Click to dismiss"
              onClick={() => setActionError('')}
            >
              {actionError}
            </div>
          )}
          <div className="server-row">
            {editingName ? (
              <input
                className="server-name"
                value={nameDraft}
                autoFocus
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitServerName}
                onKeyDown={(e) => e.key === 'Enter' && commitServerName()}
              />
            ) : (
              <span
                className="server-name"
                style={{ cursor: isAdmin ? 'text' : 'default' }}
                onClick={() => {
                  if (!isAdmin) return
                  setNameDraft(serverName)
                  setEditingName(true)
                }}
              >
                {serverName}
              </span>
            )}
            {isAdmin && (
              <button
                type="button"
                className="tree-add-btn"
                title="Add channel"
                onClick={() => setCreatingChannel((v) => !v)}
              >
                +
              </button>
            )}
          </div>

          {creatingChannel && (
            <CreateItemForm
              kind="channel"
              onCancel={() => setCreatingChannel(false)}
              onCreate={addChannel}
            />
          )}

          {channels.map((ch) => (
            <div className="channel-block" key={ch.id}>
              <div
                className={
                  'channel-row' +
                  (dragOverId === 'c' + ch.id ? ' drag-over' : '') +
                  ' clickable'
                }
                draggable={isAdmin}
                onClick={() =>
                  selectSpace({ type: 'channel', channelId: ch.id, name: ch.name, mode: ch.mode })
                }
                onDragStart={() => (dragItem.current = { type: 'channel', id: ch.id })}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (isAdmin) setDragOverId('c' + ch.id)
                }}
                onDragLeave={() => setDragOverId(null)}
                onDrop={() => handleChannelDrop(ch.id)}
                onContextMenu={(e) => openChannelMenu(e, ch.id)}
              >
                <span>
                  <span className="mode-label">{MODE_LABEL[ch.mode]}</span>
                  {ch.name}
                  {ch.persistent && <span className="persistent-tag">persistent</span>}
                </span>
                {isAdmin && (
                  <span style={{ display: 'flex', gap: 4 }}>
                    <button
                      type="button"
                      className="tree-add-btn"
                      title="Add room"
                      onClick={(e) => {
                        e.stopPropagation()
                        setCreatingRoomFor((v) => (v === ch.id ? null : ch.id))
                      }}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className="tree-add-btn"
                      title="Delete channel"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmDeleteChannel((v) => (v === ch.id ? null : ch.id))
                      }}
                    >
                      ×
                    </button>
                  </span>
                )}
              </div>

              {occupantsFor('channel:' + ch.id).map((p) => (
                <div className="room-presence channel-level" key={p.id}>
                  <Avatar color={p.avatarColor} name={p.name} size={16} />
                  {p.name}
                </div>
              ))}

              {confirmDeleteChannel === ch.id && (
                <div className="create-form">
                  <p style={{ fontSize: 12, margin: '0 0 10px', color: 'var(--text)' }}>
                    Delete <strong>{ch.name}</strong>
                    {ch.rooms.length > 0
                      ? ` and its ${ch.rooms.length} room${ch.rooms.length > 1 ? 's' : ''}`
                      : ''}
                    ?
                  </p>
                  <div className="create-form-actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setConfirmDeleteChannel(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      style={{ background: 'var(--danger)' }}
                      onClick={() => deleteChannel(ch.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}

              {creatingRoomFor === ch.id && (
                <CreateItemForm
                  kind="room"
                  onCancel={() => setCreatingRoomFor(null)}
                  onCreate={(data) => addRoom(ch.id, data)}
                />
              )}

              {ch.rooms.map((room) => (
                <div key={room.id}>
                  <div
                    className={
                      'room-row' +
                      (dragOverId === 'r' + room.id ? ' drag-over' : '') +
                      ' clickable'
                    }
                    style={{ justifyContent: 'space-between' }}
                    draggable={isAdmin}
                    onClick={() =>
                      selectSpace({
                        type: 'room',
                        channelId: ch.id,
                        roomId: room.id,
                        name: room.name,
                        mode: room.mode
                      })
                    }
                    onDragStart={() =>
                      (dragItem.current = { type: 'room', channelId: ch.id, id: room.id })
                    }
                    onDragOver={(e) => {
                      e.preventDefault()
                      if (isAdmin) setDragOverId('r' + room.id)
                    }}
                    onDragLeave={() => setDragOverId(null)}
                    onDrop={() => handleRoomDrop(ch.id, room.id)}
                    onContextMenu={(e) => openRoomMenu(e, ch.id, room.id)}
                  >
                    <span>
                      <span className="mode-label">{MODE_LABEL[room.mode]}</span>
                      {room.name}
                      {room.persistent && <span className="persistent-tag">persistent</span>}
                    </span>
                    {isAdmin && (
                      <button
                        type="button"
                        className="tree-add-btn"
                        title="Delete room"
                        onClick={(e) => {
                          e.stopPropagation()
                          setConfirmDeleteRoom((v) =>
                            v && v.roomId === room.id
                              ? null
                              : { channelId: ch.id, roomId: room.id }
                          )
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {occupantsFor('room:' + room.id).map((p) => (
                    <div className="room-presence" key={p.id}>
                      <Avatar color={p.avatarColor} name={p.name} size={16} />
                      {p.name}
                    </div>
                  ))}
                  {confirmDeleteRoom &&
                    confirmDeleteRoom.channelId === ch.id &&
                    confirmDeleteRoom.roomId === room.id && (
                      <div className="create-form" style={{ marginLeft: 20 }}>
                        <p style={{ fontSize: 12, margin: '0 0 10px', color: 'var(--text)' }}>
                          Delete <strong>{room.name}</strong>?
                        </p>
                        <div className="create-form-actions">
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => setConfirmDeleteRoom(null)}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="btn-primary"
                            style={{ background: 'var(--danger)' }}
                            onClick={() => deleteRoom(ch.id, room.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                </div>
              ))}
            </div>
          ))}
        </div>

        <UserFooter
          displayName={screenName}
          avatarColor={avatarColor}
          isAdmin={isAdmin}
          onOpenSettings={onOpenSettings}
          onOpenProfile={onOpenProfile}
          onOpenAdminTools={onOpenAdminTools}
        />
      </div>

      <div
        className={'sidebar-resize-handle' + (resizing ? ' dragging' : '')}
        onMouseDown={handleResizeStart}
      />

      <div className="tree-main">
        {openSpace ? (
          <div className="space-view">
            {openSpace.mode !== 'text' && (
              <VoicePanel
                compact={openSpace.mode === 'both'}
                pttKey={pttKey}
                pttHookOk={pttHookOk}
                localColor={avatarColor}
                colorFor={(name) => {
                  const list = presence[spaceKey(openSpace)] || []
                  return (list.find((p) => p.name === name) || {}).avatarColor || null
                }}
                onRetry={onRetryVoice}
              />
            )}
            {openSpace.mode !== 'voice' && (
          <TextChatView
            roomName={openSpace.name}
            screenName={screenName}
            avatarColor={avatarColor}
            messages={(() => {
              const ch = channels.find((c) => c.id === openSpace.channelId)
              if (!ch) return []
              return openSpace.type === 'channel'
                ? ch.messages
                : ch.rooms.find((r) => r.id === openSpace.roomId)?.messages || []
            })()}
            onSend={sendMessageToOpenSpace}
            localOnly={!sessionToken}
            persistent={(() => {
              const ch = channels.find((c) => c.id === openSpace.channelId)
              if (!ch) return false
              return openSpace.type === 'channel'
                ? ch.persistent
                : !!(ch.rooms.find((r) => r.id === openSpace.roomId) || {}).persistent
            })()}
          />
            )}
          </div>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <p>Click a channel or room to join it, or use the button below.</p>
            <button
              type="button"
              className="btn-secondary"
              style={{ marginTop: 14, width: 'auto', padding: '8px 20px' }}
              onClick={onLeave}
            >
              {leaveLabel}
            </button>
          </div>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: (() => {
                const ch = channels.find((c) => c.id === contextMenu.channelId)
                const target =
                  contextMenu.type === 'channel'
                    ? ch
                    : ch.rooms.find((r) => r.id === contextMenu.roomId)
                return target.persistent ? 'Make ephemeral' : 'Make persistent'
              })(),
              onClick: () =>
                requestPersistentToggle(
                  contextMenu.type,
                  contextMenu.channelId,
                  contextMenu.roomId
                )
            }
          ]}
        />
      )}

      {(() => {
        // Being asked comes first; then progress or the result of a vote you started.
        const ballot = proposals.find((p) => p.status === 'open' && p.canVote && p.yourVote == null)
        if (ballot) {
          return (
            <PersistenceVote mode="ballot" proposal={ballot} onVote={(v) => castBallot(ballot, v)} />
          )
        }
        const own = proposals.find((p) => p.isProposer && !acknowledgedVotes.has(voteKey(p)))
        if (!own) return null
        return (
          <PersistenceVote
            mode={own.status === 'open' ? 'progress' : 'result'}
            proposal={own}
            onWithdraw={() => withdrawOwnVote(own)}
            onHide={() => acknowledgeVote(own)}
            onClose={() => acknowledgeVote(own)}
          />
        )
      })()}
    </div>
  )
}

export default ChannelTreeScreen
