import { useState, useEffect } from 'react'
import RushlightLogo from './RushlightLogo'

// imageUrl takes priority when present; falls back to exactly the previous
// color-and-initial (or logo) behavior otherwise. A load failure (a stale
// cached URL, a server that's gone) genuinely falls back to that same
// rendering rather than showing a broken-image icon or an empty circle.
function Avatar({ color, name, imageUrl, size = 28, className = '' }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [imageUrl]) // a new URL deserves a fresh attempt

  const fontSize = Math.max(9, Math.round(size * 0.42))
  const showImage = imageUrl && !failed

  return (
    <div
      className={'avatar-circle' + (className ? ' ' + className : '')}
      style={{ width: size, height: size, background: showImage ? undefined : color || 'var(--bg)' }}
    >
      {showImage ? (
        <img
          src={imageUrl}
          alt=""
          width={size}
          height={size}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={() => setFailed(true)}
        />
      ) : color ? (
        <span style={{ fontWeight: 700, fontSize, color: 'var(--on-accent)' }}>
          {(name || '?').charAt(0).toUpperCase()}
        </span>
      ) : (
        <RushlightLogo size={Math.round(size * 0.5)} />
      )}
    </div>
  )
}

export default Avatar
