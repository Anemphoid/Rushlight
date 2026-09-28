import { useState } from 'react'
import * as voice from '../voice'
import RushlightLogo from './RushlightLogo'

function UserFooter({
  displayName,
  avatarColor,
  isAdmin,
  onOpenSettings,
  onOpenProfile,
  onOpenAdminTools
}) {
  const [micVolume, setMicVolume] = useState(80)
  const [speakerVolume, setSpeakerVolume] = useState(() => Math.round(voice.getOutputVolume() * 100))

  return (
    <div className="user-footer">
      <div
        className="user-footer-top"
        style={{ cursor: 'pointer' }}
        onClick={onOpenProfile}
        title="Your profile"
      >
        <div className="user-avatar" style={avatarColor ? { background: avatarColor } : {}}>
          {avatarColor ? (
            <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--on-accent)' }}>
              {(displayName || '?').charAt(0).toUpperCase()}
            </span>
          ) : (
            <RushlightLogo size={28} />
          )}
        </div>
        <span className="user-footer-name">{displayName}</span>
      </div>

      <div className="user-footer-controls">
        <div className="vol-slider disabled" title="Mic input volume isn't connected yet">
          <span className="vol-label">mic</span>
          <input
            type="range"
            disabled
            min="0"
            max="100"
            value={micVolume}
            onChange={(e) => setMicVolume(Number(e.target.value))}
          />
        </div>
        <div className="vol-slider" title="Speaker output volume">
          <span className="vol-label">out</span>
          <input
            type="range"
            min="0"
            max="100"
            value={speakerVolume}
            onChange={(e) => {
              const value = Number(e.target.value)
              setSpeakerVolume(value)
              voice.setOutputVolume(value / 100)
            }}
          />
        </div>
        {isAdmin && (
          <button
            type="button"
            className="gear-btn admin-tools-btn"
            title="Admin Tools"
            onClick={onOpenAdminTools}
          >
            admin
          </button>
        )}
        <button
          type="button"
          className="gear-btn"
          title="Settings"
          onClick={onOpenSettings}
        >
          ⚙
        </button>
      </div>
    </div>
  )
}

export default UserFooter
