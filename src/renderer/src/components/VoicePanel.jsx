import { useState, useSyncExternalStore } from 'react'
import * as voice from '../voice'
import { formatKeyLabel } from '../keys'

const STATUS_TEXT = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  error: 'Connection problem'
}

const QUALITY_TEXT = { excellent: 'excellent', good: 'good', poor: 'poor', lost: 'lost' }

// Who is in the space, who is talking and who is muted is shown in the channel
// tree, so this panel is just the connection: its state, how healthy it is,
// and how to talk.
function VoicePanel({ compact, pttKey, pttHookOk, onRetry, jellybox }) {
  const v = useSyncExternalStore(voice.subscribe, voice.getSnapshot)
  const live = v.status === 'connected' || v.status === 'reconnecting'
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [switchError, setSwitchError] = useState('')

  async function setAllowed(open) {
    setBusy(true)
    setSwitchError('')
    try {
      await jellybox.onSet(open)
      setConfirming(false)
    } catch (err) {
      setSwitchError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={'voice-panel' + (compact ? ' compact' : '')}>
      <div className="voice-header">
        <span className={'voice-status ' + v.status}>{STATUS_TEXT[v.status]}</span>
        {v.encrypted && (
          <span className="voice-encrypted" title="Only the people in this call can hear it. The voice server only passes on scrambled audio.">
            encrypted
          </span>
        )}
        {live && (v.quality || v.pingMs !== null) && (
          <span
            className={'voice-quality ' + (v.quality || '')}
            title="Quality of your connection to the voice server"
          >
            {v.pingMs !== null && <>ping {v.pingMs} ms</>}
            {v.pingMs !== null && v.quality && ' · '}
            {v.quality && <>connection {QUALITY_TEXT[v.quality] || v.quality}</>}
          </span>
        )}
      </div>

      {v.e2eeProblem && <div className="error-text">{v.e2eeProblem}</div>}

      {v.roomNote && <div className="voice-note">{v.roomNote}</div>}
      {v.jellyboxOpen && live && (
        <div className="voice-note" title="The music bot's audio comes from the server, which can't scramble it, so while it is allowed here the voice in this room isn't end-to-end encrypted.">
          Music is allowed in this room, so voice here isn’t end-to-end encrypted. Chat is still private.
        </div>
      )}

      {jellybox && (
        <div className="voice-jellybox">
          {!confirming ? (
            <>
              <span className="voice-hint">Jellybox in this room: <strong>{jellybox.open ? 'allowed' : 'off'}</strong></span>{' '}
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => (jellybox.open ? setAllowed(false) : setConfirming(true))}>
                {jellybox.open ? 'Turn off' : 'Allow'}
              </button>
            </>
          ) : (
            <div className="voice-note">
              Jellybox plays music from the server, which can’t scramble it. While it is allowed here, voice in this room won’t be end-to-end
              encrypted, and everyone in the call will reconnect and be told. Chat stays private. You can turn it off any time.
              <div className="voice-jellybox-actions">
                <button type="button" className="btn-primary" disabled={busy} onClick={() => setAllowed(true)}>
                  Allow Jellybox
                </button>
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {switchError && <div className="error-text">{switchError}</div>}
        </div>
      )}

      {v.error && (
        <div className="error-text">
          {v.error}{' '}
          {v.status === 'error' && (
            <button type="button" className="link-btn" onClick={onRetry}>
              Try again
            </button>
          )}
        </div>
      )}

      {live && (
        <div className="voice-hint">
          {v.deafened ? (
            'You are deafened: you can’t hear anyone and your mic is off.'
          ) : v.muted ? (
            'You are muted.'
          ) : v.micMode === 'open' ? (
            'Your mic is open.'
          ) : v.pttHeld ? (
            <strong>Talking…</strong>
          ) : (
            <>
              Hold <strong>{formatKeyLabel(pttKey)}</strong> to talk
              {pttHookOk ? '.' : ' (only works while this window is focused).'}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default VoicePanel
