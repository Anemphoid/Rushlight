import { useState } from 'react'
import * as api from '../api'
import { displayAddress } from '../../../shared/serverAddress'

// One field for the server's address, with Test and Save. Used on the sign-in screens (behind "Change") and in Settings >
// Connection. A typed scheme is taken as meant; with none, https is tried first and then http, and whichever answers is the
// one saved. If nothing answers, Save says so and offers to save anyway (the server may just be off). Saving reloads the app,
// so everything starts again from the new address: the saved sign-in is used again, voice reconnects.
function ServerAddressEditor({ current, onCancel, reload = () => window.location.reload() }) {
  const [text, setText] = useState(displayAddress(current))
  const [message, setMessage] = useState(null) // { kind: 'ok' | 'error', text }
  const [offer, setOffer] = useState(null) // an address nothing answered at, offered to save anyway
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function look() {
    setOffer(null)
    setMessage(null)
    setBusy(true)
    const found = await api.findServer(text)
    setBusy(false)
    if (found.error) setMessage({ kind: 'error', text: found.error })
    return found
  }

  async function test() {
    const found = await look()
    if (found.error) return
    if (found.ok) setMessage({ kind: 'ok', text: `A Rushlight server answers at ${displayAddress(found.url)}.` })
    else fail(found)
  }

  function fail(found) {
    setOffer(found.url)
    setMessage({
      kind: 'error',
      text:
        found.reason === 'not_rushlight'
          ? 'Something answered there, but it does not look like a Rushlight server.'
          : "Couldn't reach a Rushlight server there. Check the address, including the port (like :4000), and that the server is on."
    })
  }

  async function save(url) {
    setBusy(true)
    try {
      await api.changeServerAddress(url)
      setDone(true)
      setMessage({ kind: 'ok', text: `Saved ${displayAddress(url)}. Reloading…` })
      setTimeout(reload, 700)
    } catch (err) {
      setMessage({ kind: 'error', text: err.message })
    } finally {
      setBusy(false)
    }
  }

  async function submit(e) {
    e.preventDefault()
    const found = await look()
    if (found.error) return
    if (found.ok) return save(found.url)
    fail(found)
  }

  return (
    <form className="server-editor" onSubmit={submit}>
      <div className="auth-field">
        <label htmlFor="server-address">Server address</label>
        <input
          id="server-address"
          className="mono"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setOffer(null)
          }}
          placeholder="192.168.70.15:4000"
          autoFocus
          spellCheck={false}
          autoComplete="off"
          disabled={done}
        />
      </div>
      <div className="server-editor-help">Use this when the same server has a new address. Your keys stay on this computer.</div>
      {message && <div className={message.kind === 'ok' ? 'server-editor-ok' : 'error-text'}>{message.text}</div>}
      <div className="server-editor-actions">
        <button type="button" className="auth-link strong" disabled={busy || done || !text.trim()} onClick={test}>
          Test
        </button>
        <button type="submit" className="auth-primary" disabled={busy || done || !text.trim()}>
          {busy ? 'Checking…' : 'Save'}
        </button>
        {offer && !done && (
          <button type="button" className="auth-link" disabled={busy} onClick={() => save(offer)}>
            Save it anyway
          </button>
        )}
        {onCancel && !done && (
          <button type="button" className="auth-link" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

export default ServerAddressEditor
