import Credits from '../components/Credits'
import { useState, useEffect, useSyncExternalStore } from 'react'
import * as voice from '../voice'
import MicSpeakerCheck from '../components/MicSpeakerCheck'
import AccountSecuritySection from '../components/AccountSecuritySection'
import DevicesSection from '../components/DevicesSection'
import RecoveryKeyScreen from '../components/RecoveryKeyScreen'
import * as api from '../api'
import { formatKeyLabel } from '../keys'
import * as unread from '../unread'
import { SKINS, MODES } from '../skins'
import PageShell from '../components/PageShell'
import Segmented from '../components/Segmented'
import * as songPrefs from '../songPrefs'

const DENSITY_TIERS = ['compact', 'cozy', 'comfortable']
const ICON_SIZE_TIERS = ['small', 'medium', 'large']
const cap = (t) => t[0].toUpperCase() + t.slice(1)
const tierOptions = (tiers) => tiers.map((t) => ({ value: t, label: cap(t) }))

const SECTIONS = [
  { id: 'appearance', label: 'Appearance', icon: 'appearance' },
  { id: 'audio', label: 'Audio', icon: 'mic' },
  { id: 'ptt', label: 'Push to talk', icon: 'keys' },
  { id: 'music', label: 'Music', icon: 'music' },
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
  { id: 'account', label: 'Account', icon: 'account' },
  { id: 'about', label: 'About', icon: 'info' }
]

function Row({ title, hint, children }) {
  return (
    <div className="rl-row">
      <div className="rl-row-text">
        <h3>{title}</h3>
        {hint && <p>{hint}</p>}
      </div>
      <div className="rl-row-control">{children}</div>
    </div>
  )
}

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
  sessionToken,
  accountId,
  onSessionChanged,
  onAccountDeleted,
  onOpenOwnerTools,
  onBack
}) {
  const [newKey, setNewKey] = useState(null) // a recovery key just made, shown until it is confirmed or dropped
  const [listening, setListening] = useState(false)
  const [keyError, setKeyError] = useState('')
  const micMode = useSyncExternalStore(voice.subscribe, voice.getSnapshot).micMode
  const [version, setVersion] = useState('')
  const [section, setSection] = useState('appearance')
  const toastOn = useSyncExternalStore(songPrefs.subscribe, songPrefs.songToastEnabled)
  const [notifyOn, setNotifyOn] = useState(() => unread.notificationsEnabled())

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

  if (newKey) {
    return (
      <RecoveryKeyScreen
        title="Save your new recovery key"
        recoveryKey={newKey}
        confirmLabel="I saved it, use this key"
        cancelLabel="Cancel, keep my old key"
        onCancel={() => setNewKey(null)}
        onConfirm={async () => {
          await api.ackRecoveryKey(sessionToken)
          setNewKey(null)
        }}
      />
    )
  }

  const sections = SECTIONS.filter((x) => x.id !== 'account' || sessionToken)

  return (
    <PageShell title="Settings" onBack={onBack} sections={sections} activeSection={section} onSelectSection={setSection} escDisabled={listening}>
      {section === 'appearance' && (
        <>
          <h2 className="rl-section-title">Appearance</h2>
          <p className="rl-section-sub">How Rushlight looks on this computer.</p>
          <div className="rl-skin-cards" role="group" aria-label="Skin">
            {SKINS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={'rl-skin-card' + (skin === s.id ? ' on' : '')}
                aria-pressed={skin === s.id}
                onClick={() => onChangeSkin(s.id)}
              >
                <span className="rl-skin-swatch" style={{ background: s.preview.bg }}>
                  <span style={{ background: s.preview.panel }} />
                  <i style={{ background: s.preview.accent }} />
                  <b style={{ background: s.preview.text }} />
                </span>
                <span className="rl-skin-name">{s.name}</span>
                <span className="rl-skin-blurb">{s.blurb}</span>
              </button>
            ))}
          </div>
          <Row title="Mode" hint="Dark or light, in either skin.">
            <Segmented label="Mode" value={mode} options={MODES.map((m) => ({ value: m, label: cap(m) }))} onChange={onChangeMode} />
          </Row>
          <Row title="Density" hint="How much fits on the screen.">
            <Segmented label="Density" value={density} options={tierOptions(DENSITY_TIERS)} onChange={onChangeDensity} />
          </Row>
          <Row title="Icon size" hint="The size of the buttons in the channel list.">
            <Segmented label="Icon size" value={iconSize} options={tierOptions(ICON_SIZE_TIERS)} onChange={onChangeIconSize} />
          </Row>
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
        </>
      )}

      {section === 'audio' && (
        <>
          <h2 className="rl-section-title">Audio</h2>
          <p className="rl-section-sub">Your microphone and speakers.</p>
          <Row
            title="Microphone mode"
            hint="Push to talk: your mic is live only while you hold the key. Open mic: it stays live the whole time you're in a voice room. Takes effect immediately, even mid-call."
          >
            <Segmented
              label="Microphone mode"
              value={micMode}
              options={[
                { value: 'ptt', label: 'Push to talk' },
                { value: 'open', label: 'Open mic' }
              ]}
              onChange={(v) => voice.setMicMode(v)}
            />
          </Row>
          <h3 className="rl-subhead">Mic / speaker devices</h3>
          <MicSpeakerCheck />
        </>
      )}

      {section === 'ptt' && (
        <>
          <h2 className="rl-section-title">Push to talk</h2>
          <p className="rl-section-sub">Hold this key to talk while you're in a voice room.</p>
          <button type="button" className={'key-capture-btn' + (listening ? ' listening' : '')} onClick={() => setListening(true)}>
            {listening ? 'Press a key…' : formatKeyLabel(pttKey)}
          </button>
          {keyError && <p className="error-text">{keyError}</p>}
          <p className="settings-note">
            {pttHookOk
              ? "Works system-wide, even when Rushlight isn't the focused window. Hold it to talk while you're in a voice room."
              : "The global key hook couldn't start on this machine, so push-to-talk only works while Rushlight is the focused window."}
          </p>
        </>
      )}

      {section === 'music' && (
        <>
          <h2 className="rl-section-title">Music</h2>
          <p className="rl-section-sub">How Jellybox shows up for you.</p>
          <Row title="Song pop-up" hint="A small card in the corner when the song changes.">
            <Segmented
              label="Song pop-up"
              value={toastOn}
              options={[
                { value: true, label: 'On' },
                { value: false, label: 'Off' }
              ]}
              onChange={songPrefs.setSongToastEnabled}
            />
          </Row>
        </>
      )}

      {section === 'notifications' && (
        <>
          <h2 className="rl-section-title">Notifications</h2>
          <p className="rl-section-sub">Unread dots in the tree are always shown.</p>
          <Row title="Desktop notifications" hint="A notification for new messages in text rooms you don’t have open, or in the open room while Rushlight isn’t focused.">
            <Segmented
              label="Desktop notifications"
              value={notifyOn}
              options={[
                { value: true, label: 'On' },
                { value: false, label: 'Off' }
              ]}
              onChange={(value) => {
                setNotifyOn(value)
                unread.setNotificationsEnabled(value)
              }}
            />
          </Row>
        </>
      )}

      {section === 'account' && sessionToken && (
        <>
          <h2 className="rl-section-title">Account</h2>
          <AccountSecuritySection
            sessionToken={sessionToken}
            onSessionChanged={onSessionChanged}
            onKeyIssued={setNewKey}
            onAccountDeleted={onAccountDeleted}
            onOpenOwnerTools={onOpenOwnerTools}
          />
          <DevicesSection sessionToken={sessionToken} accountId={accountId} />
        </>
      )}

      {section === 'about' && (
        <>
          <h2 className="rl-section-title">About</h2>
          <p className="rl-section-sub">Rushlight {version ? 'v' + version : ''}</p>
          <Credits />
        </>
      )}
    </PageShell>
  )
}

export default SettingsScreen
