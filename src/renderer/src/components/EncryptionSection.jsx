import { useState, useEffect } from 'react'
import * as api from '../api'
import * as e2eeSession from '../e2eeSession'
import { useClosing } from './ViewTransition'

const COUNTDOWN = 20

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// The wipe is deliberate: a countdown before the button works, and a Confirm for an owner who has read it and
// does not want to wait. The password is asked for as well, so a stolen session cannot do this.
function EnableDialog({ preview, onDone, onClose: leave, onSubmit }) {
  const [closing, onClose] = useClosing(leave)
  const anything = preview.plainMessages > 0
  const [seconds, setSeconds] = useState(anything ? COUNTDOWN : 0)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (seconds <= 0) return undefined
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [seconds])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  async function go(e) {
    e.preventDefault()
    if (seconds > 0 || !password) return
    setBusy(true)
    setError('')
    try {
      await onSubmit(password)
      onDone()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className={'poll-backdrop rl-backdrop' + (closing ? ' closing' : '')}>
      <form className="rl-dialog" role="dialog" aria-modal="true" aria-labelledby="enc-title" onSubmit={go}>
        <div className="rl-dialog-head">
          <h2 id="enc-title">Switch on end-to-end encryption</h2>
        </div>
        <div className="rl-dialog-section">
          <p className="settings-note">
            {anything ? (
              <>
                Everything said here so far is stored as plain text on the server. To switch on encryption it is{' '}
                <strong>deleted for good</strong>: {plural(preview.plainMessages, 'message', 'messages')}
                {preview.plainPictures > 0 ? ` and ${plural(preview.plainPictures, 'picture', 'pictures')}` : ''}, in every channel and room. The
                server starts again with an empty history. There is no way to get them back.
              </>
            ) : (
              'There is nothing said here yet, so nothing is lost.'
            )}
          </p>
          <ul className="settings-note">
            <li>It cannot be switched off again.</li>
            <li>
              Members get their keys by themselves the first time they open Rushlight after this, as long as it is up to date. Anyone on
              an older version cannot use this server until they update.
            </li>
            <li>Jellybox stops, and stays off in every room until an admin allows it.</li>
            <li>From then on only the members can read what is said: not the server, and not whoever runs it.</li>
          </ul>
          <label htmlFor="enc-password">Your password</label>
          <input id="enc-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
        </div>
        {error && <div className="rl-dialog-error">{error}</div>}
        <div className="rl-dialog-foot">
          <button type="button" className="rl-dialog-cancel" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          {seconds > 0 && (
            <button type="button" className="rl-dialog-secondary" disabled={busy} onClick={() => setSeconds(0)}>
              Confirm
            </button>
          )}
          <button type="submit" className="rl-dialog-primary btn-danger" disabled={busy || seconds > 0 || !password}>
            {seconds > 0 ? `${anything ? 'Wipe and switch on' : 'Switch on'} (${seconds})` : anything ? 'Wipe and switch on' : 'Switch on'}
          </button>
        </div>
      </form>
    </div>
  )
}

// Owner Tools: end-to-end encryption for this server.
function EncryptionSection({ serverId, sessionToken, accountId, onEnabled }) {
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState('')

  useEffect(() => {
    let cancelled = false
    api
      .getEncryptionPreview(sessionToken, serverId)
      .then((p) => !cancelled && setPreview(p))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [sessionToken, serverId, done])

  async function submit(password) {
    await e2eeSession.ensureThisDevice(sessionToken, accountId)
    const out = await api.enableEncryption(sessionToken, serverId, { password, wipe: preview.plainMessages > 0 })
    setDone(
      out.wiped.messages > 0
        ? `Encryption is on. ${plural(out.wiped.messages, 'old message', 'old messages')} were wiped.`
        : 'Encryption is on.'
    )
    await onEnabled()
  }

  return (
    <div className="settings-section">
      <h2>encryption</h2>
      <p className="settings-note">
        End-to-end encryption means chat, pictures and voice are scrambled on each member's computer, and only the members of this server can
        unscramble them. The server, and whoever runs it, only ever holds scrambled data.
      </p>
      {!preview && !error && <p className="settings-note">Loading…</p>}
      {preview && preview.enabled && (
        <p className="settings-note">
          <strong>Encryption is on for this server.</strong> It cannot be switched off.
        </p>
      )}
      {preview && !preview.enabled && (
        <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
          Switch on encryption…
        </button>
      )}
      {done && <p className="settings-note">{done}</p>}
      {error && <p className="error-text">{error}</p>}
      {open && preview && <EnableDialog preview={preview} onSubmit={submit} onDone={() => setOpen(false)} onClose={() => setOpen(false)} />}
    </div>
  )
}

export default EncryptionSection
