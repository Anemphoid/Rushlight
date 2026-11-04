import { useEffect, useState } from 'react'
import * as api from '../api'
import { spanLabel, formatAge } from '../time'

// Admin Tools, for an admin who is not the owner: is the owner gone, and if so, start a claim or vote on one. It explains the
// rules in the same words every time, because it is the one place a server changes hands without its owner.
function SuccessionSection({ serverId, sessionToken, accountId }) {
  const [info, setInfo] = useState(null) // the server screen's ownership view
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try {
      const s = await api.getServer(sessionToken, serverId)
      setInfo({ succession: s.succession || null, ownerStatus: s.ownerStatus || null })
    } catch (err) {
      setError(err.message)
    }
  }
  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [sessionToken, serverId])

  async function run(fn) {
    setBusy(true)
    setError('')
    try {
      await fn()
      setPassword('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!info) return error ? <div className="error-text">{error}</div> : <p className="settings-note">Loading…</p>
  const { succession: claim, ownerStatus: owner } = info
  if (!owner) return <p className="settings-note">Only admins who are not the owner see this.</p>
  return (
    <div className="settings-section">
      <p className="settings-note">
        If an owner disappears, the server must not be lost. After <strong>{spanLabel(owner.dormantAfterMs)}</strong> with no sign of {owner.ownerName}, any
        admin can start a claim. Everyone sees a notice for <strong>{spanLabel(owner.noticeMs)}</strong>. If {owner.ownerName} opens Rushlight in that time,
        the claim is cancelled by itself. If not, a majority of the other admins decides. The old owner stays an admin.
      </p>
      <p className="settings-note">
        {owner.ownerName} was last seen <strong>{formatAge(owner.lastSeenAt) || 'just now'}</strong>.
      </p>

      {claim ? (
        <div className="create-form">
          <p style={{ fontSize: 12, margin: '0 0 10px', color: 'var(--text)' }}>
            <strong>{claim.claimantName}</strong> has a claim open. It ends in {spanLabel(claim.msLeft)}. {claim.yes} yes, {claim.no} no, {claim.needed} of{' '}
            {claim.eligible} admin{claim.eligible === 1 ? '' : 's'} needed.
            {claim.myVote && <> You voted {claim.myVote}.</>}
          </p>
          <div className="create-form-actions">
            <button type="button" className="btn-secondary" disabled={busy || claim.myVote === 'no'} onClick={() => run(() => api.voteSuccession(sessionToken, serverId, 'no'))}>
              Vote no
            </button>
            <button type="button" className="btn-primary" disabled={busy || claim.myVote === 'yes'} onClick={() => run(() => api.voteSuccession(sessionToken, serverId, 'yes'))}>
              Vote yes
            </button>
            {claim.claimantId === accountId && (
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => run(() => api.withdrawSuccession(sessionToken, serverId))}>
                Withdraw my claim
              </button>
            )}
          </div>
        </div>
      ) : owner.dormant ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            run(() => api.startSuccessionClaim(sessionToken, serverId, password))
          }}
        >
          <div className="field">
            <label htmlFor="claim-password">Your password</label>
            <input id="claim-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          <button type="submit" className="btn-primary" disabled={busy || !password}>
            Start a claim to become the owner
          </button>
        </form>
      ) : (
        <p className="settings-note">A claim can be started once {owner.ownerName} has not been seen for {spanLabel(owner.dormantAfterMs)}.</p>
      )}
      {error && <div className="error-text">{error}</div>}
    </div>
  )
}

export default SuccessionSection
