import * as e2eeSession from '../e2eeSession'

const kinds = (n) => (n.newDevices.length === 1 ? `a new device (${n.newDevices[0].label || 'a computer'})` : `${n.newDevices.length} new devices`)

// Calm banners at the top of an encrypted server: someone added a computer, or a person you verified now has a
// different number. Your own account gets a firmer line, since a computer you do not know about is the one thing
// worth stopping for.
function DeviceNotices({ notices, token, accountId, serverId, onCheck, onOpenSettings }) {
  if (!notices || notices.length === 0) return null
  return (
    <div className="device-notices" role="status">
      {notices.map((n) => (
        <div key={n.id} className={'device-notice' + (n.own ? ' own' : '')}>
          <span className="device-notice-text">
            {n.own
              ? `A new device was added to your account: ${n.newDevices.map((d) => d.label || 'a computer').join(', ')}. Was that you?`
              : n.newDevices.length > 0
                ? `${n.username} added ${kinds(n)}.${n.verifiedChanged ? ' You had verified them, so check their safety number again.' : ''}`
                : `${n.username}'s devices changed, so their verified mark was taken off. Check their safety number again.`}
          </span>
          {!n.own && (
            <button type="button" className="link-btn" onClick={() => onCheck(n.accountId)}>
              Check
            </button>
          )}
          {n.own && (
            <button type="button" className="link-btn" onClick={onOpenSettings}>
              Not me
            </button>
          )}
          <button
            type="button"
            className="link-btn"
            onClick={() => e2eeSession.dismissNotice({ token, accountId, serverId, noticeId: n.id })}
          >
            {n.own ? 'That was me' : 'Dismiss'}
          </button>
        </div>
      ))}
    </div>
  )
}

export default DeviceNotices
