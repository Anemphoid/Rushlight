import { useState, useEffect, useRef, useCallback } from 'react'
import VisualizerCanvas from './VisualizerCanvas'
import { loadPrefs, savePrefs, STYLES } from './prefs'
import { supportsWebGL2 } from './milkdrop'

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return undefined
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

function useWindowVisible() {
  const [visible, setVisible] = useState(document.visibilityState !== 'hidden')
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return visible
}

// The visualizer for Jellybox's panel. Off until someone turns it on (per person, remembered). On, it is a
// small view in the panel; clicking it opens the large view. It draws only while it is on, Jellybox is
// playing, the window is visible and the person can hear it (not deafened).
function Visualizer({ playing, botAudioId, deafened }) {
  const [prefs, setPrefs] = useState(() => loadPrefs())
  const [large, setLarge] = useState(false)
  const [smallVisible, setSmallVisible] = useState(true)
  const reducedMotion = useReducedMotion()
  const windowVisible = useWindowVisible()
  const smallRef = useRef(null)

  const update = useCallback((patch) => {
    setPrefs((p) => {
      const next = { ...p, ...patch }
      savePrefs(next)
      return next
    })
  }, [])

  // the small view only draws while it can be seen in the panel
  useEffect(() => {
    const el = smallRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver(([entry]) => setSmallVisible(entry.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [prefs.enabled])

  const live = prefs.enabled && playing && !!botAudioId && !deafened && windowVisible
  let status = ''
  if (prefs.enabled) {
    if (!botAudioId) status = 'Waiting for Jellybox. You need to be connected to voice to see it.'
    else if (deafened) status = 'You are deafened, so nothing is drawn.'
    else if (!playing) status = 'Nothing is playing.'
  }

  return (
    <div className="viz">
      <div className="viz-bar">
        <button type="button" className="btn-secondary np-btn" aria-pressed={prefs.enabled} onClick={() => update({ enabled: !prefs.enabled })}>
          {prefs.enabled ? 'Visualizer: on' : 'Visualizer'}
        </button>
        {prefs.enabled && (
          <button type="button" className="btn-secondary np-btn" onClick={() => update({ style: STYLES[(STYLES.indexOf(prefs.style) + 1) % STYLES.length] })}>
            style: {prefs.style}
          </button>
        )}
        {prefs.enabled && reducedMotion && <span className="settings-note" style={{ margin: 0 }}>Reduced motion is on in your system, so this is calmer.</span>}
      </div>
      {prefs.enabled && (
        <div className="viz-small" ref={smallRef} onClick={() => setLarge(true)} title="Click for the big view" role="button" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setLarge(true)}>
          <VisualizerCanvas mode="simple" style={prefs.style} active={live && smallVisible && !large} botAudioId={botAudioId} reducedMotion={reducedMotion} />
          {status && <div className="viz-message">{status}</div>}
        </div>
      )}
      {prefs.enabled && large && (
        <LargeView prefs={prefs} update={update} live={live} status={status} botAudioId={botAudioId} reducedMotion={reducedMotion} onClose={() => setLarge(false)} />
      )}
    </div>
  )
}

function LargeView({ prefs, update, live, status, botAudioId, reducedMotion, onClose }) {
  const rootRef = useRef(null)
  const controlRef = useRef(null)
  const [webgl] = useState(() => supportsWebGL2())
  const [useSimple, setUseSimple] = useState(false)
  const [current, setCurrent] = useState('')
  const [flash, setFlash] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [favOnly, setFavOnly] = useState(false)
  const [, bump] = useState(0)
  const flashTimer = useRef(null)
  const milkdrop = webgl && !reducedMotion && !useSimple

  const onPreset = useCallback((name) => {
    setCurrent(name)
    setFlash(name)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(''), 3000)
    bump((n) => n + 1)
  }, [])
  useEffect(() => () => clearTimeout(flashTimer.current), [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !document.fullscreenElement) onClose()
      else if (e.key === 'ArrowRight') controlRef.current?.next()
      else if (e.key === 'ArrowLeft') controlRef.current?.previous()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // leave full screen when the large view goes away
  useEffect(() => () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else rootRef.current?.requestFullscreen?.().catch(() => {})
  }

  const names = controlRef.current ? controlRef.current.names : []
  const q = search.trim().toLowerCase()
  const shown = names.filter((n) => (!favOnly || prefs.favourites.includes(n)) && (!q || n.toLowerCase().includes(q)))
  const isFav = current && prefs.favourites.includes(current)
  const toggleFav = (name) => update({ favourites: prefs.favourites.includes(name) ? prefs.favourites.filter((n) => n !== name) : [...prefs.favourites, name] })

  return (
    <div className="viz-large" ref={rootRef} role="dialog" aria-label="Visualizer">
      <VisualizerCanvas
        mode={milkdrop ? 'milkdrop' : 'simple'}
        style={prefs.style}
        active={live}
        botAudioId={botAudioId}
        reducedMotion={reducedMotion}
        controlRef={controlRef}
        onPreset={onPreset}
        shuffle={milkdrop && prefs.shuffle}
        onError={() => setUseSimple(true)}
        className="viz-canvas-large"
      />
      {flash && <div className="viz-flash">{flash}</div>}
      {status && <div className="viz-message viz-message-large">{status}</div>}
      <div className="viz-controls">
        {milkdrop ? (
          <>
            <button type="button" className="btn-secondary np-btn" onClick={() => controlRef.current?.previous()}>previous</button>
            <button type="button" className="btn-secondary np-btn" onClick={() => controlRef.current?.next()}>next</button>
            <button type="button" className="btn-secondary np-btn" aria-pressed={prefs.shuffle} onClick={() => update({ shuffle: !prefs.shuffle })}>
              shuffle: {prefs.shuffle ? 'on' : 'off'}
            </button>
            <button type="button" className="btn-secondary np-btn" onClick={() => setListOpen((o) => !o)}>presets</button>
            <button type="button" className="btn-secondary np-btn" disabled={!current} onClick={() => toggleFav(current)}>{isFav ? 'unfavourite' : 'favourite'}</button>
          </>
        ) : (
          <>
            <button type="button" className="btn-secondary np-btn" onClick={() => update({ style: STYLES[(STYLES.indexOf(prefs.style) + 1) % STYLES.length] })}>style: {prefs.style}</button>
            <span className="viz-note">
              {!webgl ? 'This computer cannot run the full visualizer (it needs WebGL 2), so the simple styles are shown.' : reducedMotion ? 'Reduced motion is on in your system settings, so only the calm styles are shown.' : 'The full visualizer could not start, so the simple styles are shown.'}
            </span>
          </>
        )}
        <button type="button" className="btn-secondary np-btn" onClick={toggleFullscreen}>full screen</button>
        <button type="button" className="btn-secondary np-btn" onClick={onClose}>close (Esc)</button>
      </div>
      {milkdrop && listOpen && (
        <div className="viz-list">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search presets" autoFocus />
          <label className="viz-fav-only">
            <input type="checkbox" checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} /> favourites only
          </label>
          <ul>
            {shown.length === 0 && <li className="settings-note">{names.length ? 'No presets match.' : 'Presets are still loading.'}</li>}
            {shown.map((n) => (
              <li key={n} className={n === current ? 'current' : ''}>
                <button type="button" className="link-btn" onClick={() => controlRef.current?.load(n)}>{n}</button>
                <button type="button" className="link-btn" onClick={() => toggleFav(n)}>{prefs.favourites.includes(n) ? 'unfavourite' : 'favourite'}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default Visualizer
