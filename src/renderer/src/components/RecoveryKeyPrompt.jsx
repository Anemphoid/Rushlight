import { useState } from 'react'
import * as api from '../api'
import RecoveryKeyScreen from './RecoveryKeyScreen'
import AuthLayout from './AuthLayout'

// The one-time prompt for an account that has no confirmed recovery key yet: every account
// made before keys existed, and any whose sign-up was closed before the key was saved. The
// password is asked for again before a key is made, so a stolen session can't mint one.
function RecoveryKeyPrompt({ sessionToken, onDone, onLogout }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState(null)

  async function start(e) {
    e.preventDefault()
    if (!password) return setError('Enter your password.')
    setError('')
    setBusy(true)
    try {
      const result = await api.createRecoveryKey(sessionToken, password)
      setRecoveryKey(result.recoveryKey)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (recoveryKey) {
    return (
      <RecoveryKeyScreen
        recoveryKey={recoveryKey}
        onConfirm={async () => {
          await api.ackRecoveryKey(sessionToken)
          onDone()
        }}
      />
    )
  }

  return (
    <AuthLayout
      heading="Save a recovery key"
      sub="Your account has no recovery key yet. It is the only way back in if you forget your password, because no one else, not the server admin and not the developer, can reset it for you. Enter your password to make one."
    >
      <form onSubmit={start} className="auth-form">
        <div className="auth-field">
          <label htmlFor="auth-key-password">Password</label>
          <input id="auth-key-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
        </div>
        <button type="submit" className="auth-primary" disabled={busy}>
          {busy ? 'Making…' : 'Make my recovery key'}
        </button>
        {error && <div className="auth-error">{error}</div>}
      </form>
      <p className="auth-alt">
        <button type="button" className="auth-link strong" onClick={() => onLogout()}>
          Log out
        </button>
      </p>
    </AuthLayout>
  )
}

export default RecoveryKeyPrompt
