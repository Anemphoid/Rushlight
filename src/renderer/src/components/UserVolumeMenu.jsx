import { useState } from 'react'
import * as voice from '../voice'

// Right-click a person in the tree to turn just them up or down. It only goes
// down from 100%: their volume is a share of your output volume.
function UserVolumeMenu({ x, y, name, onClose }) {
  const [value, setValue] = useState(() => Math.round(voice.getUserVolume(name) * 100))

  function change(next) {
    setValue(next)
    voice.setUserVolume(name, next / 100)
  }

  return (
    <>
      <div
        className="context-menu-backdrop"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div className="context-menu user-volume-menu" style={{ top: y, left: x }}>
        <div className="user-volume-title">{name}</div>
        <div className="user-volume-row">
          <input
            type="range"
            min="0"
            max="100"
            value={value}
            onChange={(e) => change(Number(e.target.value))}
            onDoubleClick={() => change(100)}
          />
          <span className="user-volume-value">{value}%</span>
        </div>
        {value !== 100 && (
          <button type="button" className="context-menu-item" onClick={() => change(100)}>
            Reset
          </button>
        )}
      </div>
    </>
  )
}

export default UserVolumeMenu
