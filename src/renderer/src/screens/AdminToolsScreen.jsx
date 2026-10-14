import { useState, useEffect, useCallback } from 'react'
import * as api from '../api'
import Avatar from '../components/Avatar'
import { avatarUrl } from '../api'
import JoinCodesSection from '../components/JoinCodesSection'
import MusicSection from '../components/MusicSection'
import RetentionSection from '../components/RetentionSection'
import { formatExpiry, formatAge } from '../time'
import { spaceNameFor } from '../spaces'
import PageShell from '../components/PageShell'

const TIMED_ACCESS_OPTIONS = [
  { label: '1 hour', minutes: 60 },
  { label: '24 hours', minutes: 1440 },
  { label: '7 days', minutes: 10080 },
  { label: 'No limit', minutes: null }
]

function AdminToolsScreen({ serverId, serverName, sessionToken, accountId, onServerDeleted, onBack }) {
  const [section, setSection] = useState('members')
  const [members, setMembers] = useState(null) // null = still loading
  const [membersError, setMembersError] = useState('')
  const [busyId, setBusyId] = useState(null) // one row's action in flight at a time
  const [rowError, setRowError] = useState({ id: null, message: '' })
  const [confirmBan, setConfirmBan] = useState(null) // { accountId, username } or null
  const [expiryMenuFor, setExpiryMenuFor] = useState(null)

  const [bans, setBans] = useState(null) // null = still loading
  const [bansError, setBansError] = useState('')
  const [confirmUnban, setConfirmUnban] = useState(null) // a row from bans, or null
  const [unbanning, setUnbanning] = useState(false)
  const [unbanError, setUnbanError] = useState('')

  // Owner-only: make or remove an admin (no password, but a confirmation), hand the server on, or delete it.
  const [confirmRole, setConfirmRole] = useState(null) // { accountId, username, makeAdmin } or null
  const [roleBusy, setRoleBusy] = useState(false)
  const [roleError, setRoleError] = useState('')
  const [transferTo, setTransferTo] = useState('') // accountId as a string, '' = nobody picked
  const [transferPassword, setTransferPassword] = useState('')
  const [confirmTransfer, setConfirmTransfer] = useState(false)
  const [transferBusy, setTransferBusy] = useState(false)
  const [transferError, setTransferError] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const [guests, setGuests] = useState(null) // null = still loading
  const [guestsError, setGuestsError] = useState('')
  const [channels, setChannels] = useState([]) // just to put names to the spaces guests are in
  const [confirmRemoveGuest, setConfirmRemoveGuest] = useState(null) // a row from guests, or null
  const [removingGuest, setRemovingGuest] = useState(false)
  const [removeGuestError, setRemoveGuestError] = useState('')

  useEffect(() => {
    if (!confirmBan) return undefined
    const onKey = (e) => e.key === 'Escape' && setConfirmBan(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmBan])

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

  const loadBans = useCallback(async () => {
    try {
      const result = await api.getBans(sessionToken, serverId)
      setBans(result.bans)
      setBansError('')
    } catch (err) {
      setBansError(err.message)
    }
  }, [sessionToken, serverId])

  useEffect(() => {
    loadBans()
    const timer = setInterval(loadBans, 5000) // another admin may ban or unban
    return () => clearInterval(timer)
  }, [loadBans])

  async function unban(row) {
    setUnbanning(true)
    setUnbanError('')
    try {
      await api.unbanMember(sessionToken, serverId, row.accountId)
      setConfirmUnban(null)
      await loadBans()
    } catch (err) {
      // someone else already unbanned them: same outcome
      if (err.status === 404) {
        setConfirmUnban(null)
        await loadBans()
      } else {
        setUnbanError(err.message)
      }
    } finally {
      setUnbanning(false)
    }
  }

  async function changeRole() {
    if (!confirmRole) return
    setRoleBusy(true)
    setRoleError('')
    try {
      await api.setMemberAdmin(sessionToken, serverId, confirmRole.accountId, confirmRole.makeAdmin)
      setConfirmRole(null)
      await loadMembers()
    } catch (err) {
      setRoleError(err.message)
    } finally {
      setRoleBusy(false)
    }
  }

  async function handOver() {
    const target = members && members.find((m) => String(m.accountId) === transferTo)
    if (!target) return
    setTransferBusy(true)
    setTransferError('')
    try {
      await api.transferServer(sessionToken, serverId, target.accountId, transferPassword)
      setConfirmTransfer(false)
      setTransferTo('')
      setTransferPassword('')
      await loadMembers() // the owner badge moves, and this person's owner-only sections go
    } catch (err) {
      setTransferError(err.message)
    } finally {
      setTransferBusy(false)
    }
  }

  async function removeServer() {
    setDeleteBusy(true)
    setDeleteError('')
    try {
      await api.deleteServer(sessionToken, serverId, deletePassword)
      onServerDeleted(serverName)
    } catch (err) {
      setDeleteError(err.message)
      setDeleteBusy(false)
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
      await Promise.all([loadMembers(), loadBans()]) // a ban moves someone from one list to the other
    } catch (err) {
      setRowError({ id: targetId, message: err.message })
    } finally {
      setBusyId(null)
      setExpiryMenuFor(null)
    }
  }

  // Whether this person owns the server comes from the members list, which refreshes every
  // few seconds, so the owner-only sections follow a handover without anyone reopening the screen.
  const isOwner = !!(members && members.some((m) => m.accountId === accountId && m.isOwner))
  const others = (members || []).filter((m) => m.accountId !== accountId)
  const transferTarget = members && members.find((m) => String(m.accountId) === transferTo)

  const sections = [
    { id: 'members', label: 'Members', icon: 'account' },
    { id: 'guests', label: 'Guests', icon: 'account' },
    { id: 'codes', label: 'Join codes', icon: 'keys' },
    { id: 'banned', label: 'Banned', icon: 'close' },
    ...(isOwner
      ? [
          { id: 'music', label: 'Music', icon: 'music' },
          { id: 'history', label: 'History', icon: 'info' },
          { id: 'ownership', label: 'Ownership', icon: 'shield' }
        ]
      : [])
  ]
  // an owner-only section stays open only while the person is still the owner (a handover can end that)
  const shown = sections.some((x) => x.id === section) ? section : 'members'

  return (
    <PageShell
      title={(isOwner ? 'Owner tools' : 'Admin tools') + ' · ' + serverName}
      onBack={onBack}
      sections={sections}
      activeSection={shown}
      onSelectSection={setSection}
      escDisabled={!!confirmBan}
    >
      {shown === 'members' && (
        <>
          <h2 className="rl-section-title">Members</h2>
          <p className="rl-section-sub">Everyone with an account on {serverName}.</p>
          <div className="settings-section">
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
                        {m.isOwner && <span className="member-badge">owner</span>}
                        {m.isAdmin && !m.isOwner && <span className="member-badge">admin</span>}
                        {m.muted && <span className="member-badge muted">muted</span>}
                      </div>
                      {m.accessExpiresAt && (
                        <div className="member-row-expiry">{formatExpiry(m.accessExpiresAt)}</div>
                      )}
                      {rowError.id === m.accountId && <div className="error-text">{rowError.message}</div>}
                      {confirmRole && confirmRole.accountId === m.accountId && (
                        <div className="create-form">
                          <p style={{ fontSize: 12, margin: '0 0 10px', color: 'var(--text)' }}>
                            {confirmRole.makeAdmin ? (
                              <>
                                Make <strong>{m.username}</strong> an admin? They can make join codes, mute, kick and
                                ban members, remove guests and edit channels. They can't delete the server or hand it
                                over. You can take it back with Remove admin.
                              </>
                            ) : (
                              <>
                                Remove <strong>{m.username}</strong> as an admin? They stay a member and lose the
                                admin tools straight away.
                              </>
                            )}
                          </p>
                          {roleError && <div className="error-text">{roleError}</div>}
                          <div className="create-form-actions">
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={roleBusy}
                              onClick={() => setConfirmRole(null)}
                            >
                              Cancel
                            </button>
                            <button type="button" className="btn-primary" disabled={roleBusy} onClick={changeRole}>
                              {roleBusy ? 'Saving…' : confirmRole.makeAdmin ? 'Make admin' : 'Remove admin'}
                            </button>
                          </div>
                        </div>
                      )}
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
                        {isOwner && !m.isOwner && (
                          <button
                            type="button"
                            className="link-btn"
                            disabled={busy}
                            onClick={() => {
                              setRoleError('')
                              setConfirmRole({ accountId: m.accountId, username: m.username, makeAdmin: !m.isAdmin })
                            }}
                          >
                            {m.isAdmin ? 'Remove admin' : 'Make admin'}
                          </button>
                        )}
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

          </div>
        </>
      )}

      {shown === 'guests' && (
        <>
          <h2 className="rl-section-title">Guests here now</h2>
          <p className="rl-section-sub">People who came in with a join code and no account.</p>
          <div className="settings-section">
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
                          className="btn-primary btn-danger"
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
        </>
      )}

      {shown === 'codes' && (
        <>
          <h2 className="rl-section-title">Join codes</h2>
          <p className="rl-section-sub">Invite people to {serverName}.</p>
          <JoinCodesSection serverId={serverId} serverName={serverName} sessionToken={sessionToken} />
        </>
      )}

      {shown === 'banned' && (
        <>
          <h2 className="rl-section-title">Banned</h2>
          <p className="rl-section-sub">People blocked from rejoining until someone unbans them.</p>
          <div className="settings-section">
          {bansError && <p className="error-text">{bansError}</p>}
          {bans === null && !bansError && <p className="settings-note">Loading…</p>}
          {bans && bans.length === 0 && <p className="settings-note">No one is banned.</p>}
          {bans && bans.length > 0 && (
            <div className="member-list">
              {bans.map((b) => (
                <div key={b.accountId}>
                  <div className="member-row">
                    <Avatar name={b.username} imageUrl={avatarUrl(b.accountId, null)} size={28} />
                    <div className="member-row-main">
                      <div className="member-row-name">
                        {b.username}
                        <span className="member-badge muted">banned</span>
                      </div>
                      <div className="member-row-expiry">
                        {formatAge(b.bannedAt)}
                        {b.reason ? ` · ${b.reason}` : ''}
                      </div>
                    </div>
                    <div className="member-row-actions">
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => {
                          setUnbanError('')
                          setConfirmUnban((cur) => (cur && cur.accountId === b.accountId ? null : b))
                        }}
                      >
                        Unban
                      </button>
                    </div>
                  </div>
                  {confirmUnban && confirmUnban.accountId === b.accountId && (
                    <div className="create-form">
                      <p style={{ fontSize: 12, margin: '0 0 10px', color: 'var(--text)' }}>
                        Unban <strong>{b.username}</strong>? They can come back to this server with a join
                        code. They don't rejoin on their own.
                      </p>
                      {unbanError && <div className="error-text">{unbanError}</div>}
                      <div className="create-form-actions">
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={unbanning}
                          onClick={() => setConfirmUnban(null)}
                        >
                          Cancel
                        </button>
                        <button type="button" className="btn-primary" disabled={unbanning} onClick={() => unban(b)}>
                          {unbanning ? 'Unbanning…' : 'Unban'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          </div>
        </>
      )}

      {isOwner && shown === 'music' && (
        <div className="rl-embed">
          <h2 className="rl-section-title">Music</h2>
          <p className="rl-section-sub">Link a Jellyfin library for Jellybox.</p>
          <MusicSection serverId={serverId} sessionToken={sessionToken} />
        </div>
      )}

      {isOwner && shown === 'history' && (
        <div className="rl-embed">
          <h2 className="rl-section-title">History</h2>
          <p className="rl-section-sub">How long persistent chat is kept.</p>
          <RetentionSection serverId={serverId} sessionToken={sessionToken} />
        </div>
      )}

      {isOwner && shown === 'ownership' && (
        <>
          <h2 className="rl-section-title">Ownership</h2>
          <p className="rl-section-sub">Hand {serverName} on, or delete it. Both ask for your password.</p>
            <div className="settings-section">
              <h3 className="rl-subhead">Hand over ownership</h3>
              <p className="settings-note">
                You can give this server to any member. Only the owner can delete it or hand it on, and
                the change is immediate: you stay an admin, and you cannot take it back yourself.
              </p>
              {others.length === 0 ? (
                <p className="settings-note">There is no one else here to hand it to yet.</p>
              ) : (
                <>
                  <div className="field">
                    <label>New owner</label>
                    <select
                      value={transferTo}
                      onChange={(e) => {
                        setTransferTo(e.target.value)
                        setConfirmTransfer(false)
                      }}
                    >
                      <option value="">Pick a member</option>
                      {others.map((m) => (
                        <option key={m.accountId} value={m.accountId}>
                          {m.username}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Your password</label>
                    <input
                      type="password"
                      value={transferPassword}
                      onChange={(e) => setTransferPassword(e.target.value)}
                      autoComplete="current-password"
                    />
                  </div>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!transferTo || !transferPassword}
                    onClick={() => {
                      setTransferError('')
                      setConfirmTransfer(true)
                    }}
                  >
                    Hand over ownership
                  </button>
                  {confirmTransfer && transferTarget && (
                    <div className="create-form">
                      <p style={{ fontSize: 12, margin: '0 0 10px', color: 'var(--text)' }}>
                        <strong>{transferTarget.username}</strong> becomes the owner of {serverName}. You become
                        an admin. Only they can delete the server or hand it on again, and you can't undo this
                        yourself.
                      </p>
                      {transferError && <div className="error-text">{transferError}</div>}
                      <div className="create-form-actions">
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={transferBusy}
                          onClick={() => setConfirmTransfer(false)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn-primary btn-danger"
                          disabled={transferBusy}
                          onClick={handOver}
                        >
                          {transferBusy ? 'Handing over…' : `Make ${transferTarget.username} the owner`}
                        </button>
                      </div>
                    </div>
                  )}
                  {!confirmTransfer && transferError && <div className="error-text">{transferError}</div>}
                </>
              )}
            </div>

            <div className="settings-section">
              <h3 className="rl-subhead danger">Delete this server</h3>
              <p className="settings-note">
                Deletes {serverName} for everyone: every channel, room and message, every code, and everyone's
                membership. This can't be undone. To keep the server and leave it, hand over ownership above
                instead.
              </p>
              <div className="field">
                <label>Your password</label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <button
                type="button"
                className="btn-secondary"
                disabled={!deletePassword}
                onClick={() => {
                  setDeleteError('')
                  setConfirmDelete(true)
                }}
              >
                Delete this server
              </button>
              {confirmDelete && (
                <div className="create-form">
                  <p style={{ fontSize: 12, margin: '0 0 10px', color: 'var(--text)' }}>
                    Delete <strong>{serverName}</strong> and everything in it, for everyone, for good?
                  </p>
                  {deleteError && <div className="error-text">{deleteError}</div>}
                  <div className="create-form-actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={deleteBusy}
                      onClick={() => setConfirmDelete(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn-primary btn-danger"
                      disabled={deleteBusy}
                      onClick={removeServer}
                    >
                      {deleteBusy ? 'Deleting…' : 'Delete it for good'}
                    </button>
                  </div>
                </div>
              )}
              {!confirmDelete && deleteError && <div className="error-text">{deleteError}</div>}
            </div>
        </>
      )}

        {confirmBan && (
          <div className="poll-backdrop rl-backdrop">
            <div className="rl-dialog" role="dialog" aria-modal="true" aria-labelledby="ban-title">
              <div className="rl-dialog-head">
                <h2 id="ban-title">Ban {confirmBan.username}?</h2>
              </div>
              <p className="settings-note">
                Removes them now and blocks them from rejoining with any code, until
                someone unbans them.
              </p>
              <div className="rl-dialog-foot">
                <button type="button" className="rl-dialog-cancel" onClick={() => setConfirmBan(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="rl-dialog-primary"
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
    </PageShell>
  )
}

export default AdminToolsScreen
