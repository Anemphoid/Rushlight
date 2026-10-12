import { useState } from 'react'
import * as api from '../api'

// Settings: change the password, and make a new recovery key. Both need the current
// password. A password change ends every other session of the account; this one carries
// on with the token the server sends back.
function AccountSecuritySection({ sessionToken, onSessionChanged, onKeyIssued, onAccountDeleted, onOpenOwnerTools }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pwError, setPwError] = useState('')
  const [pwDone, setPwDone] = useState(false)
  const [pwBusy, setPwBusy] = useState(false)

  const [keyPassword, setKeyPassword] = useState('')
  const [keyError, setKeyError] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)

  // Deleting the account: password, then a plain last question. An owner is told which servers to
  // hand over or delete first, with a way to get to each.
  const [delPassword, setDelPassword] = useState('')
  const [delConfirm, setDelConfirm] = useState(false)
  const [delBusy, setDelBusy] = useState(false)
  const [delError, setDelError] = useState('')
  const [ownedServers, setOwnedServers] = useState([])

  async function deleteAccount() {
    setDelBusy(true)
    setDelError('')
    setOwnedServers([])
    try {
      await api.deleteAccount(sessionToken, delPassword)
      onAccountDeleted()
    } catch (err) {
      setDelConfirm(false)
      setDelError(err.message)
      if (err.reason === 'owns_servers' && err.servers) setOwnedServers(err.servers)
      setDelBusy(false)
    }
  }

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

      <div className="settings-section">
        <h2>delete account</h2>
        <p className="settings-note">
          This is permanent and happens at once. You leave every server, your recovery key stops
          existing, and your username becomes free for anyone to take. Your messages stay where they
          are so conversations still read in order, but their text and your name are erased from the
          server for good, and they show as REDACTED. No one can bring any of it back: not a server
          admin and not the developer.
        </p>
        <div className="field">
          <label>Your password</label>
          <input
            type="password"
            value={delPassword}
            onChange={(e) => {
              setDelPassword(e.target.value)
              setDelConfirm(false)
            }}
            autoComplete="current-password"
          />
        </div>
        <button
          type="button"
          className="btn-secondary"
          disabled={!delPassword || delBusy}
          onClick={() => {
            setDelError('')
            setOwnedServers([])
            setDelConfirm(true)
          }}
        >
          Delete my account
        </button>
        {delConfirm && (
          <div className="create-form">
            <p style={{ fontSize: 12, margin: '0 0 10px', color: 'var(--text)' }}>
              Delete your account for good? This can't be undone.
            </p>
            <div className="create-form-actions">
              <button type="button" className="btn-secondary" disabled={delBusy} onClick={() => setDelConfirm(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ background: 'var(--danger)' }}
                disabled={delBusy}
                onClick={deleteAccount}
              >
                {delBusy ? 'Deleting…' : 'Delete it for good'}
              </button>
            </div>
          </div>
        )}
        {delError && <div className="error-text">{delError}</div>}
        {ownedServers.length > 0 && (
          <div className="member-list" style={{ marginTop: 8 }}>
            {ownedServers.map((s) => (
              <div className="member-row" key={s.id}>
                <div className="member-row-main">
                  <div className="member-row-name">{s.name}</div>
                  <div className="member-row-expiry">You own this server</div>
                </div>
                <div className="member-row-actions">
                  <button type="button" className="link-btn" onClick={() => onOpenOwnerTools(s.id)}>
                    Hand over or delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

export default AccountSecuritySection
