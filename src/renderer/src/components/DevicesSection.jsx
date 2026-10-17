import { useEffect, useState } from 'react'
import * as api from '../api'
import { peopleFromDevices } from '../e2ee/safety.js'
import * as e2eeSession from '../e2eeSession'

const when = (ts) => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

// Settings > Account: the computers that can read this account's encrypted servers, with the safety number others
// compare against. A computer you do not know can be removed here; removing one starts a new key in every server it
// belonged to, so it cannot read anything sent from then on.
function DevicesSection({ sessionToken, accountId }) {
  const [devices, setDevices] = useState(null)
  const [number, setNumber] = useState('')
  const [thisDevice, setThisDevice] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const { devices: list } = await api.listMyDevices(sessionToken)
      const withKeys = list.map((d) => ({ ...d, accountId }))
      const people = await peopleFromDevices(withKeys)
      setDevices(people[accountId] ? people[accountId].devices : [])
      setNumber(people[accountId] ? people[accountId].number : '')
      setThisDevice(await e2eeSession.thisDeviceId(accountId))
    } catch (err) {
      setError(err.message)
    }
  }
  useEffect(() => {
    load()
  }, [sessionToken])

  async function remove(id) {
    setBusy(true)
    setError('')
    try {
      await api.removeDevice(sessionToken, id)
      setConfirm(null)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!devices || devices.length === 0) return null
  return (
    <section className="settings-block">
      <h3 className="rl-subsection-title">Your devices</h3>
      <p className="settings-note">
        These computers can read your encrypted servers. If you see one you do not know, remove it, then change your password.
      </p>
      <div className="safety-number mono" aria-label="Your safety number">{number}</div>
      <p className="settings-note">Your safety number. Others compare it with what they see for you.</p>
      <div className="safety-devices">
        {devices.map((d) => (
          <div key={d.id} className="safety-device">
            <span>
              {d.label || 'Computer'}
              {d.id === thisDevice && <span className="member-badge">this one</span>}
            </span>
            <span className="safety-device-when">added {when(d.createdAt)}</span>
            <span className="safety-device-print mono">{d.fingerprint}</span>
            {d.id !== thisDevice &&
              (confirm === d.id ? (
                <span>
                  <button type="button" className="btn-primary btn-danger" disabled={busy} onClick={() => remove(d.id)}>
                    Remove it
                  </button>{' '}
                  <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button type="button" className="btn-secondary" onClick={() => setConfirm(d.id)}>
                  Remove
                </button>
              ))}
          </div>
        ))}
      </div>
      {error && <div className="error-text">{error}</div>}
    </section>
  )
}

export default DevicesSection
