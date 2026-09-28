import { useSyncExternalStore } from 'react'
import Avatar from './Avatar'
import * as voice from '../voice'
import { formatKeyLabel } from '../keys'

const STATUS_TEXT = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  error: 'Connection problem'
}

function VoicePanel({ compact, pttKey, pttHookOk, localColor, colorFor, onRetry }) {
  const v = useSyncExternalStore(voice.subscribe, voice.getSnapshot)
  const live = v.status === 'connected' || v.status === 'reconnecting'

  return (
    <div className={'voice-panel' + (compact ? ' compact' : '')}>
      <div className="voice-header">
        <span className={'voice-status ' + v.status}>{STATUS_TEXT[v.status]}</span>
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
        <div className="voice-participants">
          {v.participants.map((p) => (
            <div
              key={p.identity}
              className={'voice-participant' + (p.isSpeaking ? ' speaking' : '')}
            >
              <Avatar color={p.isLocal ? localColor : colorFor(p.name)} name={p.name} size={20} />
              <span>
                {p.name}
                {p.isLocal ? ' (you)' : ''}
              </span>
              {p.isMuted && <span className="voice-muted">muted</span>}
            </div>
          ))}
        </div>
      )}

      {live && (
        <div className="voice-hint">
          {v.micMode === 'open' ? (
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
