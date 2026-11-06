import { useState, useEffect } from 'react'
import * as api from '../api'
import { normalizeServerAddress, displayAddress } from '../../../shared/serverAddress'

// "Server 192.168.68.70:4000 · Change" on every sign-in screen. The server's address moves sometimes (a new IP after a router
// change), and an app that cannot reach it has no other way to be told. The address is checked before it is saved; if nothing
// answers there it says so, and the person can still save it (the server may just be off). The encryption keys stay with this
// computer when the address changes, so the same server at a new address does not see a new computer.
function ServerAddress() {
  const [current, setCurrent] = useState('')
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [unreachable, setUnreachable] = useState(null) // an address nothing answered at, offered to save anyway
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    try {
      window.api?.getServerConfig?.().then((c) => setCurrent(c && c.serverUrl ? c.serverUrl : ''))
    } catch {
      // no window API (tests)
    }
  }, [])

  function open() {
    setText(displayAddress(current))
    setError('')
    setUnreachable(null)
    setSaved(false)
    setEditing(true)
  }

  async function save(url) {
    setBusy(true)
    try {
      setCurrent(await api.changeServerAddress(url))
      setEditing(false)
      setUnreachable(null)
      setSaved(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function submit(e) {
    e.preventDefault()
    const checked = normalizeServerAddress(text)
    if (checked.error) {
      setUnreachable(null)
      return setError(checked.error)
    }
    setError('')
    if (checked.url === current) return setEditing(false)
    setBusy(true)
    const found = await api.checkServerAddress(checked.url)
    setBusy(false)
    if (found.ok) return save(checked.url)
    setUnreachable(checked.url)
    setError(
      found.reason === 'not_rushlight'
        ? 'Something answered there, but it does not look like a Rushlight server.'
        : "Couldn't reach a Rushlight server there. Check the address, including the port (like :4000), and that the server is on."
    )
  }

  if (!current) return null

  if (!editing) {
    return (
      <div className="auth-server">
        Server <span>{displayAddress(current)}</span>{' '}
        <button type="button" className="auth-link" onClick={open}>
          Change
        </button>
        {saved && <div className="auth-server-note">Saved. Log in again to use the new address.</div>}
      </div>
    )
  }

  return (
    <form className="auth-server auth-server-form" onSubmit={submit}>
      <div className="auth-field">
        <label htmlFor="auth-server-address">Server address</label>
        <input
          id="auth-server-address"
          className="mono"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="192.168.68.70:4000"
          autoFocus
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      <div className="auth-server-help">
        Use this when the same server has a new address. Your keys stay on this computer.
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="auth-server-actions">
        <button type="submit" className="auth-primary" disabled={busy}>
          {busy ? 'Checking…' : 'Save'}
        </button>
        {unreachable && (
          <button type="button" className="auth-link" disabled={busy} onClick={() => save(unreachable)}>
            Save it anyway
          </button>
        )}
        <button type="button" className="auth-link" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </form>
  )
}

export default ServerAddress
