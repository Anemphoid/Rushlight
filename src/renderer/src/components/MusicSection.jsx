import { useState, useEffect, useCallback } from 'react'
import * as api from '../api'

// Owner Tools: link the Jellyfin library Jellybox plays from. The server keeps only an access token
// (sealed), never sends it back, and shows other members nothing but whether music is set up.
function MusicSection({ serverId, sessionToken }) {
  const [info, setInfo] = useState(null) // null = loading, else { linked, address?, kind? }
  const [loadError, setLoadError] = useState('')
  const [address, setAddress] = useState('')
  const [how, setHow] = useState('key') // 'key' | 'user'
  const [apiKey, setApiKey] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState({ kind: '', text: '' }) // kind: 'ok' | 'error'
  const [confirmUnlink, setConfirmUnlink] = useState(false)

  const load = useCallback(async () => {
    try {
      setInfo(await api.getMusic(sessionToken, serverId))
      setLoadError('')
    } catch (err) {
      setLoadError(err.message)
    }
  }, [sessionToken, serverId])

  useEffect(() => {
    load()
  }, [load])

  async function link(e) {
    e.preventDefault()
    setBusy(true)
    setMessage({ kind: '', text: '' })
    try {
      const details = how === 'key' ? { address, apiKey } : { address, username, password }
      const out = await api.linkMusic(sessionToken, serverId, details)
      setInfo({ linked: true, address: out.address, kind: out.kind })
      setApiKey('')
      setPassword('')
      setMessage({ kind: 'ok', text: `Linked to ${out.name || 'Jellyfin'}. Jellybox is ready.` })
    } catch (err) {
      setMessage({ kind: 'error', text: err.message })
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setBusy(true)
    setMessage({ kind: '', text: '' })
    try {
      const out = await api.testMusic(sessionToken, serverId)
      setMessage({ kind: 'ok', text: `Connected to ${out.name || 'Jellyfin'}.` })
    } catch (err) {
      setMessage({ kind: 'error', text: err.message })
    } finally {
      setBusy(false)
    }
  }

  async function unlink() {
    setBusy(true)
    setMessage({ kind: '', text: '' })
    try {
      await api.unlinkMusic(sessionToken, serverId)
      setInfo({ linked: false })
      setConfirmUnlink(false)
      setMessage({ kind: 'ok', text: 'Unlinked. Jellybox has left any room it was in.' })
    } catch (err) {
      setMessage({ kind: 'error', text: err.message })
    } finally {
      setBusy(false)
    }
  }

  const canLink = address.trim() && (how === 'key' ? apiKey.trim() : username.trim() && password)

  return (
    <div className="settings-section">
      <h2>music</h2>
      <p className="settings-note">
        Link a Jellyfin library and Jellybox, the music bot, can play it in voice rooms when anyone types
        /play. Only you see this box. Jellybox streams songs straight from Jellyfin; nothing is downloaded
        or kept. Rushlight stores only an access token, sealed on the server, and never shows it to
        anyone. With nothing linked, music stays hidden everywhere.
      </p>
      {loadError && <p className="error-text">{loadError}</p>}
      {info === null && !loadError && <p className="settings-note">Loading…</p>}

      {info && info.linked && (
        <>
          <p className="settings-note">
            Linked to <strong>{info.address}</strong>
            {info.kind === 'user' ? ' (signed in with a username)' : ' (API key)'}.
          </p>
          <div className="create-form-actions" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="btn-secondary" disabled={busy} onClick={test}>
              Test
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirmUnlink(true)}>
              Unlink
            </button>
          </div>
          {confirmUnlink && (
            <div className="create-form">
              <p style={{ fontSize: 12, margin: '0 0 10px', color: 'var(--text)' }}>
                Unlink this library? Jellybox leaves every room it is in and music is hidden until you link again.
              </p>
              <div className="create-form-actions">
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirmUnlink(false)}>
                  Cancel
                </button>
                <button type="button" className="btn-primary btn-danger" disabled={busy} onClick={unlink}>
                  Unlink it
                </button>
              </div>
            </div>
          )}
          <p className="settings-note" style={{ marginTop: 14 }}>
            To point at a different library, link again below.
          </p>
        </>
      )}

      {info && (
        <form onSubmit={link}>
          <div className="field">
            <label>Jellyfin address</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="http://192.168.1.20:8096"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label>Sign in with</label>
            <select value={how} onChange={(e) => setHow(e.target.value)}>
              <option value="key">An API key</option>
              <option value="user">A Jellyfin username and password</option>
            </select>
          </div>
          {how === 'key' ? (
            <div className="field">
              <label>API key</label>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
            </div>
          ) : (
            <>
              <div className="field">
                <label>Jellyfin username</label>
                <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
              </div>
              <div className="field">
                <label>Jellyfin password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
              </div>
              <p className="settings-note">The password is used once to get an access token and is not kept.</p>
            </>
          )}
          <button type="submit" className="btn-secondary" disabled={busy || !canLink}>
            {info.linked ? 'Link again' : 'Link library'}
          </button>
        </form>
      )}
      {message.text && <p className={message.kind === 'error' ? 'error-text' : 'settings-note'}>{message.text}</p>}
    </div>
  )
}

export default MusicSection
