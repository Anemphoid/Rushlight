import { useState, useEffect } from 'react'
import AuthLayout, { useAuthLayout } from '../components/AuthLayout'
import * as api from '../api'

// Logging in and joining with a code. In the split layout both are on the page (join under "or join with a
// code"); in the card layout they are two of the three tabs (the third, Create account, is its own screen).
// The window is sized and shown the first time a sign-in screen is up, not again on every return to it.
let windowSized = false

function LoginScreen({ onGoToCreateAccount, onJoinAnonymous, onLoginSuccess, onForgotPassword, notice, initialTab = 'login' }) {
  const layout = useAuthLayout()
  const [tab, setTab] = useState(initialTab === 'join' ? 'join' : 'login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [loginError, setLoginError] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)

  const [joinKey, setJoinKey] = useState('')
  const [joinError, setJoinError] = useState('')

  // The window is shown (and sized to the normal working size) once this screen is up.
  useEffect(() => {
    if (windowSized) return
    windowSized = true
    window.api?.windowSetLoginSize?.(900, 670, true)
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
      const { token, username: confirmedName, id, avatarUpdatedAt, recoveryKeyAcked } = await api.login(username.trim(), password)
      if (rememberMe) {
        localStorage.setItem('rushlight-session', token)
      }
      onLoginSuccess({ screenName: confirmedName, sessionToken: token, id, avatarUpdatedAt, recoveryKeyAcked })
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

  function onTab(id) {
    if (id === 'create') onGoToCreateAccount()
    else setTab(id)
  }

  const split = layout === 'split'
  const showLogin = split || tab === 'login'
  const showJoin = split || tab === 'join'

  const loginForm = (
    <form onSubmit={handleLogin} className="auth-form">
      <div className="auth-field">
        <label htmlFor="auth-username">Username</label>
        <input id="auth-username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
      </div>
      <div className="auth-field">
        <label htmlFor="auth-password">Password</label>
        <input id="auth-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </div>
      <div className="auth-row">
        <label className="auth-check">
          <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
          Remember me on this device
        </label>
        <button type="button" className="auth-link" onClick={() => onForgotPassword()}>
          {split ? 'Forgot password?' : 'Use a recovery key'}
        </button>
      </div>
      <button type="submit" className="auth-primary" disabled={loggingIn}>
        {loggingIn ? 'Logging in…' : 'Log in'}
      </button>
      {loginError && <div className="auth-error">{loginError}</div>}
      {split && (
        <p className="auth-alt">
          New here?{' '}
          <button type="button" className="auth-link strong" onClick={() => onGoToCreateAccount()}>
            Create an account
          </button>
        </p>
      )}
    </form>
  )

  const joinForm = (
    <form onSubmit={handleAnonymousJoin} className="auth-form">
      <div className="auth-field">
        <label htmlFor="auth-join">Join key</label>
        <div className="auth-joinrow">
          <input id="auth-join" className="mono" value={joinKey} onChange={(e) => setJoinKey(e.target.value)} placeholder="word-word-1234" autoComplete="off" spellCheck={false} />
          <button type="submit" className="auth-secondary">
            Join
          </button>
        </div>
      </div>
      {joinError && <div className="auth-error">{joinError}</div>}
      <p className="auth-hint">No account needed. You pick a screen name next.</p>
    </form>
  )

  return (
    <AuthLayout heading="Log in" sub="Welcome back." tab={tab} onTab={onTab}>
      {notice && (
        <p className="auth-error auth-notice" role="alert">
          {notice}
        </p>
      )}
      {showLogin && loginForm}
      {split && <div className="auth-or">or join with a code</div>}
      {showJoin && joinForm}
    </AuthLayout>
  )
}

export default LoginScreen
