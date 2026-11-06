import { useState, useEffect } from 'react'
import ServerAddressEditor from './ServerAddressEditor'

// Settings > Connection: the same field as on the sign-in screen, for changing the server's address while signed in.
function ConnectionSection() {
  const [current, setCurrent] = useState(null)
  useEffect(() => {
    window.api?.getServerConfig?.().then((c) => setCurrent((c && c.serverUrl) || ''))
  }, [])
  if (current === null) return null
  return (
    <>
      <h2 className="rl-section-title">Connection</h2>
      <p className="rl-section-sub">The address of the server this app talks to. Saving reloads Rushlight, and voice reconnects.</p>
      <ServerAddressEditor current={current} />
    </>
  )
}

export default ConnectionSection
