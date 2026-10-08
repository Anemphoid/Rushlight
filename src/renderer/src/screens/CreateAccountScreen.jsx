import { useState } from 'react'
import * as api from '../api'
import RecoveryKeyScreen from '../components/RecoveryKeyScreen'

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
    <div className="screen">
      <div className="card">
        <h1>Create account</h1>
        <p className="sub">
          After you create it you will be given a 12 word recovery key. It is the only way back in
          if you forget your password, so you'll be asked to save it.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Confirm password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={creating}>
            {creating ? 'Creating…' : 'Create account'}
          </button>
          {error && <div className="error-text">{error}</div>}
        </form>

        <button type="button" className="link-btn" onClick={onBack}>
          Back to login
        </button>
      </div>
    </div>
  )
}

export default CreateAccountScreen
