import { useState } from 'react'
import * as api from '../api'
import RecoveryKeyScreen from '../components/RecoveryKeyScreen'
import AuthLayout from '../components/AuthLayout'

function CreateAccountScreen({ onBack, onAccountCreated }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(null) // the new account, held until its recovery key is saved

  async function handleSubmit(e) {
    e.preventDefault()
    if (username.trim().length < 3) {
      setError('Username needs to be at least 3 characters.')
      return
    }
    if (password.length < 8) {
      setError('Password needs to be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.")
      return
    }
    setError('')
    setCreating(true)
    try {
      setCreated(await api.register(username.trim(), password))
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  // The account exists as soon as the server answers, but the person doesn't get into the app
  // until they have saved the recovery key. If they close the window first, the next login
  // asks for a key again, so no account is left without a way to recover it.
  if (created) {
    return (
      <RecoveryKeyScreen
        recoveryKey={created.recoveryKey}
        onConfirm={async () => {
          await api.ackRecoveryKey(created.token)
          onAccountCreated({
            screenName: created.username,
            sessionToken: created.token,
            id: created.id,
            avatarUpdatedAt: created.avatarUpdatedAt,
            recoveryKeyAcked: true
          })
        }}
      />
    )
  }

  return (
    <AuthLayout
      heading="Create account"
      sub="After you create it you will be given a 12 word recovery key. It is the only way back in if you forget your password, so you'll be asked to save it."
      tab="create"
      onTab={(id) => id !== 'create' && onBack(id)}
    >
      <form onSubmit={handleSubmit} className="auth-form">
        <div className="auth-field">
          <label htmlFor="auth-new-username">Username</label>
          <input id="auth-new-username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
        </div>
        <div className="auth-field">
          <label htmlFor="auth-new-password">Password</label>
          <input id="auth-new-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </div>
        <div className="auth-field">
          <label htmlFor="auth-new-confirm">Confirm password</label>
          <input id="auth-new-confirm" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
        </div>
        <button type="submit" className="auth-primary" disabled={creating}>
          {creating ? 'Creating…' : 'Create account'}
        </button>
        {error && <div className="auth-error">{error}</div>}
      </form>
      <p className="auth-alt">
        <button type="button" className="auth-link strong" onClick={() => onBack('login')}>
          Back to login
        </button>
      </p>
    </AuthLayout>
  )
}

export default CreateAccountScreen
