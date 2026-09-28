import { useState } from 'react'
import * as api from '../api'

function CreateAccountScreen({ onBack, onAccountCreated }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

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
      const { token, username: confirmedName } = await api.register(username.trim(), password)
      onAccountCreated({ screenName: confirmedName, sessionToken: token })
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="screen">
      <div className="card">
        <h1>Create account</h1>
        <p className="sub">
          No recovery-phrase step yet — that's specific to the managed hosting
          tier, not needed for a self-hosted account like this one.
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
