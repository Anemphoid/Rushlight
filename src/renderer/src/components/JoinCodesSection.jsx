import { useState, useEffect, useCallback } from 'react'
import * as api from '../api'
import * as e2eeSession from '../e2eeSession'
import { joinFullCode } from '../e2ee/crypto'
import { formatExpiry, formatAge } from '../time'

const EXPIRY_OPTIONS = [
  { label: '1 hour', minutes: 60 },
  { label: '24 hours', minutes: 1440 },
  { label: '7 days', minutes: 10080 },
  { label: 'No expiry', minutes: null }
]

// Admin Tools: make join codes and manage the ones that are out there. The
// list is exactly what the server returns: codes that can still bring someone
// in. A code that has been used up, has expired or was revoked drops off it.
function JoinCodesSection({ serverId, serverName, sessionToken, accountId }) {
  const [singleUse, setSingleUse] = useState(true)
  const [expiryMinutes, setExpiryMinutes] = useState(1440)
  const [code, setCode] = useState(null) // the code just generated, shown large
  const [codeError, setCodeError] = useState('')
  const [generating, setGenerating] = useState(false)
  const [copiedKey, setCopiedKey] = useState(null)
  const [scopeValue, setScopeValue] = useState('') // '' = whole server, else 'channel:3' / 'room:7'
  const [spaces, setSpaces] = useState([]) // voice spaces a code can be limited to
  // An encrypted server's invites carry keys: made here, and shown whole (the code, a dot, and a secret half).
  const [encrypted, setEncrypted] = useState(false)

  const [codes, setCodes] = useState(null) // null = still loading
  const [listError, setListError] = useState('')
  const [confirmRevoke, setConfirmRevoke] = useState(null) // a row from the list, or null
  const [revoking, setRevoking] = useState(false)
  const [revokeError, setRevokeError] = useState('')

  const loadCodes = useCallback(async () => {
    try {
      const result = await api.listServerCodes(sessionToken, serverId)
      setCodes(encrypted ? await e2eeSession.withFullCodes(accountId, serverId, result.codes) : result.codes)
      setListError('')
    } catch (err) {
      setListError(err.message)
    }
  }, [sessionToken, serverId, accountId, encrypted])

  useEffect(() => {
    loadCodes()
    // Catches a code being used up or expiring, another admin acting, guests coming and going.
    const timer = setInterval(loadCodes, 5000)
    return () => clearInterval(timer)
  }, [loadCodes])

  useEffect(() => {
    api
      .getServer(sessionToken, serverId)
      .then((s) => {
        const list = []
        for (const ch of s.channels || []) {
          if (ch.mode !== 'text') list.push({ value: `channel:${ch.id}`, label: `${ch.name} (and its rooms)` })
          for (const r of ch.rooms || []) {
            // a room's value also says which channel it is in: its voice key comes from that channel's
            if (r.mode !== 'text') list.push({ value: `room:${r.id}:${ch.id}`, label: `${ch.name} / ${r.name}` })
          }
        }
        setEncrypted(!!(s.e2ee && s.e2ee.enabled))
        setSpaces(list)
        setScopeValue((cur) => (list.some((o) => o.value === cur) ? cur : ''))
      })
      .catch(() => {}) // the picker just stays on "whole server"
  }, [sessionToken, serverId])

  async function generate() {
    setCodeError('')
    setCopiedKey(null)
    setGenerating(true)
    try {
      const options = { singleUse, expiresInMinutes: expiryMinutes }
      let keyScope = null
      if (scopeValue) {
        const [type, id, channelId] = scopeValue.split(':')
        options.scope = { type, id: Number(id) }
        keyScope = type === 'room' ? { type, id: Number(id), channelId: Number(channelId) } : { type, id: Number(id) }
      }
      let invite = null
      if (encrypted) {
        // The keys are sealed here, under a secret half that only goes into the shared code, never to the server.
        try {
          invite = await e2eeSession.createInvite(accountId, serverId, keyScope)
        } catch (err) {
          if (err.code === 'no_key') throw new Error("This computer doesn't have this server's key yet, so it can't make an invite. It arrives when another member opens Rushlight.")
          throw err
        }
        options.e2ee = invite.body
      }
      const result = await api.createServerCode(sessionToken, serverId, options)
      setCode(invite ? joinFullCode(result.code, invite.secret) : result.code)
      await loadCodes()
    } catch (err) {
      setCodeError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  async function copy(text, key) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500)
    } catch {
      // clipboard blocked: the code is on screen to copy by hand
    }
  }

  async function revoke(row) {
    setRevoking(true)
    setRevokeError('')
    try {
      await api.revokeServerCode(sessionToken, serverId, row.id)
      setConfirmRevoke(null)
      if (code && code.split('.')[0] === row.code) setCode(null)
      await loadCodes()
    } catch (err) {
      setRevokeError(err.message)
    } finally {
      setRevoking(false)
    }
  }

  return (
    <>
      <div className="settings-section">
        <h2>invite someone</h2>
        <div className="tier-row" style={{ marginBottom: 8 }}>
          {[
            { label: 'Single use', value: true },
            { label: 'Reusable', value: false }
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              className={'tier-chip' + (singleUse === o.value ? ' active' : '')}
              onClick={() => setSingleUse(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="tier-row" style={{ marginBottom: 10 }}>
          {EXPIRY_OPTIONS.map((o) => (
            <button
              key={o.label}
              type="button"
              className={'tier-chip' + (expiryMinutes === o.minutes ? ' active' : '')}
              onClick={() => setExpiryMinutes(o.minutes)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="field" style={{ marginBottom: 10 }}>
          <select value={scopeValue} onChange={(e) => setScopeValue(e.target.value)} aria-label="What the code covers">
            <option value="">Whole server</option>
            {spaces.map((o) => (
              <option key={o.value} value={o.value}>
                Guests only: {o.label}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn-primary" disabled={generating} onClick={generate}>
          {generating ? 'Generating…' : 'Generate join code'}
        </button>
        {codeError && <div className="error-text">{codeError}</div>}
        {code && (
          <>
            <div className="code-box">
              <code>{code}</code>
              <button type="button" className="btn-secondary" onClick={() => copy(code, 'new')}>
                {copiedKey === 'new' ? 'Copied' : 'Copy'}
              </button>
            </div>
            {encrypted && (
              <p className="settings-note">
                This invite carries the server's key. Share it whole, including the part after the dot: without it, a guest
                can't join and a new member waits for another member to be online.
              </p>
            )}
            <p className="settings-note">
              {scopeValue
                ? 'This code is for guests only: enter it in the login screen\'s join box. It can\'t make someone a member.'
                : `With an account: paste it under the + on the home screen to join ${serverName}. Without one: enter it in the login screen's join box to come in as a guest.`}
            </p>
          </>
        )}
      </div>

      <div className="settings-section">
        <h2>active codes</h2>
        {listError && <p className="error-text">{listError}</p>}
        {codes === null && !listError && <p className="settings-note">Loading…</p>}
        {codes && codes.length === 0 && (
          <p className="settings-note">No active codes. Generate one above.</p>
        )}
        {codes && codes.length > 0 && (
          <div className="member-list">
            {codes.map((c) => {
              const expiry = formatExpiry(c.expiresAt)
              return (
                <div key={c.id}>
                  <div className="member-row">
                    <div className="member-row-main">
                      <div className="member-row-name">
                        <code className="code-row-code">{c.code}</code>
                        {encrypted && !c.e2ee && <span className="member-badge" title="Made before this server was encrypted: it still brings a member in, but guests can't use it">old invite</span>}
                        {encrypted && c.e2ee && !c.fullCode && <span className="member-badge" title="This computer does not hold the key needed to show this invite's secret half">key missing</span>}
                        <span className="member-badge">{c.singleUse ? 'single use' : 'reusable'}</span>
                        {c.scope && (
                          <span className="member-badge">
                            guests only: {c.scope.name}
                          </span>
                        )}
                        {c.used && c.singleUse && (
                          <span className="member-badge">
                            used{c.guestsNow > 0 ? `, ${c.guestsNow} guest${c.guestsNow === 1 ? '' : 's'} in` : ''}
                          </span>
                        )}
                        {c.guestsNow > 0 && !(c.used && c.singleUse) && (
                          <span className="member-badge">
                            {c.guestsNow} guest{c.guestsNow === 1 ? '' : 's'} in now
                          </span>
                        )}
                      </div>
                      <div className="member-row-expiry">
                        {expiry ? `expires: ${expiry}` : 'no expiry'} · created {formatAge(c.createdAt)}
                      </div>
                    </div>
                    <div className="member-row-actions">
                      {(!encrypted || !c.e2ee || c.fullCode) && (
                        <button type="button" className="link-btn" onClick={() => copy(c.fullCode || c.code, c.id)}>
                          {copiedKey === c.id ? 'Copied' : 'Copy'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="link-btn danger"
                        onClick={() => {
                          setRevokeError('')
                          setConfirmRevoke((cur) => (cur && cur.id === c.id ? null : c))
                        }}
                      >
                        Revoke
                      </button>
                    </div>
                  </div>
                  {confirmRevoke && confirmRevoke.id === c.id && (
                    <div className="create-form">
                      <p style={{ fontSize: 12, margin: '0 0 10px', color: 'var(--text)' }}>
                        Revoke <strong>{c.code}</strong>? Guests who joined with it are removed
                        immediately, including from voice. People who made an account with it keep
                        their membership; use kick or ban for them.
                      </p>
                      {revokeError && <div className="error-text">{revokeError}</div>}
                      <div className="create-form-actions">
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={revoking}
                          onClick={() => setConfirmRevoke(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn-primary btn-danger"
                          disabled={revoking}
                          onClick={() => revoke(c)}
                        >
                          {revoking ? 'Revoking…' : 'Revoke'}
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
          Used up, expired and revoked codes aren't listed. The list refreshes every few seconds.
        </p>
      </div>
    </>
  )
}

export default JoinCodesSection
