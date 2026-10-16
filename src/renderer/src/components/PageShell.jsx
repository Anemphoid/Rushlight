import { useEffect, useRef } from 'react'
import Icon from './Icon'

// The layout of every full-screen page (Settings now; Profile and Admin Tools next): a header under the title bar
// with Back at the top left, the title beside it (Esc also goes back; it is not spelled out on the page), then an optional list of
// sections on the left with the chosen section on the right. The body scrolls under the header, so nothing can sit
// on top of the content (the old sticky Back bar did). Esc does what Back does, except while a dialog or a text
// field has the keyboard, or when the page asks for it to wait (escDisabled).
function PageShell({ title, onBack, sections, activeSection, onSelectSection, escDisabled = false, children }) {
  const backRef = useRef(onBack)
  backRef.current = onBack

  useEffect(() => {
    if (escDisabled) return undefined
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return
      const t = e.target
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if (typing) return
      if (document.querySelector('[role="dialog"], .poll-backdrop')) return
      e.preventDefault()
      backRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [escDisabled])

  return (
    <div className="rl-page">
      <header className="rl-page-header">
        <button type="button" className="rl-back" onClick={() => onBack()}>
          <Icon name="back" size={16} strokeWidth={2.2} />
          Back
        </button>
        <h1>{title}</h1>
      </header>
      <div className="rl-page-main">
        {sections && (
          <nav className="rl-page-nav" aria-label={`${title} sections`}>
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                className="rl-nav-item"
                aria-current={s.id === activeSection ? 'page' : undefined}
                onClick={() => onSelectSection(s.id)}
              >
                {s.icon && <Icon name={s.icon} size={17} />}
                {s.label}
              </button>
            ))}
          </nav>
        )}
        <div className="rl-page-body">
          <div className="rl-page-content">{children}</div>
        </div>
      </div>
    </div>
  )
}

export default PageShell
