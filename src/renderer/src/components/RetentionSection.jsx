import { useState, useEffect } from 'react'
import * as api from '../api'
import { RETENTION_CHOICES, retentionLabel } from '../retention'

// Owner Tools: how long persistent chat is kept. A shorter window deletes older messages for good at the next
// daily cleanup, so the owner is told how many that is and has to confirm before it is saved.
function RetentionSection({ serverId, sessionToken }) {
  const [current, setCurrent] = useState(null) // months now, null while loading
  const [choice, setChoice] = useState(12)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [confirm, setConfirm] = useState(null) // { months, count } waiting for a yes

  useEffect(() => {
    let cancelled = false
    api
      .getServer(sessionToken, serverId)
      .then((s) => {
        if (cancelled) return
        setCurrent(s.retentionMonths || 12)
        setChoice(s.retentionMonths || 12)
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [sessionToken, serverId])

  async function commit(months) {
    setBusy(true)
    setError('')
    try {
      const out = await api.setRetention(sessionToken, serverId, months)
      setCurrent(out.retentionMonths)
      setConfirm(null)
      setSaved(
        out.willDeleteAtNextCleanup > 0
          ? `Saved. ${out.willDeleteAtNextCleanup} message${out.willDeleteAtNextCleanup === 1 ? '' : 's'} older than ${retentionLabel(months)} will be deleted at the next daily cleanup.`
          : `Saved. Persistent history is kept for ${retentionLabel(months)}.`
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function save(e) {
    e.preventDefault()
    setSaved('')
    setError('')
    if (choice === current) return
    setBusy(true)
    try {
      // Ask first how many messages this would remove; nothing is changed yet.
      const preview = await api.setRetention(sessionToken, serverId, choice, { dryRun: true })
      if (preview.willDeleteAtNextCleanup > 0) setConfirm({ months: choice, count: preview.willDeleteAtNextCleanup })
      else await commit(choice)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-section">
      <h2>history</h2>
      <p className="settings-note">
        Persistent rooms and channels keep their chat for a while, then the oldest messages are deleted for good,
        along with anything attached to them. This applies to this whole server. Ephemeral rooms are not affected.
      </p>
      {current === null && !error && <p className="settings-note">Loading…</p>}
      {current !== null && (
        <form onSubmit={save}>
          <div className="field">
            <label>Keep persistent history for</label>
            <select value={choice} onChange={(e) => { setChoice(Number(e.target.value)); setConfirm(null); setSaved('') }}>
              {RETENTION_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {retentionLabel(m)}
                  {m === 12 ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn-secondary" disabled={busy || choice === current}>
            Save
          </button>
        </form>
      )}
      {confirm && (
        <div className="create-form">
          <p style={{ fontSize: 12, margin: '0 0 10px', color: 'var(--text)' }}>
            Keeping {retentionLabel(confirm.months)} will permanently delete {confirm.count} message{confirm.count === 1 ? '' : 's'} at
            the next daily cleanup. This cannot be undone.
          </p>
          <div className="create-form-actions">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setConfirm(null); setChoice(current) }}>
              Cancel
            </button>
            <button type="button" className="btn-primary" style={{ background: 'var(--danger)' }} disabled={busy} onClick={() => commit(confirm.months)}>
              Delete them, keep {retentionLabel(confirm.months)}
            </button>
          </div>
        </div>
      )}
      {saved && <p className="settings-note">{saved}</p>}
      {error && <p className="error-text">{error}</p>}
    </div>
  )
}

export default RetentionSection
