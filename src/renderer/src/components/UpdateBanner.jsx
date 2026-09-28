import { useEffect, useState } from 'react'

// Appears once an update has finished downloading in the background.
// Installing restarts the app; "Later" just hides it (the update also
// installs on its own the next time Rushlight is closed).
function UpdateBanner() {
  const [update, setUpdate] = useState(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!window.api || !window.api.onUpdateReady) return
    window.api.getPendingUpdate().then((info) => info && setUpdate(info))
    return window.api.onUpdateReady((info) => {
      setUpdate(info)
      setDismissed(false)
    })
  }, [])

  if (!update || dismissed) return null

  return (
    <div className="update-banner">
      <span>Rushlight {update.version} is ready.</span>
      <button type="button" className="update-banner-primary" onClick={() => window.api.installUpdate()}>
        Restart to update
      </button>
      <button type="button" onClick={() => setDismissed(true)}>
        Later
      </button>
    </div>
  )
}

export default UpdateBanner
