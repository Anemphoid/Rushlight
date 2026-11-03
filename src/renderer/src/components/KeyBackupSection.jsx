import { useEffect, useState } from 'react'
import * as e2eeSession from '../e2eeSession'

const when = (ts) => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

// Settings > Account: whether the keys that open your encrypted messages are backed up, and how to make the backup. The backup
// is sealed on this computer with a key made from your 12 recovery words, so the server holds something it cannot open. It
// is the way back if every computer you are signed in on is lost. Giving this computer the words once lets it keep the
// backup up to date by itself; the words themselves are not kept.
function KeyBackupSection({ sessionToken, accountId }) {
  const [status, setStatus] = useState(null)
  const [open, setOpen] = useState(false)
  const [words, setWords] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  async function load() {
    try {
      const s = await e2eeSession.keyringStatus({ token: sessionToken, accountId })
      const hasDevice = (await e2eeSession.thisDeviceId(accountId)) != null
      setStatus({ ...s, show: s.exists || hasDevice })
    } catch (err) {
      setError(err.message)
    }
  }
  useEffect(() => {
    load()
  }, [sessionToken, accountId])

  async function make(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setDone('')
    try {
      await e2eeSession.createKeyringBackup({ token: sessionToken, accountId, words })
      setWords('')
      setOpen(false)
      setDone('Your keys are backed up.')
      await load()
    } catch (err) {
      setError(err.reason === 'bad_recovery_key' ? "That isn't your recovery key. Check the words and try again." : err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!status || !status.show) return error ? <div className="error-text">{error}</div> : null
  return (
    <section className="settings-block">
      <h3 className="rl-subsection-title">Key backup</h3>
      {status.exists ? (
        <p className="settings-note">
          <strong>Backed up</strong>, last updated {when(status.updatedAt)}.{' '}
          {status.keptHere
            ? 'This computer keeps it up to date by itself.'
            : 'This computer cannot update it yet: enter your recovery key once to let it.'}
        </p>
      ) : (
        <p className="settings-note">
          <strong>Not backed up.</strong> If you lose every computer you are signed in on, your encrypted messages cannot be brought
          back. Enter your recovery key to make the backup.
        </p>
      )}
      {!open ? (
        <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
          {status.exists ? (status.keptHere ? 'Make a new backup' : 'Let this computer update it') : 'Back up my keys'}
        </button>
      ) : (
        <form onSubmit={make}>
          <div className="field">
            <label htmlFor="backup-words">Your 12 word recovery key</label>
            <textarea id="backup-words" rows={2} value={words} onChange={(e) => setWords(e.target.value)} autoComplete="off" spellCheck={false} autoFocus />
          </div>
          <button type="submit" className="btn-primary" disabled={busy || !words.trim()}>
            {busy ? 'Backing up…' : 'Back up'}
          </button>{' '}
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setOpen(false); setWords('') }}>
            Cancel
          </button>
          <p className="settings-note">The words are checked by the server once and never stored. Only a sealed copy of your keys is kept there.</p>
        </form>
      )}
      {done && <p className="settings-note">{done}</p>}
      {error && <div className="error-text">{error}</div>}
    </section>
  )
}

export default KeyBackupSection
