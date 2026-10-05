import { useState, useSyncExternalStore } from 'react'
import * as voice from '../voice'
import Avatar from './Avatar'

function UserFooter({
  displayName,
  avatarColor,
  imageUrl,
  isAdmin,
  onOpenSettings,
  onOpenProfile,
  onOpenAdminTools
}) {
  const v = useSyncExternalStore(voice.subscribe, voice.getSnapshot)
  const [micVolume, setMicVolume] = useState(() => Math.round(voice.getInputGain() * 100))
  const [speakerVolume, setSpeakerVolume] = useState(() => Math.round(voice.getOutputVolume() * 100))

  return (
    <div className="user-footer">
      <div
        className="user-footer-top"
        style={{ cursor: 'pointer' }}
        onClick={onOpenProfile}
        title="Your profile"
      >
        <Avatar color={avatarColor} name={displayName} imageUrl={imageUrl} size={28} className="user-avatar" />
        <span className="user-footer-name">{displayName}</span>
        <span className="foot-toggles" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={'foot-toggle' + (v.muted || v.deafened ? ' on' : '')}
            title={v.deafened ? 'Deafened (mic is off)' : v.muted ? 'Unmute your mic' : 'Mute your mic'}
            disabled={v.deafened}
            onClick={voice.toggleMute}
          >
            mute
          </button>
          <button
            type="button"
            className={'foot-toggle' + (v.deafened ? ' on' : '')}
            title={v.deafened ? 'Undeafen' : 'Deafen: silence everyone and turn your mic off'}
            onClick={voice.toggleDeafen}
          >
            deaf
          </button>
        </span>
      </div>

      <div className="user-footer-controls">
        <div className="vol-slider" title={`Mic input volume (${micVolume}%, double-click to reset)`}>
          <span className="vol-label">mic</span>
          <input
            type="range"
            min="0"
            max="200"
            value={micVolume}
            onChange={(e) => {
              const value = Number(e.target.value)
              setMicVolume(value)
              voice.setInputGain(value / 100)
            }}
            onDoubleClick={() => {
              setMicVolume(100)
              voice.setInputGain(1)
            }}
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
