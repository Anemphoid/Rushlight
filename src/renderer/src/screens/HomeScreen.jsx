function HomeScreen({
  screenName,
  hasServers,
  error,
  notice,
  onDismissNotice,
  onRetry,
  onAdd,
  onOpenSettings,
  onLogout
}) {
  return (
    <div className="home-screen">
      <div className="home-main">
        {notice && (
          <div className="home-notice">
            {notice}
            <button type="button" className="link-btn" onClick={onDismissNotice}>
              Dismiss
            </button>
          </div>
        )}
        {error ? (
          <>
            <h1>Couldn't load your servers</h1>
            <p className="sub">{error}</p>
            <button type="button" className="btn-secondary retry-btn" onClick={onRetry}>
              Try again
            </button>
          </>
        ) : hasServers ? (
          <>
            <h1>Welcome back, {screenName}</h1>
            <p className="sub">Pick a server from the left, or add another.</p>
            <button type="button" className="big-plus small" onClick={onAdd} title="Add a server">
              +
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="big-plus"
              onClick={onAdd}
              title="Create your first server"
            >
              +
            </button>
            <h1>Create your first server</h1>
            <p className="sub">
              Click the plus to name a server, then build out its channels and rooms — or
              join someone else's with a code.
            </p>
          </>
        )}
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
