import { useSyncExternalStore } from 'react'
import Icon from '../components/Icon'
import * as unread from '../unread'

// Home: where you are when no server is open. It lists your servers by their full names (the rail only has room
// for a letter each), and is the place the rest of the app's social side will grow from.
function HomeScreen({
  screenName,
  servers = [],
  error,
  notice,
  onDismissNotice,
  onRetry,
  onAdd,
  onSelectServer,
  onOpenSettings,
  onLogout
}) {
  const counts = useSyncExternalStore(unread.subscribe, unread.getSnapshot)
  const hasServers = servers.length > 0

  return (
    <div className="home-screen">
      <div className="home-main">
        <div className="home-inner">
          {notice && (
            <div className="home-notice">
              {notice}
              <button type="button" className="link-btn" onClick={onDismissNotice}>
                Dismiss
              </button>
            </div>
          )}
          {error ? (
            <div className="home-empty">
              <h1>Couldn't load your servers</h1>
              <p className="sub">{error}</p>
              <button type="button" className="btn-secondary retry-btn" onClick={onRetry}>
                Try again
              </button>
            </div>
          ) : hasServers ? (
            <>
              <h1 className="home-title">Welcome back, {screenName}</h1>
              <p className="home-sub">Pick a server to open it, or add another.</p>
              <div className="home-label">Your servers</div>
              <div className="home-servers">
                {servers.map((s) => {
                  const n = unread.serverUnread(counts, s.id)
                  return (
                    <button key={s.id} type="button" className="home-server" onClick={() => onSelectServer(s.id)}>
                      <span className="home-server-tile" aria-hidden="true">
                        {s.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="home-server-name">{s.name}</span>
                      {n > 0 && <span className="home-server-unread">{n > 99 ? '99+' : n} unread</span>}
                    </button>
                  )
                })}
                <button type="button" className="home-server home-server-add" onClick={onAdd} title="Add a server">
                  <span className="home-server-tile" aria-hidden="true">
                    <Icon name="plus" size={20} strokeWidth={2} />
                  </span>
                  <span className="home-server-name">Create or join a server</span>
                </button>
              </div>
            </>
          ) : (
            <div className="home-empty">
              <button type="button" className="big-plus" onClick={onAdd} title="Create your first server">
                +
              </button>
              <h1>Create your first server</h1>
              <p className="sub">
                Click the plus to name a server, then build out its channels and rooms — or join someone else's with a code.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="home-footer">
        <span className="home-name">{screenName}</span>
        <div className="home-footer-actions">
          <button type="button" className="btn-secondary" onClick={onOpenSettings}>
            Settings
          </button>
          <button type="button" className="btn-secondary" onClick={onLogout}>
            Log out
          </button>
        </div>
      </div>
    </div>
  )
}

export default HomeScreen
