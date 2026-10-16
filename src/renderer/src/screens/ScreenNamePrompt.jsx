import { useState } from 'react'
import * as api from '../api'
import * as e2eeSession from '../e2eeSession'
import { splitFullCode, openCodePackage } from '../e2ee/crypto'
import AuthLayout from '../components/AuthLayout'

function ScreenNamePrompt({ joinKey, onBack, onConfirm }) {
  const [screenName, setScreenName] = useState('')
  const [error, setError] = useState('')
  const [joining, setJoining] = useState(false)
  // An invite to an encrypted server is the code, a dot, and a secret half; only the code goes to the server.
  const { code, secret } = splitFullCode(joinKey)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!screenName.trim()) {
      setError('Enter a screen name for this server.')
      return
    }
    setError('')
    setJoining(true)
    try {
      // Look at the code first, without using it: an invite to an encrypted server only works with its whole code, and a
      // single-use one must not be spent by a guest who left off, or mistyped, the second half.
      const look = await api.checkCode(code)
      if (look.e2ee && look.e2ee.enabled) {
        if (!look.e2ee.package) {
          setError('That invite was made before this server was encrypted. Ask for a new one.')
          return
        }
        if (!secret) {
          setError('This server is end-to-end encrypted. Use the whole invite, including the part after the dot.')
          return
        }
        // The secret half has to open the keys it came with; a typo is found out here, before anything is used up.
        const opens = await openCodePackage(secret, look.serverId, look.e2ee.package).then(
          () => true,
          () => false
        )
        if (!opens) {
          setError("The second half of that invite isn't right. Check it and try again.")
          return
        }
      }
      const {
        guestToken,
        screenName: confirmedName,
        server
      } = await api.joinWithCode(code, screenName.trim())
      if (server.e2ee && server.e2ee.enabled) {
        // This server's calls are encrypted, and the invite's keys open only with its secret half.
        const problem = !secret
          ? 'This server is end-to-end encrypted. Use the whole invite, including the part after the dot.'
          : await e2eeSession.setGuestInvite({ serverId: server.id, secret, packageText: server.e2ee.package }).then(
              () => null,
              () => "The second half of that invite isn't right. Check it and try again."
            )
        if (problem) {
          api.leavePresence(guestToken).catch(() => {})
          setError(problem)
          return
        }
      }
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
          Joining with key <strong style={{ color: 'var(--text)' }}>{code}</strong> — pick a name for this server.
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
