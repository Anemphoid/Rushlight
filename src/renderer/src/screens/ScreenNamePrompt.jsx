import { useState } from 'react'
import * as api from '../api'
import AuthLayout from '../components/AuthLayout'

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
    <AuthLayout
      heading="Almost there"
      sub={
        <>
          Joining with key <strong style={{ color: 'var(--text)' }}>{joinKey}</strong> — pick a name for this server.
        </>
      }
    >
      <form onSubmit={handleSubmit} className="auth-form">
        <div className="auth-field">
          <label htmlFor="auth-screen-name">Screen name</label>
          <input id="auth-screen-name" value={screenName} onChange={(e) => setScreenName(e.target.value)} autoFocus />
        </div>
        <button type="submit" className="auth-primary" disabled={joining}>
          {joining ? 'Joining…' : 'Continue'}
        </button>
        {error && <div className="auth-error">{error}</div>}
      </form>
      <p className="auth-alt">
        <button type="button" className="auth-link strong" onClick={() => onBack()}>
          Back
        </button>
      </p>
    </AuthLayout>
  )
}

export default ScreenNamePrompt
