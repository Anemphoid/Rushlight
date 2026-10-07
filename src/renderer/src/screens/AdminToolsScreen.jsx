import { useState, useEffect, useCallback } from 'react'
import * as api from '../api'
import Avatar from '../components/Avatar'
import { avatarUrl } from '../api'
import JoinCodesSection from '../components/JoinCodesSection'
import { formatExpiry, formatAge } from '../time'
import { spaceNameFor } from '../spaces'

const TIMED_ACCESS_OPTIONS = [
  { label: '1 hour', minutes: 60 },
  { label: '24 hours', minutes: 1440 },
  { label: '7 days', minutes: 10080 },
  { label: 'No limit', minutes: null }
]

function AdminToolsScreen({ serverId, serverName, sessionToken, accountId, onBack }) {
  const [members, setMembers] = useState(null) // null = still loading
  const [membersError, setMembersError] = useState('')
  const [busyId, setBusyId] = useState(null) // one row's action in flight at a time
  const [rowError, setRowError] = useState({ id: null, message: '' })
  const [confirmBan, setConfirmBan] = useState(null) // { accountId, username } or null
  const [expiryMenuFor, setExpiryMenuFor] = useState(null)

  const [guests, setGuests] = useState(null) // null = still loading
  const [guestsError, setGuestsError] = useState('')
  const [channels, setChannels] = useState([]) // just to put names to the spaces guests are in
  const [confirmRemoveGuest, setConfirmRemoveGuest] = useState(null) // a row from guests, or null
  const [removingGuest, setRemovingGuest] = useState(false)
  const [removeGuestError, setRemoveGuestError] = useState('')

  const loadGuests = useCallback(async () => {
    try {
      const result = await api.listServerGuests(sessionToken, serverId)
      setGuests(result.guests)
      setGuestsError('')
    } catch (err) {
      setGuestsError(err.message)
    }
  }, [sessionToken, serverId])

  useEffect(() => {
    loadGuests()
    const timer = setInterval(loadGuests, 5000) // guests come and go without anyone acting here
    return () => clearInterval(timer)
  }, [loadGuests])

  useEffect(() => {
    api
      .getServer(sessionToken, serverId)
      .then((s) => setChannels(s.channels || []))
      .catch(() => {})
  }, [sessionToken, serverId])

  async function removeGuest(g) {
    setRemovingGuest(true)
    setRemoveGuestError('')
    try {
      await api.removeServerGuest(sessionToken, serverId, g.identity)
      setConfirmRemoveGuest(null)
      await loadGuests()
    } catch (err) {
      // already gone is the same outcome the admin wanted
      if (err.status === 404) {
        setConfirmRemoveGuest(null)
        await loadGuests()
      } else {
        setRemoveGuestError(err.message)
      }
    } finally {
      setRemovingGuest(false)
    }
  }

  const loadMembers = useCallback(async () => {
    try {
      const result = await api.getMembers(sessionToken, serverId)
      setMembers(result.members)
      setMembersError('')
    } catch (err) {
      setMembersError(err.message)
    }
  }, [sessionToken, serverId])

  useEffect(() => {
    loadMembers()
    const timer = setInterval(loadMembers, 5000) // catches a scheduled expiry firing, another admin acting, etc.
    return () => clearInterval(timer)
  }, [loadMembers])

  async function runRowAction(targetId, fn) {
    setBusyId(targetId)
    setRowError({ id: null, message: '' })
    try {
      await fn()
      await loadMembers()
    } catch (err) {
      setRowError({ id: targetId, message: err.message })
    } finally {
      setBusyId(null)
      setExpiryMenuFor(null)
    }
  }

  return (
    <div className="screen">
      <div className="card" style={{ maxWidth: 440 }}>
        <h1>Admin Tools</h1>
        <p className="sub">{serverName}</p>

        <JoinCodesSection serverId={serverId} serverName={serverName} sessionToken={sessionToken} />

        <div className="settings-section">
          <h2>members</h2>
          {membersError && <p className="error-text">{membersError}</p>}
          {members === null && !membersError && <p className="settings-note">Loading…</p>}
          {members && members.length === 0 && <p className="settings-note">No one else here yet.</p>}
          {members && members.length > 0 && (
            <div className="member-list">
              {members.map((m) => {
                const isSelf = m.accountId === accountId
                const busy = busyId === m.accountId
                return (
                  <div className="member-row" key={m.accountId}>
                    <Avatar name={m.username} imageUrl={avatarUrl(m.accountId, m.avatarUpdatedAt)} size={28} />
                    <div className="member-row-main">
                      <div className="member-row-name">
                        {m.username}
                        {m.isAdmin && <span className="member-badge">admin</span>}
                        {m.muted && <span className="member-badge muted">muted</span>}
                      </div>
                      {m.accessExpiresAt && (
                        <div className="member-row-expiry">{formatExpiry(m.accessExpiresAt)}</div>
                      )}
                      {rowError.id === m.accountId && <div className="error-text">{rowError.message}</div>}
                    </div>
                    {!isSelf && (
                      <div className="member-row-actions">
                        <button
                          type="button"
                          className="link-btn"
                          disabled={busy}
                          onClick={() =>
                            runRowAction(m.accountId, () =>
                              api.patchMember(sessionToken, serverId, m.accountId, { muted: !m.muted })
                            )
                          }
                        >
                          {m.muted ? 'Unmute' : 'Mute'}
                        </button>
                        <div className="member-row-expiry-picker">
                          <button
                            type="button"
                            className="link-btn"
                            disabled={busy}
                            onClick={() => setExpiryMenuFor(expiryMenuFor === m.accountId ? null : m.accountId)}
                          >
                            Timed access
                          </button>
                          {expiryMenuFor === m.accountId && (
                            <div className="member-expiry-menu">
                              {TIMED_ACCESS_OPTIONS.map((o) => (
                                <button
                                  type="button"
                                  key={o.label}
                                  onClick={() =>
                                    runRowAction(m.accountId, () =>
                                      api.patchMember(sessionToken, serverId, m.accountId, {
                                        accessExpiresInMinutes: o.minutes
                                      })
                                    )
                                  }
                                >
                                  {o.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          className="link-btn"
                          disabled={busy}
                          onClick={() => runRowAction(m.accountId, () => api.kickMember(sessionToken, serverId, m.accountId))}
                        >
                          Kick
                        </button>
                        <button
                          type="button"
                          className="link-btn danger"
                          disabled={busy}
                          onClick={() => setConfirmBan({ accountId: m.accountId, username: m.username })}
                        >
                          Ban
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <h2 style={{ marginTop: 18 }}>guests here now</h2>
          {guestsError && <p className="error-text">{guestsError}</p>}
          {guests === null && !guestsError && <p className="settings-note">Loading…</p>}
          {guests && guests.length === 0 && <p className="settings-note">No guests here right now.</p>}
          {guests && guests.length > 0 && (
            <div className="member-list">
              {guests.map((g) => {
                const where = spaceNameFor(channels, g.space)
                return (
                  <div key={g.identity}>
                  <div className="member-row">
                    <Avatar name={g.name} size={28} />
                    <div className="member-row-main">
                      <div className="member-row-name">
                        {g.name}
                        <span className="member-badge">guest</span>
                      </div>
                      <div className="member-row-expiry">
                        {where ? `in ${where}` : 'not in a room yet'} · joined {formatAge(g.joinedAt)}
                        {g.code ? ` · code ${g.code}` : ''}
                      </div>
                    </div>
                    <div className="member-row-actions">
                      <button
                        type="button"
                        className="link-btn danger"
                        onClick={() => {
                          setRemoveGuestError('')
                          setConfirmRemoveGuest((cur) => (cur && cur.identity === g.identity ? null : g))
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  {confirmRemoveGuest && confirmRemoveGuest.identity === g.identity && (
                    <div className="create-form">
                      <p style={{ fontSize: 12, margin: '0 0 10px', color: 'var(--text)' }}>
                        Remove <strong>{g.name}</strong>? They are dropped from voice now and can't come
                        back with the invite they hold. Their code stays valid, so a reusable one can
                        still bring them in again under a new name; revoke the code to stop that.
                      </p>
                      {removeGuestError && <div className="error-text">{removeGuestError}</div>}
                      <div className="create-form-actions">
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={removingGuest}
                          onClick={() => setConfirmRemoveGuest(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn-primary"
                          style={{ background: 'var(--danger)' }}
                          disabled={removingGuest}
                          onClick={() => removeGuest(g)}
                        >
                          {removingGuest ? 'Removing…' : 'Remove'}
                        </button>
                      </div>
                    </div>
                  )}
                  </div>
                )
              })}
            </div>
          )}
          <p className="settings-note">
            Guests have no account, so they can't be kicked or banned. Remove one here, or revoke the code
            they came in with (under active codes above) to remove everyone who used it.
          </p>
        </div>

        {confirmBan && (
          <div className="poll-backdrop">
            <div className="poll-card">
              <h2>Ban {confirmBan.username}?</h2>
              <p className="settings-note">
                Removes them now and blocks them from rejoining with any code, until
                someone unbans them.
              </p>
              <div className="create-form-actions">
                <button type="button" className="btn-secondary" onClick={() => setConfirmBan(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    const target = confirmBan
                    setConfirmBan(null)
                    runRowAction(target.accountId, () => api.banMember(sessionToken, serverId, target.accountId))
                  }}
                >
                  Ban
                </button>
              </div>
            </div>
          </div>
        )}

        <button type="button" className="btn-secondary" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  )
}

export default AdminToolsScreen
