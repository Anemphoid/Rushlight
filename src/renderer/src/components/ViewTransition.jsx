import { useRef, useState, useLayoutEffect, useEffect } from 'react'

// Motion: moving between screens is a gentle crossfade with a small slide (see styles/motion.css). The screen being
// left stays on screen, under the new one, until the new one has arrived, so there is never a blank frame. Under
// reduced motion the swap is instant.
export const MOVE_MS = 300
export const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function ViewTransition({ viewKey, children }) {
  const [leaving, setLeaving] = useState(null) // { key, node } of the screen on its way out
  const committed = useRef({ key: viewKey, node: children })

  useLayoutEffect(() => {
    const prev = committed.current
    if (prev.key !== viewKey && !reducedMotion()) setLeaving(prev)
    committed.current = { key: viewKey, node: children }
  })

  useEffect(() => {
    if (!leaving) return undefined
    const t = setTimeout(() => setLeaving(null), MOVE_MS)
    return () => clearTimeout(t)
  }, [leaving])

  // both layers are keyed by their screen, so the one that is leaving keeps its state (what was typed, scroll)
  return (
    <div className="vt">
      {leaving && leaving.key !== viewKey && (
        <div className="vt-layer vt-out" key={leaving.key} aria-hidden="true">
          {leaving.node}
        </div>
      )}
      <div className="vt-layer vt-in" key={viewKey}>
        {children}
      </div>
    </div>
  )
}

// A full-page screen laid over what is underneath (Settings, Profile, Admin Tools over the server). It fades and
// slides in; closing plays the same movement in reverse before it is removed. `onSettled(open)` says when the
// movement has finished, so the page below can be hidden once it is fully covered.
export function OverlayLayer({ show, viewKey, children, onSettled }) {
  const [mounted, setMounted] = useState(show)
  const last = useRef({ viewKey, node: children })
  if (show) last.current = { viewKey, node: children }

  useLayoutEffect(() => {
    if (show) setMounted(true)
  }, [show])

  useEffect(() => {
    if (show) {
      const t = setTimeout(() => onSettled && onSettled(true), reducedMotion() ? 0 : MOVE_MS)
      return () => clearTimeout(t)
    }
    if (!mounted) return undefined
    if (reducedMotion()) {
      setMounted(false)
      return undefined
    }
    const t = setTimeout(() => setMounted(false), MOVE_MS)
    return () => clearTimeout(t)
  }, [show, mounted, onSettled])

  if (!show && !mounted) return null
  const shown = show ? { viewKey, node: children } : last.current
  return (
    <div className={'overlay-layer ' + (show ? 'is-in' : 'is-out')}>
      <div className="overlay-inner" key={shown.viewKey}>
        {shown.node}
      </div>
    </div>
  )
}

// For a dialog: `close()` plays the closing movement, then calls onClose.
export function useClosing(onClose) {
  const [closing, setClosing] = useState(false)
  const done = useRef(false)
  function close() {
    if (done.current) return
    done.current = true
    if (reducedMotion()) return onClose()
    setClosing(true)
    setTimeout(onClose, 200)
  }
  return [closing, close]
}

export default ViewTransition
