import { useState, useRef, useEffect, useSyncExternalStore } from 'react'
import CreateItemForm from '../components/CreateItemForm'
import UserFooter from '../components/UserFooter'
import ContextMenu from '../components/ContextMenu'
import PersistenceVote from '../components/PersistenceVote'
import * as e2eeSession from '../e2eeSession'
import TextChatView from '../components/TextChatView'
import VoicePanel from '../components/VoicePanel'
import NowPlayingPanel from '../components/NowPlayingPanel'
import jellyboxImage from '../assets/images/jellybox.png'
import UserVolumeMenu from '../components/UserVolumeMenu'
import SafetyNumberDialog from '../components/SafetyNumberDialog'
import DeviceNotices from '../components/DeviceNotices'
import Avatar from '../components/Avatar'
import Icon from '../components/Icon'
import * as api from '../api'
import { avatarUrl } from '../api'
import { playSound } from '../sounds'
import * as voice from '../voice'
import * as unread from '../unread'
import { accessEndedNotice } from '../accessEnded'

const MODE_LABEL = { voice: 'v', text: 't', both: 'v/t' }
const MIN_SIDEBAR_WIDTH = 200
const MAX_SIDEBAR_WIDTH = 440

const PRESENCE_BEAT_MS = 5000
const PRESENCE_RETRY_MS = 1500

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

// One person listed under a channel or room. In the space you're connected to
// by voice it also shows who is talking and who is muted, and right-clicking
// someone else there opens their personal volume.
function Occupant({ p, channelLevel, vp, verified, onContextMenu }) {
  return (
    <div
      className={
        'room-presence' +
        (channelLevel ? ' channel-level' : '') +
        (vp && vp.isSpeaking ? ' speaking' : '')
      }
      onContextMenu={onContextMenu}
    >
      <Avatar color={p.avatarColor} name={p.name} imageUrl={p.bot ? jellyboxImage : avatarUrl(p.id, p.avatarUpdatedAt)} size={16} />
      <span className="occupant-name">{p.name}</span>
      {verified && (
        <svg className="occupant-verified" width="12" height="12" viewBox="0 0 12 12" aria-label="Verified" role="img">
          <title>Verified: you checked their safety number</title>
          <path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {p.bot && <span className="member-badge">bot</span>}
      {vp && vp.isMuted && <span className="occupant-muted">muted</span>}
    </div>
  )
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
  accountId,
  ownAvatarUpdatedAt,
  onLeave,
  leaveLabel,
  onOpenSettings,
  onOpenProfile,
  onOpenAdminTools,
  serverId,
  serverName,
  onServerRenamed,
  sessionToken,
  guestToken,
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
  isOwner,
  onRoleChanged,
  retentionMonths,
  onRetentionChanged,
  e2ee,
  onE2eeChanged,
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
  const [volumeMenu, setVolumeMenu] = useState(null) // { x, y, name, accountId, showVolume }
  const [safetyFor, setSafetyFor] = useState(null) // an account id whose safety number is open
  const unreadCounts = useSyncExternalStore(unread.subscribe, unread.getSnapshot)
  const voiceState = useSyncExternalStore(voice.subscribe, voice.getSnapshot)
  const trust = e2eeSession.trustOf(useSyncExternalStore(e2eeSession.subscribeTrust, e2eeSession.getTrustSnapshot), serverId)
  const e2eeStatus = e2eeSession.statusOf(useSyncExternalStore(e2eeSession.subscribe, e2eeSession.getSnapshot), serverId)

  // Polling bookkeeping. The version counters let a poll that started before
  // a local change throw its (now stale) result away instead of overwriting it.
  const mutationVersion = useRef(0)
  const messageVersion = useRef(0)
  const live = useRef({})
  live.current = { onLeave, onServerRenamed, onRoleChanged, onRetentionChanged, onE2eeChanged, e2ee, retentionMonths, isAdmin, isOwner, serverName, openSpace, channels, accountName, accountId, screenName }
  // Accounts and guests both check in to presence; only accounts have a session token.
  const authToken = sessionToken || guestToken
  // Who else was in the open space at the last check — the baseline the
  // join/leave sounds are measured against.
  const prevOthers = useRef({ key: null, names: new Set() })

  // Look for new messages in the text spaces that aren't open. Ephemeral spaces
  // only hold messages while someone is in them, so those are only worth asking
  // about when occupied; persistent ones are always checked.
  function checkUnread(data) {
    const open = live.current.openSpace
    const openKey = open ? spaceKey(open) : null
    const presenceNow = data.presence || {}
    const targets = []
    data.channels.forEach((ch) => {
      if (ch.mode !== 'voice') targets.push({ type: 'channel', id: ch.id, name: ch.name, persistent: ch.persistent })
      ch.rooms.forEach((r) => {
        if (r.mode !== 'voice') targets.push({ type: 'room', id: r.id, name: r.name, persistent: r.persistent })
      })
    })
    targets
      .filter((t) => {
        const key = `${t.type}:${t.id}`
        return key !== openKey && (t.persistent || (presenceNow[key] || []).length > 0)
      })
      .forEach(async (t) => {
        try {
          const messages = await api.getMessages(sessionToken, t.type, t.id)
          unread.observe({
            key: unread.scopedKey(serverId, `${t.type}:${t.id}`),
            title: `${live.current.serverName} · ${t.name}`,
            messages,
            isOpen: false,
            selfId: live.current.accountId
          })
        } catch {
          // transient; the next check tries again
        }
      })
  }

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
        checkUnread(data)
        if (data.name !== live.current.serverName) live.current.onServerRenamed(data.name)
        if (data.retentionMonths && data.retentionMonths !== live.current.retentionMonths && live.current.onRetentionChanged) {
          live.current.onRetentionChanged(data.retentionMonths)
        }
        // Encryption: keep the keys current, and tell the app if the server's key state moved.
        if (data.e2ee) {
          const was = live.current.e2ee || {}
          if (live.current.onE2eeChanged && (was.enabled !== data.e2ee.enabled || was.epoch !== data.e2ee.epoch || was.rekeyNeeded !== data.e2ee.rekeyNeeded)) {
            live.current.onE2eeChanged(data.e2ee)
          }
          e2eeSession.refresh({ token: sessionToken, accountId: live.current.accountId, serverId, e2ee: data.e2ee, isAdmin: !!data.isAdmin })
        }
        // Made an admin or the owner (or demoted) since this person last looked.
        if (
          live.current.onRoleChanged &&
          (!!data.isAdmin !== !!live.current.isAdmin || !!data.isOwner !== !!live.current.isOwner)
        ) {
          live.current.onRoleChanged({ isAdmin: !!data.isAdmin, isOwner: !!data.isOwner })
        }
        const cur = live.current.openSpace
        if (cur) {
          const ch = data.channels.find((c) => c.id === cur.channelId)
          const exists = cur.type === 'channel' ? !!ch : !!(ch && ch.rooms.find((r) => r.id === cur.roomId))
          if (!exists) setOpenSpace(null)
        }
      } catch (err) {
        // Removed from the server, or it was deleted — nothing left to show.
        if (err.status === 403) live.current.onLeave(accessEndedNotice(err))
        else if (err.status === 404) live.current.onLeave()
      }
    }, 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [sessionToken, serverId])

  // An encrypted call that could not start for want of the key starts by itself once the key is here.
  useEffect(() => {
    if (voiceState.needsKey && e2eeStatus.state === 'ready' && onRetryVoice) onRetryVoice()
  }, [voiceState.needsKey, e2eeStatus.state, e2eeStatus.epoch])

  // A new key epoch arrived (someone was removed) while in an encrypted call: switch to it, so the call goes on.
  useEffect(() => {
    if (!voiceState.encrypted || e2eeStatus.state !== 'ready' || !voiceState.key) return
    const [type, id] = voiceState.key.split(':')
    const space = { type, id: Number(id), channelId: openSpace ? openSpace.channelId : undefined }
    let cancelled = false
    e2eeSession.voiceKeysFor(accountId, serverId, space).then((keys) => {
      if (!cancelled) voice.setVoiceKeys(keys)
    })
    return () => {
      cancelled = true
    }
  }, [e2eeStatus.epoch, voiceState.encrypted, voiceState.key])

  // A guest in an encrypted call holds only what their invite carried, so they ask the server again every few seconds
  // for the keys of a newer epoch (admins' apps add them) and switch to them, so the call goes on after a key change.
  useEffect(() => {
    if (sessionToken || !guestToken || !voiceState.encrypted || !voiceState.key) return
    const [type, id] = voiceState.key.split(':')
    const space = { type, id: Number(id), channelId: openSpace ? openSpace.channelId : undefined }
    let cancelled = false
    const timer = setInterval(async () => {
      try {
        if (!(await e2eeSession.refreshGuest(guestToken)) || cancelled) return
        const keys = await e2eeSession.guestVoiceKeys(space, 0)
        if (!cancelled && keys.length) voice.setVoiceKeys(keys)
      } catch {
        // the next check tries again
      }
    }, 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [sessionToken, guestToken, voiceState.encrypted, voiceState.key])

  // Pick up this server's keys as soon as it opens, not five seconds later.
  useEffect(() => {
    if (!sessionToken || !e2ee) return
    e2eeSession.refresh({ token: sessionToken, accountId, serverId, e2ee, isAdmin })
  }, [sessionToken, serverId, e2ee && e2ee.enabled])

  // Keep the open chat's history fresh — same stopgap as above.
  useEffect(() => {
    if (!sessionToken || !openSpace || openSpace.mode === 'voice') return
    const space = openSpace
    let cancelled = false
    async function load() {
      const version = messageVersion.current
      try {
        let msgs = await api.getMessages(sessionToken, space.type, spaceId(space))
        if (live.current.e2ee && live.current.e2ee.enabled) {
          msgs = await e2eeSession.openMessages(live.current.accountId, serverId, { type: space.type, id: spaceId(space) }, msgs)
        }
        if (cancelled) return
        unread.observe({
          key: unread.scopedKey(serverId, spaceKey(space)),
          title: `${live.current.serverName} · ${space.name}`,
          messages: msgs,
          isOpen: true,
          selfId: live.current.accountId
        })
        if (messageVersion.current !== version) return
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
    // Not me: my account name, or my screen name when I am a guest.
    const me = live.current.accountName || live.current.screenName
    return new Set((list || []).map((p) => p.name).filter((n) => n !== me))
  }

  // Check in to the open space every few seconds. This is what tells the
  // server someone is here, so it knows when an ephemeral space has emptied.
  useEffect(() => {
    if (!authToken || !openSpace) return
    const space = openSpace
    const key = spaceKey(space)
    let cancelled = false
    let first = true
    let retryTimer = null
    prevOthers.current = { key: null, names: new Set() }

    async function beat(isRetry = false) {
      try {
        const { presence: next } = await api.sendPresence(
          authToken,
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
        // One dropped beat shouldn't make you flicker out of the room list for
        // the rest of a 5 second interval, so try once more quickly.
        if (!cancelled && !isRetry) retryTimer = setTimeout(() => beat(true), PRESENCE_RETRY_MS)
      }
    }
    beat()
    const timer = setInterval(beat, PRESENCE_BEAT_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
      clearTimeout(retryTimer)
    }
  }, [authToken, openSpace && openSpace.type, openSpace && openSpace.channelId, openSpace && openSpace.roomId, avatarColor])

  // Actually leaving (going home, another server, or the space being removed)
  // tells the server right away instead of waiting for the check-in to expire.
  // Switching straight to another space doesn't — the next check-in moves me.
  const inSpace = !!openSpace
  useEffect(() => {
    if (!authToken || !inSpace) return
    return () => {
      api.leavePresence(authToken).catch(() => {})
    }
  }, [authToken, inSpace])

  // Closing the window (the X, Alt+F4, quitting) never runs the cleanup above, so tell the
  // server on the way out. Without this the entry lingers until its 20 second timeout.
  useEffect(() => {
    if (!authToken || !inSpace) return
    const onExit = () => api.leavePresenceOnExit(authToken)
    window.addEventListener('pagehide', onExit)
    window.addEventListener('beforeunload', onExit)
    return () => {
      window.removeEventListener('pagehide', onExit)
      window.removeEventListener('beforeunload', onExit)
    }
  }, [authToken, inSpace])

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
    unread.clear(unread.scopedKey(serverId, spaceKey(space)))
    setOpenSpace(space)
  }

  // Everyone currently in a space, straight from the server, guests included. A
  // guest who has only just arrived is shown locally until their first check-in
  // comes back, so they never see an empty room with themselves missing.
  function occupantsFor(key) {
    const list = presence[key] || []
    if (!sessionToken && openSpace && spaceKey(openSpace) === key) {
      const listed = list.some((p) => p.guest && p.name === screenName)
      if (!listed) return [...list, { id: 'self', name: screenName, avatarColor, guest: true }]
    }
    return list
  }

  const unreadIn = (key) => unreadCounts[unread.scopedKey(serverId, key)] || 0

  // The voice-side view of whoever is in the space I'm connected to, by name.
  function voiceFor(key) {
    if (voiceState.key !== key || (voiceState.status !== 'connected' && voiceState.status !== 'reconnecting')) {
      return null
    }
    return new Map(voiceState.participants.map((p) => [p.name, p]))
  }

  const isVerifiedPerson = (p) =>
    !!(e2ee && e2ee.enabled && typeof p.id === 'number' && p.id !== accountId && trust.people[p.id] && e2eeSession.isVerified(accountId, trust.people[p.id]))

  // Right-click someone: their personal volume when they are in your call, and in an encrypted server their safety number.
  function openVolumeMenu(e, p, vp) {
    const showVolume = !!vp && !vp.isLocal
    const canCheck = !!(e2ee && e2ee.enabled && sessionToken && typeof p.id === 'number' && trust.people[p.id])
    if (!showVolume && !canCheck) return
    e.preventDefault()
    setVolumeMenu({ x: e.clientX, y: e.clientY, name: p.name, accountId: canCheck ? p.id : null, showVolume })
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
  // Admins of an encrypted server can allow Jellybox in a voice room. It takes that room's voice out of the
  // end-to-end layer, so the app asks first and everyone in the call reconnects when it changes.
  let jellyboxSwitch = null
  if (isAdmin && sessionToken && e2ee && e2ee.enabled && openSpace && openSpace.mode !== 'text') {
    const ch = channels.find((c) => c.id === openSpace.channelId)
    const node = ch && (openSpace.type === 'channel' ? ch : ch.rooms.find((r) => r.id === openSpace.roomId))
    if (node) {
      jellyboxSwitch = {
        open: !!node.jellyboxOpen,
        onSet: async (open) => {
          const id = openSpace.type === 'channel' ? openSpace.channelId : openSpace.roomId
          await api.setJellyboxAllowed(sessionToken, openSpace.type, id, open)
          setChannels((prev) =>
            prev.map((c) =>
              c.id !== openSpace.channelId
                ? c
                : openSpace.type === 'channel'
                  ? { ...c, jellyboxOpen: open }
                  : { ...c, rooms: c.rooms.map((r) => (r.id === openSpace.roomId ? { ...r, jellyboxOpen: open } : r)) }
            )
          )
        }
      }
    }
  }

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
      if (live.current.e2ee && live.current.e2ee.enabled) {
        // The server cannot read chat here: a command goes on its own route (and is not a message), anything
        // else is sealed on this computer before it leaves.
        if (message.text.startsWith('/')) {
          await api.postCommand(sessionToken, space.type, spaceId(space), message.text)
          return
        }
        const ref = { type: space.type, id: spaceId(space) }
        let sealed
        try {
          sealed = await e2eeSession.seal(accountId, serverId, ref, accountId, message.text)
        } catch (err) {
          if (err.code === 'no_key') throw new Error("This computer doesn't have this server's key yet. It arrives when another member opens Rushlight.")
          if (err.code === 'too_long') throw new Error('That message is too long.')
          throw err
        }
        const saved = await api.postMessage(sessionToken, space.type, spaceId(space), { text: sealed, avatarColor: message.avatarColor })
        const [opened] = await e2eeSession.openMessages(accountId, serverId, ref, [saved])
        setChannels((prev) => withAppendedMessage(prev, space, opened))
        return
      }
      const saved = await api.postMessage(sessionToken, space.type, spaceId(space), {
        text: message.text,
        avatarColor: message.avatarColor
      })
      setChannels((prev) => withAppendedMessage(prev, space, saved))
    } finally {
      messageVersion.current++
    }
  }

  // A picture is its own message. Throws on failure so the composer can keep it and say why.
  async function sendImageToOpenSpace(blob, { text, avatarColor, width, height }) {
    if (!openSpace || !sessionToken) return
    const space = openSpace
    messageVersion.current++
    try {
      if (live.current.e2ee && live.current.e2ee.enabled) {
        // Sealed here, so the server only ever holds scrambled bytes; the caption, type and size go inside the sealed text.
        const ref = { type: space.type, id: spaceId(space) }
        let body
        try {
          body = await e2eeSession.sealPictureFor(accountId, serverId, ref, accountId, new Uint8Array(await blob.arrayBuffer()), { mime: blob.type, width, height }, text || '')
        } catch (err) {
          if (err.code === 'no_key') throw new Error("This computer doesn't have this server's key yet. It arrives when another member opens Rushlight.")
          if (err.code === 'too_long') throw new Error('That caption is too long.')
          throw err
        }
        const saved = await api.postImage(sessionToken, space.type, spaceId(space), new Blob([body], { type: 'application/x-rushlight-sealed' }), { avatarColor })
        const [opened] = await e2eeSession.openMessages(accountId, serverId, ref, [saved])
        setChannels((prev) => withAppendedMessage(prev, space, opened))
        return
      }
      const saved = await api.postImage(sessionToken, space.type, spaceId(space), blob, { text, avatarColor })
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
                <Icon name="plus" size={14} strokeWidth={2.2} />
              </button>
            )}
          </div>

          {creatingChannel && (
            <CreateItemForm
              kind="channel"
              retentionMonths={retentionMonths}
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
                  (ch.joinable === false ? '' : ' clickable')
                }
                draggable={isAdmin}
                onClick={() => {
                  // A guest with a one-room invite sees the parent for context only.
                  if (ch.joinable === false) return
                  selectSpace({ type: 'channel', channelId: ch.id, name: ch.name, mode: ch.mode })
                }}
                onDragStart={() => (dragItem.current = { type: 'channel', id: ch.id })}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (isAdmin) setDragOverId('c' + ch.id)
                }}
                onDragLeave={() => setDragOverId(null)}
                onDrop={() => handleChannelDrop(ch.id)}
                onContextMenu={(e) => openChannelMenu(e, ch.id)}
              >
                <span className={unreadIn('channel:' + ch.id) ? 'has-unread' : ''}>
                  <span className="mode-label">{MODE_LABEL[ch.mode]}</span>
                  {ch.name}
                  {ch.persistent && <span className="persistent-tag">persistent</span>}
                  {unreadIn('channel:' + ch.id) > 0 && (
                    <span className="unread-dot" title={`${unreadIn('channel:' + ch.id)} new`} />
                  )}
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
                      <Icon name="plus" size={14} strokeWidth={2.2} />
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
                      <Icon name="close" size={14} strokeWidth={2.2} />
                    </button>
                  </span>
                )}
              </div>

              {(() => {
                const vmap = voiceFor('channel:' + ch.id)
                return occupantsFor('channel:' + ch.id).map((p) => {
                  const vp = vmap && vmap.get(p.name)
                  return (
                    <Occupant
                      key={p.id}
                      p={p}
                      channelLevel
                      vp={vp}
                      verified={isVerifiedPerson(p)}
                      onContextMenu={(e) => openVolumeMenu(e, p, vp)}
                    />
                  )
                })
              })()}

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
                      className="btn-primary btn-danger"
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
                  retentionMonths={retentionMonths}
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
                    <span className={unreadIn('room:' + room.id) ? 'has-unread' : ''}>
                      <Icon name={room.mode === 'text' ? 'text' : 'voice'} size={16} className="room-icon" />
                      <span className="row-name">{room.name}</span>
                      {room.mode === 'both' && <span className="mode-label">{MODE_LABEL[room.mode]}</span>}
                      {room.persistent && <span className="persistent-tag">persistent</span>}
                      {unreadIn('room:' + room.id) > 0 && (
                        <span className="unread-dot" title={`${unreadIn('room:' + room.id)} new`} />
                      )}
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
                        <Icon name="close" size={14} strokeWidth={2.2} />
                      </button>
                    )}
                  </div>
                  {(() => {
                    const vmap = voiceFor('room:' + room.id)
                    return occupantsFor('room:' + room.id).map((p) => {
                      const vp = vmap && vmap.get(p.name)
                      return (
                        <Occupant
                          key={p.id}
                          p={p}
                          vp={vp}
                          verified={isVerifiedPerson(p)}
                      onContextMenu={(e) => openVolumeMenu(e, p, vp)}
                        />
                      )
                    })
                  })()}
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
                            className="btn-primary btn-danger"
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
          imageUrl={avatarUrl(accountId, ownAvatarUpdatedAt)}
          isAdmin={isAdmin}
          isOwner={isOwner}
          onOpenSettings={onOpenSettings}
          onOpenProfile={onOpenProfile}
          onOpenAdminTools={onOpenAdminTools}
          pttKey={pttKey}
        />
      </div>

      <div
        className={'sidebar-resize-handle' + (resizing ? ' dragging' : '')}
        onMouseDown={handleResizeStart}
      />

      <div className="tree-main">
        {e2ee && e2ee.enabled && sessionToken && (
          <DeviceNotices
            notices={trust.notices}
            token={sessionToken}
            accountId={accountId}
            serverId={serverId}
            onCheck={(id) => setSafetyFor(id)}
            onOpenSettings={onOpenSettings}
          />
        )}
        {openSpace ? (
          <div className="space-view">
            <div className="space-main">
              {openSpace.mode !== 'text' && (
                <VoicePanel
                  compact={openSpace.mode === 'both'}
                  pttKey={pttKey}
                  pttHookOk={pttHookOk}
                  onRetry={onRetryVoice}
                  jellybox={jellyboxSwitch}
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
            onSendImage={sendImageToOpenSpace}
            encrypted={!!(e2ee && e2ee.enabled)}
            keyState={e2eeStatus.state}
            sessionToken={sessionToken}
            localOnly={!sessionToken}
            retentionMonths={retentionMonths}
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
            {openSpace.mode !== 'text' && sessionToken && (
              <NowPlayingPanel
                sessionToken={sessionToken}
                serverId={serverId}
                space={{ type: openSpace.type, id: spaceId(openSpace) }}
                voiceOnly={openSpace.mode === 'voice'}
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
              onClick={() => onLeave()}
            >
              {leaveLabel}
            </button>
          </div>
        )}
      </div>

      {volumeMenu && (
        <UserVolumeMenu
          x={volumeMenu.x}
          y={volumeMenu.y}
          name={volumeMenu.name}
          showVolume={volumeMenu.showVolume}
          verified={volumeMenu.accountId != null && e2eeSession.isVerified(accountId, trust.people[volumeMenu.accountId])}
          onSafety={volumeMenu.accountId != null ? () => setSafetyFor(volumeMenu.accountId) : null}
          onClose={() => setVolumeMenu(null)}
        />
      )}

      {safetyFor != null && trust.people[safetyFor] && (
        <SafetyNumberDialog
          person={trust.people[safetyFor]}
          isYou={safetyFor === accountId}
          verified={e2eeSession.isVerified(accountId, trust.people[safetyFor])}
          onVerify={(value) => e2eeSession.setVerified({ token: sessionToken, accountId, serverId, personId: safetyFor, verified: value })}
          onClose={() => setSafetyFor(null)}
        />
      )}

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
