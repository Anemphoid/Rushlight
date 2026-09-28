import RushlightLogo from './RushlightLogo'

// Discord-style rail: home on top, one button per server you belong to,
// and a plus at the bottom to create or join another.
function ServerRail({ servers, currentServerId, onSelect, onHome, onAdd }) {
  return (
    <div className="server-rail">
      <button
        type="button"
        className={'rail-btn rail-home' + (currentServerId == null ? ' active' : '')}
        title="Home"
        onClick={onHome}
      >
        <RushlightLogo size={20} />
      </button>
      <div className="rail-divider" />
      {servers.map((s) => (
        <button
          key={s.id}
          type="button"
          className={'rail-btn' + (s.id === currentServerId ? ' active' : '')}
          title={s.name}
          onClick={() => onSelect(s.id)}
        >
          {s.name.charAt(0).toUpperCase()}
        </button>
      ))}
      <button
        type="button"
        className="rail-btn rail-add"
        title="Create or join a server"
        onClick={onAdd}
      >
        +
      </button>
    </div>
  )
}

export default ServerRail
