import { useState } from 'react'
import * as api from '../api'

// Settings: change the password, and make a new recovery key. Both need the current
// password. A password change ends every other session of the account; this one carries
// on with the token the server sends back.
function AccountSecuritySection({ sessionToken, onSessionChanged, onKeyIssued }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pwError, setPwError] = useState('')
  const [pwDone, setPwDone] = useState(false)
  const [pwBusy, setPwBusy] = useState(false)

  const [keyPassword, setKeyPassword] = useState('')
  const [keyError, setKeyError] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)

  async function changePassword(e) {
    e.preventDefault()
    setPwDone(false)
    if (!current) return setPwError('Enter your current password.')
    if (next.length < 8) return setPwError('The new password needs to be at least 8 characters.')
    if (next !== confirm) return setPwError("The new passwords don't match.")
    setPwError('')
    setPwBusy(true)
    try {
      const result = await api.changePassword(sessionToken, current, next)
      onSessionChanged(result.token)
      setCurrent('')
      setNext('')
      setConfirm('')
      setPwDone(true)
    } catch (err) {
      setPwError(err.message)
    } finally {
      setPwBusy(false)
    }
  }

  async function makeKey(e) {
    e.preventDefault()
    if (!keyPassword) return setKeyError('Enter your password.')
    setKeyError('')
    setKeyBusy(true)
    try {
      const { recoveryKey } = await api.createRecoveryKey(sessionToken, keyPassword)
      setKeyPassword('')
      onKeyIssued(recoveryKey)
    } catch (err) {
      setKeyError(err.message)
    } finally {
      setKeyBusy(false)
    }
  }

  return (
    <>
      <div className="settings-section">
        <h2>change password</h2>
        <form onSubmit={changePassword}>
          <div className="field">
            <label>Current password</label>
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="field">
            <label>New password</label>
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </div>
          <div className="field">
            <label>Confirm new password</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </div>
          <button type="submit" className="btn-secondary" disabled={pwBusy}>
            {pwBusy ? 'Changing…' : 'Change password'}
          </button>
          {pwError && <div className="error-text">{pwError}</div>}
          {pwDone && <p className="settings-note">Password changed. Your other sessions were signed out.</p>}
        </form>
      </div>

      <div className="settings-section">
        <h2>recovery key</h2>
        <p className="settings-note">
          Make a new key if you lost the old one or think someone saw it. The old key keeps working
          until you confirm the new one, and stops the moment you do.
        </p>
        <form onSubmit={makeKey}>
          <div className="field">
            <label>Your password</label>
            <input type="password" value={keyPassword} onChange={(e) => setKeyPassword(e.target.value)} autoComplete="current-password" />
          </div>
          <button type="submit" className="btn-secondary" disabled={keyBusy}>
            {keyBusy ? 'Making…' : 'Make a new recovery key'}
          </button>
          {keyError && <div className="error-text">{keyError}</div>}
        </form>
      </div>
    </>
  )
}

export default AccountSecuritySection
