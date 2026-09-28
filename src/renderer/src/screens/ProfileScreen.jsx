import { useState } from 'react'
import Avatar from '../components/Avatar'

// No real image-upload/avatar-storage backend exists yet, so this is the
// honest interim system: pick a solid color, shown with your initial —
// same pattern Discord/Slack fall back to before a custom image exists.
const AVATAR_COLORS = ['#d9903f', '#e0836b', '#4a9d8f', '#7a9d6e', '#6e89b8', '#a878b8']

function ProfileScreen({ currentName, currentAvatarColor, onBack, onSave }) {
  const [name, setName] = useState(currentName || '')
  const [avatarColor, setAvatarColor] = useState(currentAvatarColor || null)

  function handleSave(e) {
    e.preventDefault()
    if (!name.trim()) return
    onSave({ name: name.trim(), avatarColor })
  }

  return (
    <div className="screen">
      <div className="card">
        <h1>Your profile</h1>
        <p className="sub">
          Customize how you appear here. Full custom-image avatars need real
          account storage, which doesn't exist yet — colored avatars are the
          interim system.
        </p>

        <form onSubmit={handleSave}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <Avatar color={avatarColor} name={name} size={56} />
          </div>

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
    </div>
  )
}

export default ProfileScreen
