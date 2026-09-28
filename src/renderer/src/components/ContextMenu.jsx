function ContextMenu({ x, y, items, onClose }) {
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
      <div className="context-menu" style={{ top: y, left: x }}>
        {items.map((item, i) => (
          <button
            key={i}
            type="button"
            className="context-menu-item"
            onClick={() => {
              item.onClick()
              onClose()
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  )
}

export default ContextMenu
