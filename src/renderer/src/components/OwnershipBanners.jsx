import { useState } from 'react'
import * as api from '../api'
import { spanLabel } from '../time'

const keyFor = (serverId, id) => `rushlight-notice-seen:${serverId}:${id}`
const dismissed = (serverId, id) => {
  try {
    return localStorage.getItem(keyFor(serverId, id)) === '1'
  } catch {
    return false
  }
}

// Across the top of a server: a claim to become its owner (everyone sees it), and notices that the owner changed. Admins
// other than the owner vote on a claim here; the person who started it can withdraw it. The owner never sees a claim:
// opening the app is what ends it.
function OwnershipBanners({ ownership, serverId, sessionToken, accountId, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [, rerender] = useState(0)
  const claim = ownership && ownership.succession
  const notices = ((ownership && ownership.notices) || []).filter((n) => !dismissed(serverId, n.id))
  if (!claim && notices.length === 0) return null

  async function run(fn) {
    setBusy(true)
    setError('')
    try {
      await fn()
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  function dismiss(id) {
    try {
      localStorage.setItem(keyFor(serverId, id), '1')
    } catch {
      // stays for this session
    }
    rerender((n) => n + 1)
  }

  return (
    <div className="device-notices" role="status">
      {claim && (
        <div className="device-notice own">
          <span className="device-notice-text">
            <strong>{claim.claimantName}</strong> has started a claim to become the owner of this server, because the owner has not been seen for a long time.
            It ends in {spanLabel(claim.msLeft)}, and then a majority of the other admins decides ({claim.yes} yes, {claim.no} no so far, {claim.needed} needed).
            If you are the owner, opening Rushlight is enough to cancel it.
            {claim.canVote && claim.myVote && <> You voted {claim.myVote}.</>}
          </span>
          {claim.canVote && (
            <>
              <button type="button" className="link-btn" disabled={busy || claim.myVote === 'yes'} onClick={() => run(() => api.voteSuccession(sessionToken, serverId, 'yes'))}>
                Vote yes
              </button>
              <button type="button" className="link-btn" disabled={busy || claim.myVote === 'no'} onClick={() => run(() => api.voteSuccession(sessionToken, serverId, 'no'))}>
                Vote no
              </button>
            </>
          )}
          {claim.claimantId === accountId && (
            <button type="button" className="link-btn" disabled={busy} onClick={() => run(() => api.withdrawSuccession(sessionToken, serverId))}>
              Withdraw
            </button>
          )}
        </div>
      )}
      {notices.map((n) => (
        <div key={n.id} className="device-notice">
          <span className="device-notice-text">{n.text}</span>
          <button type="button" className="link-btn" onClick={() => dismiss(n.id)}>
            Dismiss
          </button>
        </div>
      ))}
      {error && <div className="error-text">{error}</div>}
    </div>
  )
}

export default OwnershipBanners
