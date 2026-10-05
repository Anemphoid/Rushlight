import { useSyncExternalStore } from 'react'
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
function VoicePanel({ compact, pttKey, pttHookOk, onRetry }) {
  const v = useSyncExternalStore(voice.subscribe, voice.getSnapshot)
  const live = v.status === 'connected' || v.status === 'reconnecting'

  return (
    <div className={'voice-panel' + (compact ? ' compact' : '')}>
      <div className="voice-header">
        <span className={'voice-status ' + v.status}>{STATUS_TEXT[v.status]}</span>
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
