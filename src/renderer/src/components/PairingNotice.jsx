import { useState, useEffect } from 'react'

const clock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Shown on a computer that has not been approved yet. It holds no keys and is handed none until a computer of the same
// account that is already signed in approves it with this code.
function PairingNotice({ pairing, onNewCode }) {
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const expiresAt = pairing && pairing.expiresAt
  const code = pairing && pairing.code
  const live = !!code && !!expiresAt && expiresAt > now

  async function newCode() {
    setBusy(true)
    setError('')
    try {
      await onNewCode()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pairing-notice" role="status">
      <strong>This computer has not been approved yet.</strong>
      <p>
        For your privacy, a new computer is not given this server's keys until one of your other computers approves it. On a computer
        where you are already signed in, open Settings, then Account, then Add a computer, and type this code:
      </p>
      {live ? (
        <div className="pairing-code mono" aria-label="Pairing code">
          {code} <span className="pairing-left">({clock(expiresAt - now)} left)</span>
        </div>
      ) : (
        <p className="settings-note">{code ? 'That code has run out.' : 'No code is showing.'}</p>
      )}
      <button type="button" className="btn-secondary" disabled={busy} onClick={newCode}>
        {live ? 'Show a new code' : 'Show a code'}
      </button>
      {error && <div className="error-text">{error}</div>}
      <p className="settings-note">
        If you have no other computer signed in, your recovery key will bring the keys back. That is not in this version yet.
      </p>
    </div>
  )
}

export default PairingNotice
