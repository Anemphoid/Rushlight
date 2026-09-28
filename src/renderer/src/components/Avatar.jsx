import RushlightLogo from './RushlightLogo'

function Avatar({ color, name, size = 28, className = '' }) {
  const fontSize = Math.max(9, Math.round(size * 0.42))
  return (
    <div
      className={'avatar-circle ' + className}
      style={{ width: size, height: size, background: color || 'var(--bg)' }}
    >
      {color ? (
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
