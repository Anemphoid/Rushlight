import { useEffect, useState } from 'react'
import * as e2eeSession from '../e2eeSession'

const at = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

// Settings > Account: approve a new computer of this account. The new computer shows a code; it is typed here, the app says
// which computer asked and when, and the password is asked for again before anything is handed over. Shown only where
// this computer is itself approved.
function AddComputerSection({ sessionToken, accountId }) {
  const [ready, setReady] = useState(false) // this computer is approved and uses encryption
  const [code, setCode] = useState('')
  const [found, setFound] = useState(null) // { approvalId, device: { label, createdAt } }
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Never make a device just to look: a computer that has never used an encrypted server has nothing to approve with.
      if ((await e2eeSession.thisDeviceId(accountId)) == null) return
      const s = await e2eeSession.deviceStatus({ token: sessionToken, accountId }).catch(() => null)
      if (!cancelled && s && s.approved) setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [sessionToken, accountId])

  async function look(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setDone('')
    try {
      setFound(await e2eeSession.beginApproval({ token: sessionToken, accountId, code }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  async function approve(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await e2eeSession.confirmApproval({ token: sessionToken, accountId, approvalId: found.approvalId, password })
      setDone(`"${found.device.label}" is approved. It gets its keys within a few seconds.`)
      setFound(null)
      setCode('')
      setPassword('')
    } catch (err) {
      setError(err.message)
      if (err.reason === 'approval_expired' || err.reason === 'too_many_attempts' || err.reason === 'bad_proof') setFound(null)
    } finally {
      setBusy(false)
    }
  }

  if (!ready) return null
  return (
    <section className="settings-block">
      <h3 className="rl-subsection-title">Add a computer</h3>
      <p className="settings-note">
        Signing in on a new computer is not enough to read your encrypted servers. Open Rushlight there, find the code it shows, and type it here.
      </p>
      {!found ? (
        <form onSubmit={look}>
          <div className="field">
            <label htmlFor="pair-code">Code from the new computer</label>
            <input id="pair-code" className="mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-EFGH" autoComplete="off" spellCheck={false} />
          </div>
          <button type="submit" className="btn-secondary" disabled={busy || !code.trim()}>
            Look it up
          </button>
        </form>
      ) : (
        <form onSubmit={approve}>
          <p className="settings-note">
            <strong>{found.device.label}</strong> asked to join your account at {at(found.device.createdAt)}. Is that you?
          </p>
          <div className="field">
            <label htmlFor="pair-password">Your password</label>
            <input id="pair-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
          </div>
          <button type="submit" className="btn-primary" disabled={busy || !password}>
            Approve this computer
          </button>{' '}
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setFound(null); setPassword('') }}>
            Cancel
          </button>
        </form>
      )}
      {done && <p className="settings-note">{done}</p>}
      {error && <div className="error-text">{error}</div>}
    </section>
  )
}

export default AddComputerSection
