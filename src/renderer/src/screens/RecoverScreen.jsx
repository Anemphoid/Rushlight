import { useState } from 'react'
import * as api from '../api'
import RecoveryKeyScreen from '../components/RecoveryKeyScreen'

// Forgot password: username, the recovery key and a new password. Using the key spends it,
// so the server hands back the next one, which has to be saved before going on.
function RecoverScreen({ onBack, onRecovered }) {
  const [username, setUsername] = useState('')
  const [key, setKey] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (!username.trim() || !key.trim()) return setError('Enter your username and your recovery key.')
    if (password.length < 8) return setError('The new password needs to be at least 8 characters.')
    if (password !== confirmPassword) return setError("The passwords don't match.")
    setError('')
    setBusy(true)
    try {
      setResult(await api.recoverAccount(username.trim(), key, password))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <RecoveryKeyScreen
        title="Save your new recovery key"
        recoveryKey={result.recoveryKey}
        onConfirm={async () => {
          await api.ackRecoveryKey(result.token)
          onRecovered({
            screenName: result.username,
            sessionToken: result.token,
            id: result.id,
            avatarUpdatedAt: result.avatarUpdatedAt,
            recoveryKeyAcked: true
          })
        }}
      />
    )
  }

  return (
    <div className="screen">
      <div className="card">
        <h1>Reset your password</h1>
        <p className="sub">
          Enter your username, the 12 word recovery key you saved when you made the account, and a
          new password. If you lost the key as well, the account can't be recovered.
        </p>
        <form onSubmit={submit}>
          <div className="field">
            <label>Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label>Recovery key</label>
            <textarea
              value={key}
              onChange={(e) => setKey(e.target.value)}
              rows={3}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="twelve words, in any case, with spaces or dashes"
              style={{ width: '100%', resize: 'none' }}
            />
          </div>
          <div className="field">
            <label>New password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </div>
          <div className="field">
            <label>Confirm new password</label>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
          </div>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Resetting…' : 'Reset password'}
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

export default RecoverScreen
