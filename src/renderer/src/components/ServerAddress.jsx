import { useState, useEffect, useSyncExternalStore } from 'react'
import * as api from '../api'
import ServerAddressEditor from './ServerAddressEditor'
import { displayAddress } from '../../../shared/serverAddress'

// "Server 192.168.70.15:4000 · Change" on every sign-in screen. The server's address moves sometimes (a new IP after a router
// change), and an app that cannot reach it has no other way to be told. When a request could not reach the server at all, the
// line says so in plain words and offers "Change server address" right there.
function ServerAddress() {
  const [current, setCurrent] = useState('')
  const [editing, setEditing] = useState(false)
  const problem = useSyncExternalStore(api.subscribeConnection, api.getConnectionProblem)

  useEffect(() => {
    try {
      window.api?.getServerConfig?.().then((c) => setCurrent(c && c.serverUrl ? c.serverUrl : ''))
    } catch {
      // no window API (tests)
    }
  }, [])

  if (!current) return null

  if (editing) {
    return (
      <div className="auth-server auth-server-form">
        <ServerAddressEditor current={current} onCancel={() => setEditing(false)} />
      </div>
    )
  }

  return (
    <div className="auth-server">
      {problem && (
        <div className="auth-server-problem">
          <div className="error-text">Couldn't reach the server at {displayAddress(problem)}.</div>
          <button type="button" className="auth-primary" onClick={() => setEditing(true)}>
            Change server address
          </button>
        </div>
      )}
      Server <span>{displayAddress(current)}</span>{' '}
      <button type="button" className="auth-link" onClick={() => setEditing(true)}>
        Change
      </button>
    </div>
  )
}

export default ServerAddress
