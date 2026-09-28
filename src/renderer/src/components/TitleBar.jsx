import { useEffect, useState } from 'react'
import RushlightLogo from './RushlightLogo'

function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    window.api.windowIsMaximized().then(setIsMaximized)
    const unsubscribe = window.api.onWindowMaximizedChange(setIsMaximized)
    return unsubscribe
  }, [])

  return (
    <div className="title-bar">
      <div className="title-bar-left">
        <RushlightLogo size={16} />
        Rushlight
      </div>
      <div className="title-bar-controls">
        <button
          type="button"
          className="win-btn"
          title="Minimize"
          onClick={() => window.api.windowMinimize()}
        >
          <span className="win-icon-min" />
        </button>
        <button
          type="button"
          className="win-btn"
          title={isMaximized ? 'Restore' : 'Maximize'}
          onClick={() => window.api.windowMaximizeToggle()}
        >
          <span className={isMaximized ? 'win-icon-restore' : 'win-icon-max'} />
        </button>
        <button
          type="button"
          className="win-btn close"
          title="Close"
          onClick={() => window.api.windowClose()}
        >
          <span className="win-icon-close" />
        </button>
      </div>
    </div>
  )
}

export default TitleBar
