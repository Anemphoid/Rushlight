import { loadDensity, loadIconSize, saveDensity, saveIconSize } from './displayPrefs'
import { useState, useEffect, useRef } from 'react'
import '@livekit/components-styles'
import TitleBar from './components/TitleBar'
import { LogoSprite } from './components/RushlightLogo'
import { DEFAULT_SKIN, DEFAULT_MODE } from './skins'
import ServerRail from './components/ServerRail'
import ServerDialog from './components/ServerDialog'
import LoginScreen from './screens/LoginScreen'
import CreateAccountScreen from './screens/CreateAccountScreen'
import ScreenNamePrompt from './screens/ScreenNamePrompt'
import UpdateBanner from './components/UpdateBanner'
import HomeScreen from './screens/HomeScreen'
import ChannelTreeScreen from './screens/ChannelTreeScreen'
import RecoverScreen from './screens/RecoverScreen'
import RecoveryKeyPrompt from './components/RecoveryKeyPrompt'
import SettingsScreen from './screens/SettingsScreen'
import ProfileScreen from './screens/ProfileScreen'
import AdminToolsScreen from './screens/AdminToolsScreen'
import ViewTransition, { OverlayLayer } from './components/ViewTransition'
import * as e2eeSession from './e2eeSession'
import { splitFullCode } from './e2ee/crypto'
import * as api from './api'
import { playSound } from './sounds'
import * as voice from './voice'

// The backend sends structure only; message history is loaded per space when
// it's opened, so every channel/room starts with an empty list locally.
function withEmptyMessages(channels) {
  return channels.map((ch) => ({
    ...ch,
    messages: [],
    rooms: ch.rooms.map((r) => ({ ...r, messages: [] }))
  }))
}

function App() {
  const [view, setView] = useState('login')
  const [returnView, setReturnView] = useState('home')
  const [checkingSession, setCheckingSession] = useState(true)
  const [pendingJoinKey, setPendingJoinKey] = useState(null)
  const [screenName, setScreenName] = useState(null)
  const [accountName, setAccountName] = useState(null) // the real username; screenName can be edited locally
  const [avatarColor, setAvatarColor] = useState(null)
  const [accountId, setAccountId] = useState(null)
  const [homeNotice, setHomeNotice] = useState('')
  const [ownAvatarUpdatedAt, setOwnAvatarUpdatedAt] = useState(null)

  // sessionToken is set for real accounts. Guests who joined with a code have
  // none — they see one server's tree and hold a LiveKit token instead.
  const [sessionToken, setSessionToken] = useState(null)
  const [guestToken, setGuestToken] = useState(null) // guests only: lets them ask for voice in the server they joined
  const [voiceRetry, setVoiceRetry] = useState(0)

  // The servers this account belongs to, and the one currently open. The
  // structure itself lives in the backend database — this is just a cache.
  const [servers, setServers] = useState([])
  const [serversError, setServersError] = useState('')
  const [currentServer, setCurrentServer] = useState(null) // { id, name, isAdmin, isOwner }
  const [loginTab, setLoginTab] = useState('login') // which way in the sign-in screen opens on
  const [loginNotice, setLoginNotice] = useState('') // why you were sent to sign-in, if you were
  const [channels, setChannels] = useState([])
  const [presence, setPresence] = useState({}) // 'room:3' / 'channel:1' -> who is in it
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const [openSpace, setOpenSpace] = useState(null)
  const [showServerDialog, setShowServerDialog] = useState(false)

  // Settings — density and icon size apply globally via data attributes,
  // so they take effect everywhere, not just while Settings is open.
  const [density, setDensity] = useState(loadDensity)
  const [iconSize, setIconSize] = useState(loadIconSize)
  const [pttKey, setPttKey] = useState(() => {
    try {
      return localStorage.getItem('rushlight-ptt-key') || 'ControlLeft'
    } catch {
      return 'ControlLeft'
    }
  })
  const [pttHookOk, setPttHookOk] = useState(true)
  const [skin, setSkin] = useState(() => localStorage.getItem('rushlight-skin') || DEFAULT_SKIN)
  const [mode, setMode] = useState(() => localStorage.getItem('rushlight-mode') || DEFAULT_MODE)
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    window.api?.windowIsMaximized().then(setIsMaximized)
    const unsubscribe = window.api?.onWindowMaximizedChange(setIsMaximized)
    return unsubscribe
  }, [])

  useEffect(() => {
    document.documentElement.dataset.density = density
    saveDensity(density)
  }, [density])

  useEffect(() => {
    document.documentElement.dataset.iconSize = iconSize
    saveIconSize(iconSize)
  }, [iconSize])

  // a change of skin or mode fades over about 300 ms instead of flashing: a class on <html> turns the colour
  // transitions on for just that moment (not on the first paint)
  const lookReady = useRef(false)
  const lookTimer = useRef(null)
  function fadeLook() {
    if (!lookReady.current) return
    const root = document.documentElement
    root.classList.add('look-fade')
    clearTimeout(lookTimer.current)
    lookTimer.current = setTimeout(() => root.classList.remove('look-fade'), 400)
  }
  useEffect(() => {
    fadeLook()
    document.documentElement.dataset.skin = skin
    localStorage.setItem('rushlight-skin', skin)
  }, [skin])

  useEffect(() => {
    fadeLook()
    lookReady.current = true
    document.documentElement.dataset.mode = mode
    localStorage.setItem('rushlight-mode', mode)
  }, [mode])

  // Remembered-session check, once on launch. Only a rejected token (401)
  // clears the saved session — an unreachable server shouldn't sign you out.
  useEffect(() => {
    const saved = localStorage.getItem('rushlight-session')
    if (!saved) {
      setCheckingSession(false)
      return
    }
    api
      .getMe(saved)
      .then(({ username, id, avatarUpdatedAt, recoveryKeyAcked }) =>
        handleAccountReady({ screenName: username, sessionToken: saved, id, avatarUpdatedAt, recoveryKeyAcked })
      )
      .catch((err) => {
        if (err.status === 401) {
          localStorage.removeItem('rushlight-session')
          // Say why, when the server did (the password was changed, the session ran out).
          if (err.reason) setLoginNotice(err.message)
        }
      })
      .finally(() => setCheckingSession(false))
  }, [])

  // Any request that finds this session is over (the password was changed or reset in another
  // window, or the session ran out) sends the person to sign-in with the server's message,
  // dropping voice like any other leave. Requests that were sent with an older token, such as
  // ones still in flight when this window changed its own password, are ignored.
  const currentToken = useRef(null)
  currentToken.current = sessionToken || guestToken
  const endSession = useRef(null)
  endSession.current = (message) => {
    resetToLogin()
    setLoginNotice(message)
  }
  useEffect(() => {
    api.setSessionEndedHandler(({ token, message }) => {
      if (token !== currentToken.current) return
      endSession.current(message)
    })
    return () => api.setSessionEndedHandler(null)
  }, [])

  async function refreshServers(token) {
    setServersError('')
    try {
      const { servers: list } = await api.listServers(token)
      setServers(list)
    } catch (err) {
      setServersError(err.message)
    }
  }

  async function enterServer(token, serverId) {
    const data = await api.getServer(token, serverId)
    setCurrentServer({ id: data.id, name: data.name, isAdmin: data.isAdmin, isOwner: !!data.isOwner, retentionMonths: data.retentionMonths || null, e2ee: data.e2ee || null })
    setChannels(withEmptyMessages(data.channels))
    setPresence(data.presence || {})
    setOpenSpace(null)
    setView('connected')
  }

  // ---- Voice ----
  // The voice connection follows whichever space is open: opening a voice or
  // both-mode space joins it, and anything that clears the open space (going
  // home, logging out, the space being deleted) leaves it. Opening Settings
  // changes neither, so a call carries on underneath.
  const voiceSpace = openSpace && openSpace.mode !== 'text' ? openSpace : null
  const voiceKey = voiceSpace
    ? `${voiceSpace.type}:${voiceSpace.type === 'channel' ? voiceSpace.channelId : voiceSpace.roomId}`
    : null
  const voiceAuth = sessionToken || guestToken
  // Whether an admin has allowed Jellybox in the open voice space (the tree's 5 s check keeps this fresh). When it
  // changes, the call reconnects at once with a token that says whether to encrypt, and says why.
  const jellyboxFlag = (() => {
    if (!voiceSpace) return false
    const ch = channels.find((c) => c.id === voiceSpace.channelId)
    if (!ch) return false
    return voiceSpace.type === 'channel' ? !!ch.jellyboxOpen : !!ch.rooms.find((r) => r.id === voiceSpace.roomId)?.jellyboxOpen
  })()
  const lastJellyboxFlag = useRef(null)
  useEffect(() => {
    if (!voiceKey || !voiceAuth) {
      voice.leave()
      return
    }
    let cancelled = false
    const [type, id] = voiceKey.split(':')
    const last = lastJellyboxFlag.current
    const flipped = !!last && last.key === voiceKey && last.flag !== jellyboxFlag
    lastJellyboxFlag.current = { key: voiceKey, flag: jellyboxFlag }
    const note = flipped
      ? jellyboxFlag
        ? 'Jellybox was just allowed in this room, so everyone reconnected. Voice here is no longer end-to-end encrypted. Chat is still private.'
        : 'Jellybox was turned off in this room, so everyone reconnected. Voice here is end-to-end encrypted again.'
      : ''
    ;(async () => {
      try {
        const { token, livekitUrl, encrypted, epoch, jellyboxOpen } = await api.getVoiceToken(voiceAuth, type, Number(id))
        if (cancelled) return
        // An encrypted server's calls are encrypted by this app. The server says so with the token, so a stale idea of
        // the server cannot make this connect in the clear; with no key the call does not start (see voice.join).
        let encryption = null
        if (encrypted) {
          const space = { type, id: Number(id), channelId: voiceSpace.channelId }
          // A member's keys are their computer's; a guest holds only what their invite carried.
          const keys = sessionToken
            ? currentServer
              ? await e2eeSession.prepareVoiceKeys({ token: sessionToken, accountId, serverId: currentServer.id, space, epoch })
              : []
            : await e2eeSession.guestVoiceKeys(space, epoch)
          if (cancelled) return
          encryption = { keys }
        }
        await voice.join({ url: livekitUrl, token, key: voiceKey, encryption, jellyboxOpen: !!jellyboxOpen, note })
      } catch (err) {
        if (!cancelled) voice.fail(err.message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [voiceKey, voiceAuth, voiceRetry, jellyboxFlag])

  // ---- Push-to-talk key ----
  // Register the saved key with the global hook at startup, and find out
  // whether the hook could start at all.
  useEffect(() => {
    if (!window.api || !window.api.setPttKey) return
    window.api.setPttKey(pttKey).then((result) => {
      if (result && result.ok === false) setPttKey('ControlLeft')
    })
    window.api.getPttHookStatus().then((status) => setPttHookOk(!!(status && status.ok)))
  }, [])

  // If the global hook couldn't start, fall back to the key working while this
  // window is focused (and let go if focus is lost, since we'd miss the release).
  useEffect(() => {
    if (pttHookOk) return
    const down = (e) => {
      if (e.code === pttKey && !e.repeat) voice.handlePttKey(true)
    }
    const up = (e) => {
      if (e.code === pttKey) voice.handlePttKey(false)
    }
    const blur = () => voice.handlePttKey(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [pttHookOk, pttKey])

  // Returns whether the key was accepted (a key with no global equivalent is refused).
  async function handlePttKeyChange(code) {
    if (window.api && window.api.setPttKey) {
      const result = await window.api.setPttKey(code)
      if (!result || result.ok === false) return false
      setPttHookOk(result.hookOk !== false)
    }
    setPttKey(code)
    try {
      localStorage.setItem('rushlight-ptt-key', code)
    } catch {
      // won't persist, still applies this session
    }
    return true
  }

  // Login, account creation, and a valid remembered session all end up here.
  async function handleAccountReady({ screenName: name, sessionToken: token, id, avatarUpdatedAt, recoveryKeyAcked }) {
    setScreenName(name)
    setAccountName(name)
    setAccountId(id ?? null)
    setOwnAvatarUpdatedAt(avatarUpdatedAt ?? null)
    setSessionToken(token)
    setGuestToken(null)
    setCurrentServer(null)
    setChannels([])
    setPresence({})
    setLoginNotice('')
    await refreshServers(token)
    // An account with no confirmed recovery key is asked to make one before anything else.
    setView(recoveryKeyAcked === false ? 'recoveryKey' : 'home')
  }

  // A password change gives this session a new token (the others end). Keep the saved one
  // in step, or the next launch would find it rejected.
  function handleSessionChanged(token) {
    setSessionToken(token)
    try {
      if (localStorage.getItem('rushlight-session')) localStorage.setItem('rushlight-session', token)
    } catch {
      // storage unavailable: this session still carries on
    }
  }

  // Guest join: one server's real tree, no account and no server list.
  function handleGuestJoined({ screenName: name, guestToken: token, server }) {
    setScreenName(name)
    setSessionToken(null)
    setGuestToken(token)
    setServers([])
    setCurrentServer({ id: server.id, name: server.name, isAdmin: false, isOwner: false })
    setChannels(withEmptyMessages(server.channels))
    setPresence(server.presence || {})
    setOpenSpace(null)
    setView('connected')
  }

  async function handleSelectServer(serverId) {
    if (view === 'connected' && currentServer && currentServer.id === serverId) return
    const wasInSpace = !!openSpace
    try {
      await enterServer(sessionToken, serverId)
      if (wasInSpace) playSound('self-leave', 0.5)
    } catch (err) {
      setServersError(err.message)
      handleGoHome()
    }
  }

  // Their account is gone: the server has wiped what it keeps, so sign out and say so.
  function handleAccountDeleted() {
    resetToLogin()
    setLoginNotice('Your account was deleted.')
  }

  // From the account deletion refusal: go to a server this person owns and open its Owner Tools.
  async function handleOpenOwnerTools(serverId) {
    try {
      await enterServer(sessionToken, serverId)
      setReturnView('connected')
      setView('adminTools')
    } catch (err) {
      setServersError(err.message)
    }
  }

  // The tree's check found this person's role in the server changed (made an admin, made the
  // owner, or demoted). Update it now, so the Admin Tools button appears or goes without
  // leaving and re-entering. If they were looking at Admin Tools when it was taken away, leave it.
  function handleRoleChanged({ isAdmin, isOwner }) {
    setCurrentServer((s) => (s ? { ...s, isAdmin, isOwner } : s))
    if (!isAdmin && view === 'adminTools') closeOverlay()
  }

  // The history window changed (the owner picked another one, seen on the tree's next check).
  function handleRetentionChanged(months) {
    setCurrentServer((s) => (s ? { ...s, retentionMonths: months } : s))
  }

  // The owner deleted the server from Admin Tools: leave it and say so on the home screen.
  function handleServerDeleted(name) {
    handleGoHome(`${name} was deleted.`)
  }

  function handleGoHome(notice) {
    if (notice) setHomeNotice(notice)
    if (openSpace) playSound('self-leave', 0.5)
    setCurrentServer(null)
    setChannels([])
    setPresence({})
    setOpenSpace(null)
    setView('home')
    if (sessionToken) refreshServers(sessionToken)
  }

  async function handleCreateServer(name) {
    const created = await api.createServer(sessionToken, name)
    await refreshServers(sessionToken)
    setShowServerDialog(false)
    await enterServer(sessionToken, created.id)
  }

  async function handleJoinServer(code) {
    // An invite to an encrypted server is the code, a dot and a secret half; only the code goes to the server.
    const { code: visible, secret } = splitFullCode(code)
    const joined = await api.joinServerWithCode(sessionToken, visible)
    if (joined.e2ee && joined.e2ee.enabled && joined.e2ee.package && secret) {
      // The keys in it, so this member can read at once instead of waiting for another member's app. If it fails the
      // usual way in still works.
      await e2eeSession.takeInviteKeys(accountId, joined.id, secret, joined.e2ee.package).catch(() => {})
    }
    await refreshServers(sessionToken)
    setShowServerDialog(false)
    await enterServer(sessionToken, joined.id)
  }

  function handleServerRenamed(name) {
    setCurrentServer((s) => (s ? { ...s, name } : s))
    setServers((list) => list.map((x) => (currentServer && x.id === currentServer.id ? { ...x, name } : x)))
  }

  function openOverlay(target) {
    setReturnView(view)
    setView(target)
  }

  function closeOverlay() {
    setView(returnView)
  }

  function handleProfileSave({ name, avatarColor: newColor }) {
    setScreenName(name)
    setAvatarColor(newColor)
    closeOverlay()
  }

  function handleAvatarChanged(newAvatarUpdatedAt) {
    setOwnAvatarUpdatedAt(newAvatarUpdatedAt)
  }

  // From the account and recovery screens back to sign-in; `tab` ('login' or 'join') says which one to land on.
  // Not resetToLogin: that also forgets who you are, and is handed an event when used as a click handler.
  function backToLogin(tab) {
    setLoginTab(tab === 'join' ? 'join' : 'login')
    setView('login')
  }

  function resetToLogin() {
    if (openSpace) playSound('self-leave', 0.5)
    e2eeSession.lock()
    localStorage.removeItem('rushlight-session')
    setPendingJoinKey(null)
    setScreenName(null)
    setAccountName(null)
    setAccountId(null)
    setOwnAvatarUpdatedAt(null)
    setAvatarColor(null)
    setSessionToken(null)
    setGuestToken(null)
    setServers([])
    setServersError('')
    setCurrentServer(null)
    setChannels([])
    setPresence({})
    setOpenSpace(null)
    setShowServerDialog(false)
    setView('login')
  }

  // The channel tree. Its effects send the presence check-ins and the leave, so it has
  // to stay mounted for as long as the person is in a server, even while Settings,
  // Profile or Admin Tools is on screen (see treeKept below).
  function renderTree() {
    return (
      <ChannelTreeScreen
        key={currentServer.id}
        screenName={screenName}
        avatarColor={avatarColor}
        accountId={accountId}
        ownAvatarUpdatedAt={ownAvatarUpdatedAt}
        onLeave={sessionToken ? handleGoHome : resetToLogin}
        leaveLabel={sessionToken ? 'Back to home' : 'Leave'}
        onOpenSettings={() => openOverlay('settings')}
        onOpenProfile={() => openOverlay('profile')}
        onOpenAdminTools={() => openOverlay('adminTools')}
        serverId={currentServer.id}
        serverName={currentServer.name}
        onServerRenamed={handleServerRenamed}
        sessionToken={sessionToken}
        guestToken={guestToken}
        accountName={accountName}
        pttKey={pttKey}
        pttHookOk={pttHookOk}
        onRetryVoice={() => setVoiceRetry((n) => n + 1)}
        presence={presence}
        setPresence={setPresence}
        channels={channels}
        setChannels={setChannels}
        sidebarWidth={sidebarWidth}
        setSidebarWidth={setSidebarWidth}
        isAdmin={currentServer.isAdmin}
        isOwner={!!currentServer.isOwner}
        onRoleChanged={handleRoleChanged}
        retentionMonths={currentServer.retentionMonths}
        onRetentionChanged={handleRetentionChanged}
        e2ee={currentServer.e2ee}
        onE2eeChanged={(e2ee) => setCurrentServer((s) => (s ? { ...s, e2ee } : s))}
        openSpace={openSpace}
        setOpenSpace={setOpenSpace}
      />
    )
  }

  function renderView() {
    if (checkingSession) {
      return (
        <div className="screen">
          <p className="settings-note">Checking for a saved session…</p>
        </div>
      )
    }

    if (view === 'createAccount') {
      return <CreateAccountScreen onBack={backToLogin} onAccountCreated={handleAccountReady} />
    }

    if (view === 'recover') {
      return <RecoverScreen onBack={backToLogin} onRecovered={handleAccountReady} />
    }

    if (view === 'recoveryKey' && sessionToken) {
      return (
        <RecoveryKeyPrompt
          sessionToken={sessionToken}
          onDone={() => setView('home')}
          onLogout={resetToLogin}
        />
      )
    }

    if (view === 'screenNamePrompt') {
      return (
        <ScreenNamePrompt
          joinKey={pendingJoinKey}
          onBack={resetToLogin}
          onConfirm={handleGuestJoined}
        />
      )
    }

    if (view === 'settings') {
      return (
        <SettingsScreen
          density={density}
          onChangeDensity={setDensity}
          iconSize={iconSize}
          onChangeIconSize={setIconSize}
          pttKey={pttKey}
          onChangePttKey={handlePttKeyChange}
          pttHookOk={pttHookOk}
          skin={skin}
          onChangeSkin={setSkin}
          mode={mode}
          onChangeMode={setMode}
          sessionToken={sessionToken}
          onSessionChanged={handleSessionChanged}
          onAccountDeleted={handleAccountDeleted}
          onOpenOwnerTools={handleOpenOwnerTools}
          onBack={closeOverlay}
        />
      )
    }

    if (view === 'profile') {
      return (
        <ProfileScreen
          currentName={screenName}
          currentAvatarColor={avatarColor}
          sessionToken={sessionToken}
          accountId={accountId}
          avatarUpdatedAt={ownAvatarUpdatedAt}
          onAvatarChanged={handleAvatarChanged}
          onBack={closeOverlay}
          onSave={handleProfileSave}
        />
      )
    }

    if (view === 'adminTools' && currentServer) {
      return (
        <AdminToolsScreen
          serverId={currentServer.id}
          serverName={currentServer.name}
          sessionToken={sessionToken}
          accountId={accountId}
          onServerDeleted={handleServerDeleted}
          onBack={closeOverlay}
        />
      )
    }

    if (view === 'home') {
      return (
        <HomeScreen
          screenName={screenName}
          servers={servers}
          onSelectServer={handleSelectServer}
          error={serversError}
          notice={homeNotice}
          onDismissNotice={() => setHomeNotice('')}
          onRetry={() => refreshServers(sessionToken)}
          onAdd={() => setShowServerDialog(true)}
          onOpenSettings={() => openOverlay('settings')}
          onLogout={resetToLogin}
        />
      )
    }

    if (view === 'connected' && currentServer) {
      return renderTree()
    }

    return (
      <LoginScreen
        initialTab={loginTab}
        onGoToCreateAccount={() => setView('createAccount')}
        onJoinAnonymous={(joinKey) => {
          setPendingJoinKey(joinKey)
          setView('screenNamePrompt')
        }}
        onLoginSuccess={(result) => {
          window.api?.windowRestoreNormalSize()
          handleAccountReady(result)
        }}
        notice={loginNotice}
        onForgotPassword={() => setView('recover')}
      />
    )
  }

  // Real accounts get the server rail on the home screen and inside a server;
  // guests only ever see the one server they were let into.
  const showRail = !!sessionToken && !checkingSession && (view === 'home' || view === 'connected')

  // Opening Settings, Profile or Admin Tools from inside a server must not leave it:
  // the tree screen sends the presence check-ins, and unmounting it would send a leave
  // while voice (which lives outside React) carries on. So it stays mounted, hidden,
  // under the overlay. Going home or to another server still unmounts it.
  const OVERLAY_VIEWS = ['settings', 'profile', 'adminTools']
  const treeKept =
    !!currentServer &&
    !checkingSession &&
    (view === 'connected' || (OVERLAY_VIEWS.includes(view) && returnView === 'connected'))
  const overlayOpen = treeKept && view !== 'connected'

  // The page under an overlay is hidden once the overlay has fully covered it (so it is not drawn for nothing), and shown
  // again the moment the overlay starts to close, so it is there to be revealed.
  const [coveredByOverlay, setCoveredByOverlay] = useState(false)
  useEffect(() => {
    if (!overlayOpen) setCoveredByOverlay(false)
  }, [overlayOpen])

  const serverRail = (
    <ServerRail
      servers={servers}
      currentServerId={currentServer ? currentServer.id : null}
      onSelect={handleSelectServer}
      onHome={handleGoHome}
      onAdd={() => setShowServerDialog(true)}
    />
  )

  // What is on screen, and the key that says when it has become a different screen (a different key crossfades).
  let stage
  let stageKey
  if (treeKept) {
    stageKey = 'tree'
    const tree = sessionToken ? (
      <div className="rail-layout">
        {serverRail}
        <div className="rail-content">{renderTree()}</div>
      </div>
    ) : (
      renderTree()
    )
    stage = (
      <>
        <div style={{ display: coveredByOverlay ? 'none' : 'contents' }}>{tree}</div>
        <OverlayLayer show={overlayOpen} viewKey={view} onSettled={(open) => open && setCoveredByOverlay(true)}>
          {overlayOpen ? renderView() : null}
        </OverlayLayer>
      </>
    )
  } else if (showRail) {
    stageKey = 'rail'
    stage = (
      <div className="rail-layout">
        {serverRail}
        <div className="rail-content">
          <ViewTransition viewKey={view}>{renderView()}</ViewTransition>
        </div>
      </div>
    )
  } else {
    stageKey = view
    stage = renderView()
  }

  return (
    <div className={'app-shell' + (isMaximized ? ' maximized' : '')}>
      <LogoSprite />
      <TitleBar />
      <UpdateBanner />
      <div className="app-content">
        <ViewTransition viewKey={stageKey}>{stage}</ViewTransition>
        {showServerDialog && sessionToken && (
          <ServerDialog
            onCreate={handleCreateServer}
            onJoin={handleJoinServer}
            onClose={() => setShowServerDialog(false)}
          />
        )}
      </div>
    </div>
  )
}

export default App
