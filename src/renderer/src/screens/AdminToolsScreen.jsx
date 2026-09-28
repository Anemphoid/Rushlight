import { useState } from 'react'
import * as api from '../api'

const EXPIRY_OPTIONS = [
  { label: '1 hour', minutes: 60 },
  { label: '24 hours', minutes: 1440 },
  { label: '7 days', minutes: 10080 },
  { label: 'No expiry', minutes: null }
]

function AdminToolsScreen({ serverId, serverName, sessionToken, onBack }) {
  const [timeoutMinutes, setTimeoutMinutes] = useState(10)

  const [singleUse, setSingleUse] = useState(true)
  const [expiryMinutes, setExpiryMinutes] = useState(1440)
  const [code, setCode] = useState(null)
  const [codeError, setCodeError] = useState('')
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  async function generate() {
    setCodeError('')
    setCopied(false)
    setGenerating(true)
    try {
      const result = await api.createServerCode(sessionToken, serverId, {
        singleUse,
        expiresInMinutes: expiryMinutes
      })
      setCode(result.code)
    } catch (err) {
      setCodeError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked — the code is on screen to copy by hand
    }
  }

  return (
    <div className="screen">
      <div className="card" style={{ maxWidth: 440 }}>
        <h1>Admin Tools</h1>
        <p className="sub">{serverName}</p>

        <div className="settings-section">
          <h2>invite someone</h2>
          <div className="tier-row" style={{ marginBottom: 8 }}>
            {[
              { label: 'Single use', value: true },
              { label: 'Reusable', value: false }
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                className={'tier-chip' + (singleUse === o.value ? ' active' : '')}
                onClick={() => setSingleUse(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="tier-row" style={{ marginBottom: 10 }}>
            {EXPIRY_OPTIONS.map((o) => (
              <button
                key={o.label}
                type="button"
                className={'tier-chip' + (expiryMinutes === o.minutes ? ' active' : '')}
                onClick={() => setExpiryMinutes(o.minutes)}
              >
                {o.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn-primary" disabled={generating} onClick={generate}>
            {generating ? 'Generating…' : 'Generate join code'}
          </button>
          {codeError && <div className="error-text">{codeError}</div>}
          {code && (
            <>
              <div className="code-box">
                <code>{code}</code>
                <button type="button" className="btn-secondary" onClick={copy}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="settings-note">
                With an account: paste it under the + on the home screen to join{' '}
                {serverName}. Without one: enter it in the login screen's join box to
                come in as a guest.
              </p>
            </>
          )}
        </div>

        <div className="settings-section">
          <h2>connected people</h2>
          <p className="settings-note">
            No live presence yet — that arrives with the LiveKit room connection. Once
            it does, this list fills in live, with kick/mute/ban/timeout buttons next
            to each person, and right-clicking a name will offer vote-to-kick and a
            personal volume slider.
          </p>
        </div>

        <div className="settings-section">
          <h2>default mute timeout</h2>
          <div className="tier-row">
            {[5, 10, 30, 60].map((mins) => (
              <button
                key={mins}
                type="button"
                className={'tier-chip' + (timeoutMinutes === mins ? ' active' : '')}
                onClick={() => setTimeoutMinutes(mins)}
              >
                {mins}m
              </button>
            ))}
          </div>
          <p className="settings-note">
            Applied when an admin mutes someone with the timer option, rather than
            indefinitely. Not saved to the server yet.
          </p>
        </div>

        <button type="button" className="btn-secondary" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  )
}

export default AdminToolsScreen
