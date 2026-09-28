import { useState, useEffect } from 'react'
import '@livekit/components-styles'
import TitleBar from './components/TitleBar'
import ServerRail from './components/ServerRail'
import ServerDialog from './components/ServerDialog'
import LoginScreen from './screens/LoginScreen'
import CreateAccountScreen from './screens/CreateAccountScreen'
import ScreenNamePrompt from './screens/ScreenNamePrompt'
import UpdateBanner from './components/UpdateBanner'
import HomeScreen from './screens/HomeScreen'
import ChannelTreeScreen from './screens/ChannelTreeScreen'
import SettingsScreen from './screens/SettingsScreen'
import ProfileScreen from './screens/ProfileScreen'
import AdminToolsScreen from './screens/AdminToolsScreen'
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

  // sessionToken is set for real accounts. Guests who joined with a code have
  // none — they see one server's tree and hold a LiveKit token instead.
  const [sessionToken, setSessionToken] = useState(null)
  const [guestToken, setGuestToken] = useState(null) // guests only: lets them ask for voice in the server they joined
  const [voiceRetry, setVoiceRetry] = useState(0)

  // The servers this account belongs to, and the one currently open. The
  // structure itself lives in the backend database — this is just a cache.
  const [servers, setServers] = useState([])
  const [serversError, setServersError] = useState('')
  const [currentServer, setCurrentServer] = useState(null) // { id, name, isAdmin }
  const [channels, setChannels] = useState([])
  const [presence, setPresence] = useState({}) // 'room:3' / 'channel:1' -> who is in it
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const [openSpace, setOpenSpace] = useState(null)
  const [showServerDialog, setShowServerDialog] = useState(false)

  // Settings — density and icon size apply globally via data attributes,
  // so they take effect everywhere, not just while Settings is open.
  const [density, setDensity] = useState('cozy')
  const [iconSize, setIconSize] = useState('medium')
  const [pttKey, setPttKey] = useState(() => {
    try {
      return localStorage.getItem('rushlight-ptt-key') || 'ControlLeft'
    } catch {
      return 'ControlLeft'
    }
  })
  const [pttHookOk, setPttHookOk] = useState(true)
  const [skin, setSkin] = useState(() => localStorage.getItem('rushlight-skin') || 'parchment')
  const [mode, setMode] = useState(() => localStorage.getItem('rushlight-mode') || 'dark')
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    window.api?.windowIsMaximized().then(setIsMaximized)
    const unsubscribe = window.api?.onWindowMaximizedChange(setIsMaximized)
    return unsubscribe
  }, [])

  useEffect(() => {
    document.documentElement.dataset.density = density
  }, [density])

  useEffect(() => {
    document.documentElement.dataset.iconSize = iconSize
  }, [iconSize])

  useEffect(() => {
    document.documentElement.dataset.skin = skin
    localStorage.setItem('rushlight-skin', skin)
  }, [skin])

  useEffect(() => {
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
      .then(({ username }) => handleAccountReady({ screenName: username, sessionToken: saved }))
      .catch((err) => {
        if (err.status === 401) localStorage.removeItem('rushlight-session')
      })
      .finally(() => setCheckingSession(false))
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
    setCurrentServer({ id: data.id, name: data.name, isAdmin: data.isAdmin })
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
  useEffect(() => {
    if (!voiceKey || !voiceAuth) {
      voice.leave()
      return
    }
    let cancelled = false
    const [type, id] = voiceKey.split(':')
    ;(async () => {
      try {
        const { token, livekitUrl } = await api.getVoiceToken(voiceAuth, type, Number(id))
        if (cancelled) return
        await voice.join({ url: livekitUrl, token, key: voiceKey })
      } catch (err) {
        if (!cancelled) voice.fail(err.message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [voiceKey, voiceAuth, voiceRetry])

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
  async function handleAccountReady({ screenName: name, sessionToken: token }) {
    setScreenName(name)
    setAccountName(name)
    setSessionToken(token)
    setGuestToken(null)
    setCurrentServer(null)
    setChannels([])
    setPresence({})
    await refreshServers(token)
    setView('home')
  }

  // Guest join: one server's real tree, no account and no server list.
  function handleGuestJoined({ screenName: name, guestToken: token, server }) {
    setScreenName(name)
    setSessionToken(null)
    setGuestToken(token)
    setServers([])
    setCurrentServer({ id: server.id, name: server.name, isAdmin: false })
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

  function handleGoHome() {
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
    const joined = await api.joinServerWithCode(sessionToken, code)
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

  function resetToLogin() {
    if (openSpace) playSound('self-leave', 0.5)
    localStorage.removeItem('rushlight-session')
    setPendingJoinKey(null)
    setScreenName(null)
    setAccountName(null)
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

  function renderView() {
    if (checkingSession) {
      return (
        <div className="screen">
          <p className="settings-note">Checking for a saved session…</p>
        </div>
      )
    }

    if (view === 'createAccount') {
      return <CreateAccountScreen onBack={resetToLogin} onAccountCreated={handleAccountReady} />
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
          onBack={closeOverlay}
        />
      )
    }

    if (view === 'profile') {
      return (
        <ProfileScreen
          currentName={screenName}
          currentAvatarColor={avatarColor}
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
          onBack={closeOverlay}
        />
      )
    }

    if (view === 'home') {
      return (
        <HomeScreen
          screenName={screenName}
          hasServers={servers.length > 0}
          error={serversError}
          onRetry={() => refreshServers(sessionToken)}
          onAdd={() => setShowServerDialog(true)}
          onOpenSettings={() => openOverlay('settings')}
          onLogout={resetToLogin}
        />
      )
    }

    if (view === 'connected' && currentServer) {
      return (
        <ChannelTreeScreen
          key={currentServer.id}
          screenName={screenName}
          avatarColor={avatarColor}
          onLeave={sessionToken ? handleGoHome : resetToLogin}
          leaveLabel={sessionToken ? 'Back to home' : 'Leave'}
          onOpenSettings={() => openOverlay('settings')}
          onOpenProfile={() => openOverlay('profile')}
          onOpenAdminTools={() => openOverlay('adminTools')}
          serverId={currentServer.id}
          serverName={currentServer.name}
          onServerRenamed={handleServerRenamed}
          sessionToken={sessionToken}
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
          openSpace={openSpace}
          setOpenSpace={setOpenSpace}
        />
      )
    }

    return (
      <LoginScreen
        onGoToCreateAccount={() => {
          window.api?.windowRestoreNormalSize()
          setView('createAccount')
        }}
        onJoinAnonymous={(joinKey) => {
          window.api?.windowRestoreNormalSize()
          setPendingJoinKey(joinKey)
          setView('screenNamePrompt')
        }}
        onLoginSuccess={(result) => {
          window.api?.windowRestoreNormalSize()
          handleAccountReady(result)
        }}
      />
    )
  }

  // Real accounts get the server rail on the home screen and inside a server;
  // guests only ever see the one server they were let into.
  const showRail = !!sessionToken && !checkingSession && (view === 'home' || view === 'connected')

  return (
    <div className={'app-shell' + (isMaximized ? ' maximized' : '')}>
      <TitleBar />
      <UpdateBanner />
      <div className="app-content">
        {showRail ? (
          <div className="rail-layout">
            <ServerRail
              servers={servers}
              currentServerId={currentServer ? currentServer.id : null}
              onSelect={handleSelectServer}
              onHome={handleGoHome}
              onAdd={() => setShowServerDialog(true)}
            />
            <div className="rail-content">{renderView()}</div>
          </div>
        ) : (
          renderView()
        )}
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
