import { useSyncExternalStore } from 'react'
import RushlightLogo from './RushlightLogo'
import * as unread from '../unread'

// Discord-style rail: home on top, one button per server you belong to,
// and a plus at the bottom to create or join another.
function ServerRail({ servers, currentServerId, onSelect, onHome, onAdd }) {
  const counts = useSyncExternalStore(unread.subscribe, unread.getSnapshot)
  return (
    <div className="server-rail">
      <button
        type="button"
        className={'rail-btn rail-home' + (currentServerId == null ? ' active' : '')}
        title="Home"
        onClick={() => onHome()}
      >
        <RushlightLogo size={20} />
      </button>
      <div className="rail-divider" />
      {servers.map((s) => {
        const n = unread.serverUnread(counts, s.id)
        return (
          <div className="rail-item" key={s.id}>
            <button
              type="button"
              className={'rail-btn' + (s.id === currentServerId ? ' active' : '')}
              title={n > 0 ? `${s.name} (${n} unread)` : s.name}
              onClick={() => onSelect(s.id)}
            >
              {s.name.charAt(0).toUpperCase()}
            </button>
            {n > 0 && (
              <span className="rail-bubble" aria-hidden="true" key={n}>
                {n > 99 ? '99+' : n}
              </span>
            )}
          </div>
        )
      })}
      <button
        type="button"
        className="rail-btn rail-add"
        title="Create or join a server"
        onClick={onAdd}
      >
        +
      </button>
    </div>
  )
}

export default ServerRail
