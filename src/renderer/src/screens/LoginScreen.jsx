import { useState, useRef, useEffect } from 'react'
import RushlightLogo from '../components/RushlightLogo'
import * as api from '../api'

const TITLE_BAR_HEIGHT = 32

function LoginScreen({ onGoToCreateAccount, onJoinAnonymous, onLoginSuccess }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [loginError, setLoginError] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)

  const [joinKey, setJoinKey] = useState('')
  const [joinError, setJoinError] = useState('')

  const cardRef = useRef(null)

  // .screen stretches to fill whatever window height it's given (height:
  // 100%), so measuring it directly would just report the window's current
  // size back. The card itself has a natural size — measure that instead,
  // then add back .screen's own 32px padding and the title bar height.
  useEffect(() => {
    const el = cardRef.current
    if (!el || !window.api?.windowSetLoginSize) return

    const SCREEN_PADDING = 32

    const observer = new ResizeObserver(() => {
      const width = el.offsetWidth + SCREEN_PADDING * 2
      const height = el.offsetHeight + SCREEN_PADDING * 2 + TITLE_BAR_HEIGHT
      window.api.windowSetLoginSize(width, height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    if (!username.trim() || !password) {
      setLoginError('Enter both a username and password.')
      return
    }
    setLoginError('')
    setLoggingIn(true)
    try {
      const { token, username: confirmedName, id, avatarUpdatedAt } = await api.login(username.trim(), password)
      if (rememberMe) {
        localStorage.setItem('rushlight-session', token)
      }
      onLoginSuccess({ screenName: confirmedName, sessionToken: token, id, avatarUpdatedAt })
    } catch (err) {
      setLoginError(err.message)
    } finally {
      setLoggingIn(false)
    }
  }

  function handleAnonymousJoin(e) {
    e.preventDefault()
    if (!joinKey.trim()) {
      setJoinError('Enter a join key.')
      return
    }
    setJoinError('')
    onJoinAnonymous(joinKey.trim())
  }

  return (
    <div className="screen">
      <div className="card" ref={cardRef}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <RushlightLogo />
        </div>
        <h1>Rushlight</h1>
        <p className="sub">Log in to your account, or join anonymously below.</p>

        <form onSubmit={handleLogin}>
          <div className="field">
            <label>Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="checkbox-row">
            <input
              type="checkbox"
              id="rememberMe"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            <label htmlFor="rememberMe" style={{ marginBottom: 0 }}>
              Remember me on this device
            </label>
          </div>
          <button type="submit" className="btn-primary" disabled={loggingIn}>
            {loggingIn ? 'Logging in…' : 'Log In'}
          </button>
          {loginError && <div className="error-text">{loginError}</div>}
        </form>

        <button
          type="button"
          className="link-btn"
          onClick={onGoToCreateAccount}
        >
          Don't have an account? Create one
        </button>

        <div className="divider">or</div>

        <form onSubmit={handleAnonymousJoin}>
          <div className="field">
            <label>Anonymous join key</label>
            <input
              value={joinKey}
              onChange={(e) => setJoinKey(e.target.value)}
              placeholder="e.g. amber-lantern-fox"
            />
          </div>
          <button type="submit" className="btn-secondary">
            Join
          </button>
          {joinError && <div className="error-text">{joinError}</div>}
        </form>
      </div>
    </div>
  )
}

export default LoginScreen
