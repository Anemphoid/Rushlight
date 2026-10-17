import { useEffect, useState } from 'react'
import Icon from './Icon'
import { useClosing } from './ViewTransition'
import * as e2eeSession from '../e2eeSession'

const when = (ts) => new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

// A person's safety number, for checking that nobody (the server included) has slipped in a key that is not theirs.
// Compare it with the number the person reads out from their own app (Settings > Account > Your devices), in
// person or on a call you trust. When they match, mark them verified; the mark goes by itself if their devices change.
function SafetyNumberDialog({ person, verified, isYou, onVerify, onClose: leave }) {
  const [closing, onClose] = useClosing(leave)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function set(value) {
    setBusy(true)
    try {
      await onVerify(value)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={'poll-backdrop rl-backdrop' + (closing ? ' closing' : '')}>
      <div className="rl-dialog" role="dialog" aria-modal="true" aria-labelledby="safety-title">
        <div className="rl-dialog-head">
          <h2 id="safety-title">{isYou ? 'Your safety number' : `${person.username}'s safety number`}</h2>
          <button type="button" className="rl-dialog-x" aria-label="Close" title="Close (Esc)" onClick={onClose}>
            <Icon name="close" size={18} strokeWidth={2} />
          </button>
        </div>

        <p className="settings-note">
          {isYou
            ? 'Anyone who wants to be sure they are really talking to you can compare this with what they see for you. Read it out in person or on a call you trust.'
            : `Ask ${person.username} to read you the number under Settings > Account > Your devices, in person or on a call you trust. If it matches this one, nobody has swapped in a key that is not theirs.`}
        </p>
        <div className="safety-number mono" aria-label="Safety number">
          {person.number}
        </div>

        {!isYou && (
          <div className="safety-actions">
            {verified ? (
              <>
                <span className="safety-verified">Verified</span>
                <button type="button" className="rl-dialog-secondary" disabled={busy} onClick={() => set(false)}>
                  Remove the mark
                </button>
              </>
            ) : (
              <button type="button" className="rl-dialog-primary" disabled={busy} onClick={() => set(true)}>
                It matches: mark as verified
              </button>
            )}
          </div>
        )}

        <div className="safety-devices">
          <div className="safety-devices-title">{person.devices.length === 1 ? '1 device' : `${person.devices.length} devices`}</div>
          {person.devices.map((d) => (
            <div key={d.id} className="safety-device">
              <span>{d.label || 'Computer'}</span>
              <span className="safety-device-when">added {when(d.createdAt)}</span>
              <span className="safety-device-print mono">{d.fingerprint}</span>
            </div>
          ))}
        </div>

        <div className="rl-dialog-foot">
          <button type="button" className="rl-dialog-cancel" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default SafetyNumberDialog
