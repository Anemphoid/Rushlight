import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../components/Icon'
import VisualizerCanvas from './VisualizerCanvas'
import { loadPrefs, savePrefs, STYLES } from './prefs'
import { supportsWebGL2 } from './milkdrop'

const HIDE_AFTER_MS = 3000 // in full screen, the buttons fade away after this long without the mouse moving

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
// small window in the panel, so the chat stays usable: simple bars or a waveform, or the real Milkdrop
// visualizer (Butterchurn) in miniature. Clicking the window opens the large view. It draws only while it is on,
// Jellybox is playing, the window is visible and the person can hear it (not deafened).
// search: { canSearch, run(query) -> results, act(body) } lets an admin look up a song from the full screen view.
function Visualizer({ playing, botAudioId, deafened, search, player, onEnabledChange, windowHost }) {
  const [prefs, setPrefs] = useState(() => loadPrefs())
  const [large, setLarge] = useState(false)
  const [smallVisible, setSmallVisible] = useState(true)
  const [smallPreset, setSmallPreset] = useState('')
  const reducedMotion = useReducedMotion()
  const windowVisible = useWindowVisible()
  const [webgl] = useState(() => supportsWebGL2())
  const smallRef = useRef(null)
  const smallControl = useRef(null)
  const canMilkdrop = webgl && !reducedMotion
  // a saved choice of the real visualizer falls back to the bars where it cannot run
  const style = prefs.style === 'milkdrop' && !canMilkdrop ? 'bars' : prefs.style
  const styleChoices = STYLES.filter((s) => s !== 'milkdrop' || canMilkdrop)

  const update = useCallback((patch) => {
    setPrefs((p) => {
      const next = { ...p, ...patch }
      savePrefs(next)
      return next
    })
  }, [])

  // the small window only draws while it can be seen in the panel
  useEffect(() => {
    const el = smallRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver(([entry]) => setSmallVisible(entry.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [prefs.enabled])

  useEffect(() => {
    if (onEnabledChange) onEnabledChange(prefs.enabled)
  }, [prefs.enabled, onEnabledChange])

  const live = prefs.enabled && playing && !!botAudioId && !deafened && windowVisible
  let status = ''
  if (prefs.enabled) {
    if (!botAudioId) status = 'Waiting for Jellybox. You need to be connected to voice to see it.'
    else if (deafened) status = 'You are deafened, so nothing is drawn.'
    else if (!playing) status = 'Nothing is playing.'
  }
  const nextStyle = () => update({ style: styleChoices[(styleChoices.indexOf(style) + 1) % styleChoices.length] })

  const smallWindow = prefs.enabled && (
    <div className="viz-small" ref={smallRef} onClick={() => setLarge(true)} title="Click for the big view" role="button" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setLarge(true)}>
      <VisualizerCanvas
        mode={style === 'milkdrop' ? 'milkdrop' : 'simple'}
        style={style === 'milkdrop' ? 'bars' : style}
        active={live && smallVisible && !large}
        botAudioId={botAudioId}
        reducedMotion={reducedMotion}
        controlRef={smallControl}
        onPreset={setSmallPreset}
        shuffle={prefs.shuffle}
      />
      {status && <div className="viz-message">{status}</div>}
      {style === 'milkdrop' && smallPreset && !status && <div className="viz-small-name">{smallPreset}</div>}
      <div className="viz-small-tools" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="viz-chip" onClick={nextStyle} title="Bars, waveform, or the real Milkdrop visualizer">
          style: {style === 'milkdrop' ? 'milkdrop' : style}
        </button>
        {style === 'milkdrop' && (
          <button type="button" className="viz-chip" onClick={() => smallControl.current?.next()}>
            next
          </button>
        )}
      </div>
      {reducedMotion && <div className="viz-small-note">Reduced motion is on in your system, so this is calmer.</div>}
    </div>
  )

  return (
    <div className="viz">
      <button type="button" className="viz-toggle" aria-pressed={prefs.enabled} onClick={() => update({ enabled: !prefs.enabled })}>
        <Icon name="bars" size={16} strokeWidth={2} />
        <span className="viz-toggle-label">{prefs.enabled ? 'Visualizer: on' : 'Visualizer'}</span>
        <span className="viz-switch" aria-hidden="true" />
      </button>
      {smallWindow && (windowHost === undefined ? smallWindow : windowHost ? createPortal(smallWindow, windowHost) : null)}
      {prefs.enabled && large && (
        <LargeView prefs={prefs} update={update} live={live} status={status} botAudioId={botAudioId} reducedMotion={reducedMotion} webgl={webgl} search={search} player={player} onClose={() => setLarge(false)} />
      )}
    </div>
  )
}

function LargeView({ prefs, update, live, status, botAudioId, reducedMotion, webgl, search, player, onClose }) {
  const rootRef = useRef(null)
  const controlRef = useRef(null)
  const [useSimple, setUseSimple] = useState(false)
  const [current, setCurrent] = useState('')
  const [flash, setFlash] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [search2, setSearch] = useState('')
  const [favOnly, setFavOnly] = useState(false)
  const [, bump] = useState(0)
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement) // real full screen, from the Full screen button
  const leavingByButton = useRef(false)
  const [awake, setAwake] = useState(true) // the buttons are showing
  const flashTimer = useRef(null)
  const idleTimer = useRef(null)
  const overControls = useRef(false)
  const milkdrop = webgl && !reducedMotion && !useSimple
  const simpleStyle = prefs.style === 'milkdrop' ? 'bars' : prefs.style

  const onPreset = useCallback((name) => {
    setCurrent(name)
    setFlash(name)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(''), 3000)
    bump((n) => n + 1)
  }, [])
  useEffect(() => () => clearTimeout(flashTimer.current), [])

  // In full screen the buttons fade away a few seconds after the mouse last moved, and come back when it moves, so
  // they never sit over the picture. They stay while the mouse is on them, while the list is open, or while typing.
  const wake = useCallback(() => {
    setAwake(true)
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => {
      // a button that was just clicked keeps focus, so only a text box being typed in holds the buttons up
      const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) && document.activeElement.closest('.viz-controls, .viz-list')
      if (!overControls.current && !typing) setAwake(false)
    }, HIDE_AFTER_MS)
  }, [])
  // the buttons only fade in full window; windowed, they stay
  useEffect(() => {
    if (fullscreen) wake()
    else {
      clearTimeout(idleTimer.current)
      setAwake(true)
    }
    return () => clearTimeout(idleTimer.current)
  }, [fullscreen, wake])
  const controlsShowing = !fullscreen || awake || listOpen || !!results

  useEffect(() => {
    const onKey = (e) => {
      if (fullscreen) wake()
      const typing = e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)
      if (e.key === 'Escape') {
        if (results) setResults(null)
        else onClose()
      } else if (!typing && e.key === 'ArrowRight') controlRef.current?.next()
      else if (!typing && e.key === 'ArrowLeft') controlRef.current?.previous()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, fullscreen, wake, results])

  // Full screen is the browser's own: the view goes over the whole screen, the title bar and the rail with it. The
  // browser takes Esc itself to leave it, which would drop to the windowed view; Esc is meant to close the view
  // from either, so a leave that did not come from the button closes it.
  useEffect(() => {
    const onChange = () => {
      const fs = document.fullscreenElement === rootRef.current
      setFullscreen(fs)
      if (!fs) {
        if (leavingByButton.current) leavingByButton.current = false
        else if (wasFull.current) onClose()
      }
      wasFull.current = fs
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [onClose])
  const wasFull = useRef(false)
  // leave full screen when the big view goes away
  useEffect(
    () => () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    },
    []
  )
  function toggleFullscreen() {
    if (document.fullscreenElement) {
      leavingByButton.current = true
      document.exitFullscreen().catch(() => {
        leavingByButton.current = false
      })
    } else rootRef.current?.requestFullscreen?.().catch(() => {})
  }

  async function runSearch(e) {
    e.preventDefault()
    if (!searchText.trim() || !search) return
    setSearching(true)
    setSearchError('')
    try {
      setResults(await search.run(searchText.trim()))
    } catch (err) {
      setSearchError(err.message)
    } finally {
      setSearching(false)
    }
  }
  async function pick(body) {
    try {
      await search.act(body)
      setResults(null)
      setSearchText('')
    } catch (err) {
      setSearchError(err.message)
    }
  }

  const names = controlRef.current ? controlRef.current.names : []
  const q = search2.trim().toLowerCase()
  const shown = names.filter((n) => (!favOnly || prefs.favourites.includes(n)) && (!q || n.toLowerCase().includes(q)))
  const isFav = current && prefs.favourites.includes(current)
  const toggleFav = (name) => update({ favourites: prefs.favourites.includes(name) ? prefs.favourites.filter((n) => n !== name) : [...prefs.favourites, name] })
  const nextSimple = () => update({ style: simpleStyle === 'bars' ? 'wave' : 'bars' })

  // windowed, the big view fills everything right of the server rail (so the rail and its unread bubbles stay in
  // view); Full screen covers the whole screen
  const host = document.querySelector('.rail-content')
  const fade = controlsShowing ? '' : ' hidden'
  const hoverProps = {
    onMouseEnter: () => (overControls.current = true),
    onMouseLeave: () => {
      overControls.current = false
      if (fullscreen) wake()
    }
  }
  const pl = player && player.track ? player : null

  const view = (
    <div
      className={'viz-large' + (fullscreen ? ' viz-full' : ' viz-windowed') + (host ? '' : ' viz-nohost') + (controlsShowing ? '' : ' viz-idle')}
      ref={rootRef}
      role="dialog"
      aria-label="Visualizer"
      onMouseMove={fullscreen ? wake : undefined}
      onMouseDown={fullscreen ? wake : undefined}
    >
      <VisualizerCanvas
        mode={milkdrop ? 'milkdrop' : 'simple'}
        style={simpleStyle}
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

      <div className={'viz-controls viz-top' + fade} {...hoverProps}>
        {milkdrop ? (
          <>
            <button type="button" className="viz-btn viz-sq" aria-label="previous" title="Previous visual" onClick={() => controlRef.current?.previous()}>
              <Icon name="back" size={18} strokeWidth={2} />
            </button>
            <button type="button" className="viz-btn viz-sq" aria-label="next" title="Next visual" onClick={() => controlRef.current?.next()}>
              <Icon name="forward" size={18} strokeWidth={2} />
            </button>
            <button type="button" className="viz-btn" aria-pressed={prefs.shuffle} aria-label={'shuffle: ' + (prefs.shuffle ? 'on' : 'off')} onClick={() => update({ shuffle: !prefs.shuffle })}>
              Shuffle
            </button>
            <button type="button" className="viz-btn viz-sq" aria-label={isFav ? 'unfavourite' : 'favourite'} title={isFav ? 'Remove from favourites' : 'Add to favourites'} disabled={!current} aria-pressed={!!isFav} onClick={() => toggleFav(current)}>
              <Icon name="star" size={18} strokeWidth={2} />
            </button>
            <button type="button" className="viz-btn" aria-label="presets" aria-pressed={listOpen} onClick={() => setListOpen((o) => !o)}>
              Presets
            </button>
          </>
        ) : (
          <>
            <span className="viz-note">
              {!webgl ? 'This computer cannot run the full visualizer (it needs WebGL 2), so the simple styles are shown.' : reducedMotion ? 'Reduced motion is on in your system settings, so only the calm styles are shown.' : 'The full visualizer could not start, so the simple styles are shown.'}
            </span>
            <button type="button" className="viz-btn" onClick={nextSimple}>style: {simpleStyle}</button>
          </>
        )}
        <button type="button" className="viz-btn" aria-label={fullscreen ? 'exit full screen' : 'full screen'} onClick={toggleFullscreen}>
          {fullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
        <button type="button" className="viz-btn viz-sq" aria-label="close (Esc)" title="Close (Esc)" onClick={onClose}>
          <Icon name="close" size={18} strokeWidth={2} />
        </button>
      </div>

      <div className={'viz-controls viz-bottom' + fade} {...hoverProps}>
        <div className="viz-track">
          {pl && (
            <>
              <div className="viz-track-title">{pl.track.title}</div>
              <div className="viz-track-artist">{[pl.track.artist, pl.track.album].filter(Boolean).join(' · ')}</div>
            </>
          )}
        </div>
        {pl && pl.canControl && (
          <div className="viz-transport">
            <button type="button" className="viz-round" aria-label="prev" title="Restart the song; press again within 3 seconds to go back one" onClick={() => pl.act({ action: 'previous' })}>
              <Icon name="prev" size={16} strokeWidth={2} />
            </button>
            <button type="button" className="viz-round viz-main" aria-label={pl.paused ? 'play' : 'pause'} onClick={() => pl.act({ action: pl.paused ? 'resume' : 'pause' })}>
              <Icon name={pl.paused ? 'play' : 'pause'} size={20} strokeWidth={2} />
            </button>
            <button type="button" className="viz-round" aria-label="skip" title="Skip this song" onClick={() => pl.act({ action: 'skip' })}>
              <Icon name="next" size={16} strokeWidth={2} />
            </button>
          </div>
        )}
        {search && search.canSearch && (
          <form className="viz-search" onSubmit={runSearch}>
            <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search for a song" aria-label="Search for a song" />
            <button type="submit" className="viz-btn" disabled={searching || !searchText.trim()}>Search</button>
          </form>
        )}
        <span className="viz-esc">Esc to close</span>
      </div>
      {(results || searchError) && (
        <div className="viz-results" onMouseEnter={() => (overControls.current = true)} onMouseLeave={() => (overControls.current = false)}>
          {searchError && <div className="error-text">{searchError}</div>}
          {results && results.length === 0 && <div className="settings-note">Nothing found.</div>}
          {results && (
            <ul>
              {results.map((r) => (
                <li key={r.id}>
                  <span>
                    {r.title}
                    <span className="settings-note" style={{ margin: 0 }}>
                      {' '}
                      {r.kind}
                      {r.artist ? ` by ${r.artist}` : ''}
                    </span>
                  </span>
                  <span className="np-result-actions">
                    <button type="button" className="link-btn" onClick={() => pick({ action: 'play-now', itemId: r.id, kind: r.kind })}>Play now</button>
                    <button type="button" className="link-btn" onClick={() => pick({ action: 'queue', itemId: r.id, kind: r.kind })}>Add to queue</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="link-btn" onClick={() => { setResults(null); setSearchError('') }}>close results</button>
        </div>
      )}
      {milkdrop && listOpen && (
        <div className="viz-list" onMouseEnter={() => (overControls.current = true)} onMouseLeave={() => (overControls.current = false)}>
          <input value={search2} onChange={(e) => setSearch(e.target.value)} placeholder="Search presets" autoFocus />
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
  return host ? createPortal(view, host) : view
}

export default Visualizer
