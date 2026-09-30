import { useState } from 'react'
import Avatar from '../components/Avatar'
import AvatarCropper from '../components/AvatarCropper'
import * as api from '../api'
import { avatarUrl } from '../api'

const AVATAR_COLORS = ['#d9903f', '#e0836b', '#4a9d8f', '#7a9d6e', '#6e89b8', '#a878b8']

function ProfileScreen({
  currentName,
  currentAvatarColor,
  sessionToken,
  accountId,
  avatarUpdatedAt,
  onAvatarChanged,
  onBack,
  onSave
}) {
  const [name, setName] = useState(currentName || '')
  const [avatarColor, setAvatarColor] = useState(currentAvatarColor || null)
  const [showCropper, setShowCropper] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarError, setAvatarError] = useState('')

  const hasCustomImage = !!avatarUpdatedAt
  const previewImageUrl = avatarUrl(accountId, avatarUpdatedAt)

  function handleSave(e) {
    e.preventDefault()
    if (!name.trim()) return
    onSave({ name: name.trim(), avatarColor })
  }

  async function handleCropDone({ base64, mime }) {
    setShowCropper(false)
    setAvatarBusy(true)
    setAvatarError('')
    try {
      const result = await api.uploadAvatar(sessionToken, base64, mime)
      onAvatarChanged(result.avatarUpdatedAt)
    } catch (err) {
      setAvatarError(err.message)
    } finally {
      setAvatarBusy(false)
    }
  }

  async function handleRemoveImage() {
    setAvatarBusy(true)
    setAvatarError('')
    try {
      await api.deleteAvatar(sessionToken)
      onAvatarChanged(null)
    } catch (err) {
      setAvatarError(err.message)
    } finally {
      setAvatarBusy(false)
    }
  }

  return (
    <div className="screen">
      <div className="card">
        <h1>Your profile</h1>
        <p className="sub">Customize how you appear here.</p>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <Avatar color={avatarColor} name={name} imageUrl={previewImageUrl} size={72} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
          <button
            type="button"
            className="btn-secondary"
            disabled={avatarBusy}
            onClick={() => setShowCropper(true)}
          >
            {hasCustomImage ? 'Change picture' : 'Upload a picture'}
          </button>
          {hasCustomImage && (
            <button type="button" className="link-btn" disabled={avatarBusy} onClick={handleRemoveImage}>
              Remove
            </button>
          )}
        </div>
        {avatarError && <p className="error-text" style={{ textAlign: 'center' }}>{avatarError}</p>}

        <p className="settings-note" style={{ textAlign: 'center', marginBottom: 8 }}>
          {hasCustomImage
            ? "This is what people see next to your name and in chat. The color below is only used when there's no picture."
            : 'No picture yet — pick a color below, or upload one above.'}
        </p>

        <form onSubmit={handleSave}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 20 }}>
            <button
              type="button"
              onClick={() => setAvatarColor(null)}
              title="Use app logo"
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                border: avatarColor === null ? '2px solid var(--text)' : '1px solid var(--line)',
                background: 'var(--bg)',
                cursor: 'pointer',
                padding: 0
              }}
            />
            {AVATAR_COLORS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setAvatarColor(c)}
                title={c}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  border: avatarColor === c ? '2px solid var(--text)' : '1px solid var(--line)',
                  background: c,
                  cursor: 'pointer',
                  padding: 0
                }}
              />
            ))}
          </div>

          <div className="field">
            <label>Display name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>

          <button type="submit" className="btn-primary">
            Save
          </button>
        </form>

        <button type="button" className="link-btn" onClick={onBack}>
          Back
        </button>
      </div>

      {showCropper && <AvatarCropper onDone={handleCropDone} onCancel={() => setShowCropper(false)} />}
    </div>
  )
}

export default ProfileScreen
