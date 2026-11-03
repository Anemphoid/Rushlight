import { useState, useEffect } from 'react'

const clock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Shown on a computer that has not been approved yet. It holds no keys and is handed none until a computer of the same
// account that is already signed in approves it with this code.
function PairingNotice({ pairing, onNewCode, onRecover }) {
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [useKey, setUseKey] = useState(false)
  const [words, setWords] = useState('')
  const [recovering, setRecovering] = useState(false)
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

  async function recover(e) {
    e.preventDefault()
    setRecovering(true)
    setError('')
    try {
      await onRecover(words)
    } catch (err) {
      setError(err.reason === 'bad_proof' ? "That recovery key doesn't match, or no backup of the keys was ever made for this account." : err.message)
    } finally {
      setRecovering(false)
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
      {!useKey ? (
        <p className="settings-note">
          No other computer signed in?{' '}
          <button type="button" className="link-btn" onClick={() => setUseKey(true)}>
            Use your recovery key instead
          </button>
        </p>
      ) : (
        <form onSubmit={recover} className="pairing-recover">
          <label htmlFor="pair-words">Your 12 word recovery key</label>
          <textarea id="pair-words" rows={2} value={words} onChange={(e) => setWords(e.target.value)} autoComplete="off" spellCheck={false} />
          <button type="submit" className="btn-primary" disabled={recovering || !words.trim()}>
            {recovering ? 'Checking…' : 'Use this recovery key'}
          </button>{' '}
          <button type="button" className="btn-secondary" disabled={recovering} onClick={() => setUseKey(false)}>
            Cancel
          </button>
          <p className="settings-note">The key itself is not sent anywhere: only proof that you know it. It brings your keys back from your backup.</p>
        </form>
      )}
    </div>
  )
}

export default PairingNotice
