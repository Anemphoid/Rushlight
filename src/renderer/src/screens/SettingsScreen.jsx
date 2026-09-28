import { useState, useEffect, useSyncExternalStore } from 'react'
import * as voice from '../voice'
import MicSpeakerCheck from '../components/MicSpeakerCheck'
import { formatKeyLabel } from '../keys'

const DENSITY_TIERS = ['compact', 'cozy', 'comfortable']
const ICON_SIZE_TIERS = ['small', 'medium', 'large']

function SettingsScreen({
  density,
  onChangeDensity,
  iconSize,
  onChangeIconSize,
  pttKey,
  onChangePttKey,
  pttHookOk,
  skin,
  onChangeSkin,
  mode,
  onChangeMode,
  onBack
}) {
  const [listening, setListening] = useState(false)
  const [keyError, setKeyError] = useState('')
  const micMode = useSyncExternalStore(voice.subscribe, voice.getSnapshot).micMode
  const [version, setVersion] = useState('')

  useEffect(() => {
    if (window.api && window.api.getVersion) window.api.getVersion().then(setVersion)
  }, [])

  useEffect(() => {
    if (!listening) return
    function handleKeyDown(e) {
      e.preventDefault()
      setListening(false)
      Promise.resolve(onChangePttKey(e.code)).then((ok) => {
        setKeyError(
          ok ? '' : "That key can't be used for push-to-talk outside this window. Try a different one."
        )
      })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [listening, onChangePttKey])

  return (
    <div className="screen">
      <div className="card" style={{ maxWidth: 460 }}>
        <h1>Settings</h1>
        <p className="sub">Client display and control settings.</p>

        <div className="settings-preview">
          <div className="settings-preview-label">Preview</div>
          <div className="channel-row" style={{ cursor: 'default' }}>
            <span>
              <span className="mode-label">v/t</span>
              Example Channel
            </span>
            <span style={{ display: 'flex', gap: 4 }}>
              <span className="tree-add-btn" style={{ cursor: 'default' }}>
                +
              </span>
            </span>
          </div>
          <div className="room-row" style={{ justifyContent: 'space-between' }}>
            <span>
              <span className="mode-label">v</span>
              Example Room
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 6px 2px' }}>
            <div className="user-avatar" style={{ background: 'var(--accent)' }}>
              <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--on-accent)' }}>C</span>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700 }}>Your name here</span>
          </div>
        </div>

        <div className="settings-section">
          <h2>density</h2>
          <div className="tier-row">
            {DENSITY_TIERS.map((tier) => (
              <button
                key={tier}
                type="button"
                className={'tier-chip' + (density === tier ? ' active' : '')}
                onClick={() => onChangeDensity(tier)}
              >
                {tier[0].toUpperCase() + tier.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <h2>icon size</h2>
          <div className="tier-row">
            {ICON_SIZE_TIERS.map((tier) => (
              <button
                key={tier}
                type="button"
                className={'tier-chip' + (iconSize === tier ? ' active' : '')}
                onClick={() => onChangeIconSize(tier)}
              >
                {tier[0].toUpperCase() + tier.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <h2>microphone mode</h2>
          <div className="tier-row">
            <button
              type="button"
              className={'tier-chip' + (micMode === 'ptt' ? ' active' : '')}
              onClick={() => voice.setMicMode('ptt')}
            >
              Push to talk
            </button>
            <button
              type="button"
              className={'tier-chip' + (micMode === 'open' ? ' active' : '')}
              onClick={() => voice.setMicMode('open')}
            >
              Open mic
            </button>
          </div>
          <p className="settings-note">
            Push to talk: your mic is live only while you hold the key below. Open mic: it stays
            live the whole time you're in a voice room. Takes effect immediately, even mid-call.
          </p>
        </div>

        <div className="settings-section">
          <h2>push-to-talk key</h2>
          <button
            type="button"
            className={'key-capture-btn' + (listening ? ' listening' : '')}
            onClick={() => setListening(true)}
          >
            {listening ? 'Press a key…' : formatKeyLabel(pttKey)}
          </button>
          {keyError && <p className="error-text">{keyError}</p>}
          <p className="settings-note">
            {pttHookOk
              ? "Works system-wide, even when Rushlight isn't the focused window. Hold it to talk while you're in a voice room."
              : "The global key hook couldn't start on this machine, so push-to-talk only works while Rushlight is the focused window."}
          </p>
        </div>

        <div className="settings-section">
          <h2>skin</h2>
          <div className="tier-row">
            {['parchment', 'cool-slate'].map((s) => (
              <button
                key={s}
                type="button"
                className={'tier-chip' + (skin === s ? ' active' : '')}
                onClick={() => onChangeSkin(s)}
              >
                {s === 'parchment' ? 'Parchment' : 'Cool Slate'}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <h2>mode</h2>
          <div className="tier-row">
            {['dark', 'light'].map((m) => (
              <button
                key={m}
                type="button"
                className={'tier-chip' + (mode === m ? ' active' : '')}
                onClick={() => onChangeMode(m)}
              >
                {m[0].toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <h2>mic / speaker devices</h2>
          <MicSpeakerCheck />
        </div>

        <p className="settings-note">Rushlight {version ? 'v' + version : ''}</p>

        <button type="button" className="btn-secondary" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  )
}

export default SettingsScreen
