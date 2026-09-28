import { useState } from 'react'
import * as api from '../api'

function ScreenNamePrompt({ joinKey, onBack, onConfirm }) {
  const [screenName, setScreenName] = useState('')
  const [error, setError] = useState('')
  const [joining, setJoining] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!screenName.trim()) {
      setError('Enter a screen name for this server.')
      return
    }
    setError('')
    setJoining(true)
    try {
      const {
        guestToken,
        screenName: confirmedName,
        server
      } = await api.joinWithCode(joinKey, screenName.trim())
      onConfirm({ screenName: confirmedName, guestToken, server })
    } catch (err) {
      setError(err.message)
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="screen">
      <div className="card">
        <h1>Almost there</h1>
        <p className="sub">
          Joining with key <strong style={{ color: 'var(--text)' }}>{joinKey}</strong> —
          pick a name for this server.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Screen name</label>
            <input
              value={screenName}
              onChange={(e) => setScreenName(e.target.value)}
              autoFocus
            />
          </div>
          <button type="submit" className="btn-primary" disabled={joining}>
            {joining ? 'Joining…' : 'Continue'}
          </button>
          {error && <div className="error-text">{error}</div>}
        </form>

        <button type="button" className="link-btn" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  )
}

export default ScreenNamePrompt
