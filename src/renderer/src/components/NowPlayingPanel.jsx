import { useState, useEffect, useRef, useSyncExternalStore } from 'react'
import * as voice from '../voice'
import Visualizer from '../visualizer/Visualizer'
import SongToast from './SongToast'
import BrowseSection from './BrowseSection'
import * as api from '../api'
import * as songPrefs from '../songPrefs'
import Icon from './Icon'
import { loadPrefs } from '../visualizer/prefs'
import { reducedMotion, MOVE_MS } from './ViewTransition'

const POLL_MS = 3000

function fmt(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Jellybox's column down the right side of a voice room. Everyone in the server sees what is playing and what is
// queued; only admins and the owner can press the buttons, search or browse the library. It is not there at all when
// nothing is linked or Jellybox is not in the room (a voice-only room is the exception for admins, who have no chat
// to type /play in, so they keep the thin tab and can start music from here). It folds to a thin line with a tab.
// The progress bar runs from the last reported position, so it moves smoothly between the few-second polls.
// While the column is showing, ask the window for its width on top of the chat's; hand it back after.
const COLUMN_WIDTH = 292
function WidenWindow({ extra }) {
  const animate = !reducedMotion()
  useEffect(() => {
    try {
      window.api?.windowWiden?.(extra, animate, true)
    } catch {
      // no window API (tests): nothing to widen
    }
  }, [extra, animate])
  useEffect(
    () => () => {
      try {
        window.api?.windowWiden?.(0, true)
      } catch {
        // ignore
      }
    },
    []
  )
  return null
}

function NowPlayingPanel({ sessionToken, serverId, space, voiceOnly = false }) {
  const [st, setSt] = useState(null)
  const [fetchedAt, setFetchedAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')
  const [cover, setCover] = useState(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [volume, setVolume] = useState(100)
  const draggingVolume = useRef(false)
  const [sheet, setSheet] = useState(null) // null = the player; 'browse' = search and library; 'queue' = the whole queue
  const [stageEl, setStageEl] = useState(null) // where the small visualizer window is drawn
  const [added, setAdded] = useState('')
  const [vizOn, setVizOn] = useState(() => loadPrefs().enabled)
  // open down the right side by default; fold it to a thin line with its tab. Remembered on this computer.
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('rushlight.jellyboxOpen') !== '0'
    } catch {
      return true
    }
  })
  const toastOn = useSyncExternalStore(songPrefs.subscribe, songPrefs.songToastEnabled)
  const [closing, setClosing] = useState(false) // the column is sliding shut (the window gives its room back with it)
  function toggleOpen() {
    try {
      localStorage.setItem('rushlight.jellyboxOpen', open ? '0' : '1')
    } catch {
      // not remembered
    }
    if (open && !reducedMotion()) {
      setClosing(true)
      setTimeout(() => {
        setOpen(false)
        setClosing(false)
      }, MOVE_MS)
    } else setOpen(!open)
  }
  useEffect(() => {
    if (!sheet) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) setSheet(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet])

  const alive = useRef(true)
  const v = useSyncExternalStore(voice.subscribe, voice.getSnapshot)

  useEffect(() => {
    alive.current = true
    setResults(null)
    setQuery('')
    setError('')
    async function poll() {
      try {
        const s = await api.getMusicState(sessionToken, space.type, space.id)
        if (!alive.current) return
        setSt(s)
        setFetchedAt(Date.now())
        if (!draggingVolume.current && typeof s.volume === 'number') setVolume(s.volume)
      } catch {
        // an older server has no music; stay hidden
        if (alive.current) setSt({ available: false })
      }
    }
    poll()
    const t = setInterval(poll, POLL_MS)
    return () => {
      alive.current = false
      clearInterval(t)
    }
  }, [sessionToken, space.type, space.id])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])

  const playing = st && st.nowPlaying
  const coverId = playing ? playing.id : null
  useEffect(() => {
    let url = null
    let cancelled = false
    setCover(null)
    if (coverId) {
      api.fetchMusicCover(sessionToken, serverId, coverId).then((u) => {
        if (cancelled) {
          if (u) URL.revokeObjectURL(u)
        } else {
          url = u
          setCover(u)
        }
      })
    }
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [sessionToken, serverId, coverId])

  const canControl = !!(st && st.canControl)
  // what the song pop-up watches: undefined until the first answer, null when Jellybox is not here or idle
  const toastTrack = st ? (st.available && st.active ? st.nowPlaying || null : null) : undefined
  const toast = <SongToast track={toastTrack} sessionToken={sessionToken} serverId={serverId} enabled={toastOn} />

  if (!st || !st.available || (!st.active && !(canControl && voiceOnly))) return toast

  const position = playing
    ? Math.min(playing.durationMs || Infinity, playing.positionMs + (st.state === 'playing' ? now - fetchedAt : 0))
    : 0
  const fraction = playing && playing.durationMs ? Math.min(1, position / playing.durationMs) : 0

  async function act(body, { rethrow = false } = {}) {
    setError('')
    try {
      const out = await api.musicControl(sessionToken, space.type, space.id, body)
      setSt({ ...out, canControl })
      setFetchedAt(Date.now())
      if (typeof out.volume === 'number') setVolume(out.volume)
    } catch (err) {
      setError(err.message)
      if (rethrow) throw err
    }
  }

  async function runSearch(e) {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    setError('')
    try {
      setResults((await api.searchMusic(sessionToken, serverId, query.trim())).results)
    } catch (err) {
      setError(err.message)
    } finally {
      setSearching(false)
    }
  }

  function seekFromClick(e) {
    if (!canControl || !playing || !playing.durationMs) return
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    act({ action: 'seek', value: Math.round(frac * playing.durationMs) })
  }

  // a round icon button; the words stay as its name for screen readers and the tooltip
  const iconBtn = (name, label, title, onClick, { disabled = false, pressed, kind = '' } = {}) => (
    <button
      type="button"
      className={'np-round ' + kind}
      aria-label={label}
      aria-pressed={pressed}
      title={canControl ? title : 'Only admins and the owner can use this'}
      disabled={!canControl || disabled}
      onClick={onClick}
    >
      <Icon name={name} size={kind === 'main' ? 20 : kind === 'small' ? 14 : 16} strokeWidth={2} />
    </button>
  )
  const btn = (label, title, onClick, disabled = false, pressed) => (
    <button type="button" className="btn-secondary np-btn" aria-pressed={pressed} title={canControl ? title : 'Only admins and the owner can use this'} disabled={!canControl || disabled} onClick={onClick}>
      {label}
    </button>
  )

  // folded: a thin line down the right edge with a tab to bring it back, and nothing else
  if (!open) {
    return (
      <>
        {toast}
        <div className="np-fold">
          <button type="button" className="np-tab" aria-label="Show Jellybox" title="Show Jellybox" onClick={toggleOpen}>
            <Icon name="back" size={14} strokeWidth={2.2} />
          </button>
        </div>
      </>
    )
  }

  const idle = st.active ? (
    <>Ready. Type /play in chat{canControl ? ', or pick something below' : ', or ask an admin'}.</>
  ) : (
    <>Jellybox is not in this room yet. Pick something below to bring it in.</>
  )

  // Search and the library are one sheet that takes the player's place while it is open (Esc or Back returns). A
  // song played from it closes it; one added to the queue stays, with a note, so several can be added.
  async function sheetAct(body) {
    await act(body)
    if (body.action === 'queue') {
      setAdded('Added to the queue')
      setTimeout(() => setAdded(''), 2000)
    } else if (body.action === 'play-now' || body.action === 'play-album') setSheet(null)
  }

  const next = st.queue[0]
  const more = st.queue.length - 1

  return (
    <>
      {toast}
      <aside className={'now-playing side' + (vizOn ? ' viz-on' : '') + (closing ? ' closing' : '')} aria-label="Jellybox">
        <WidenWindow extra={closing ? 0 : COLUMN_WIDTH} />
        <div className="np-header">
          <strong>Jellybox</strong>
          <span className="member-badge">bot</span>
          {playing && <span className="settings-note np-state">{st.state === 'paused' ? 'paused' : 'playing'}</span>}
          {canControl && (
            <button type="button" className="np-hbtn" aria-label="Search and library" title="Search and browse the library" onClick={() => setSheet('browse')}>
              <Icon name="search" size={16} strokeWidth={2} />
            </button>
          )}
          <button type="button" className="np-hbtn" aria-expanded="true" aria-label="Hide Jellybox" title="Fold this away" onClick={toggleOpen}>
            <Icon name="forward" size={16} strokeWidth={2} />
          </button>
        </div>

        <div className="np-body">
          <div className="np-stage" ref={setStageEl}>
            {playing ? (
              <>
                <div className="np-cover">{cover ? <img src={cover} alt="" /> : <Icon name="music" size={40} strokeWidth={1.4} />}</div>
                <div className="np-info">
                  <div className="np-title" title={playing.title}>{playing.title}</div>
                  <div className="np-artist">{[playing.artist, playing.album].filter(Boolean).join(' · ')}</div>
                </div>
              </>
            ) : (
              <div className="settings-note np-idle">{idle}</div>
            )}
          </div>

          {playing && (
            <div className="np-progress">
              <div className={'np-bar' + (canControl ? ' seekable' : '')} onClick={seekFromClick} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
                <div className="np-bar-fill" style={{ width: fraction * 100 + '%' }} />
                <div className="np-knob" style={{ left: fraction * 100 + '%' }} />
              </div>
              <div className="np-times">
                <span>{fmt(position)}</span>
                <span>{fmt(playing.durationMs)}</span>
              </div>
            </div>
          )}

          <div className="np-controls">
            {iconBtn('shuffle', 'shuffle all', 'Play random songs from the whole library until stopped', () => act({ action: 'shuffle', value: !st.shuffleAll }), { pressed: !!st.shuffleAll, kind: 'small' })}
            {iconBtn('prev', 'prev', 'Restart the song; press again within 3 seconds to go back one', () => act({ action: 'previous' }), { disabled: !playing })}
            {iconBtn(st.state === 'paused' ? 'play' : 'pause', st.state === 'paused' ? 'play' : 'pause', 'Play or pause', () => act({ action: st.state === 'paused' ? 'resume' : 'pause' }), { disabled: !playing, kind: 'main' })}
            {iconBtn('next', 'skip', 'Skip this song', () => act({ action: 'skip' }), { disabled: !playing })}
            {iconBtn('stop', 'stop', 'Stop the music and empty the queue (Jellybox stays in the room)', () => act({ action: 'stop' }), { disabled: !playing && st.queue.length === 0 && !st.shuffleAll, kind: 'small danger' })}
          </div>

          <label className="np-volume">
            <span>vol {volume}</span>
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              disabled={!canControl}
              onChange={(e) => {
                draggingVolume.current = true
                setVolume(Number(e.target.value))
              }}
              onMouseUp={() => {
                draggingVolume.current = false
                act({ action: 'volume', value: volume })
              }}
              onKeyUp={() => act({ action: 'volume', value: volume })}
            />
          </label>

          <Visualizer
            playing={!!playing && st.state === 'playing'}
            botAudioId={v.botAudioId}
            deafened={v.deafened}
            onEnabledChange={setVizOn}
            windowHost={stageEl}
            player={{ track: playing || null, paused: st.state === 'paused', canControl, act }}
            search={{ canSearch: canControl, run: async (q) => (await api.searchMusic(sessionToken, serverId, q)).results, act: (b) => act(b, { rethrow: true }) }}
          />

          <button type="button" className="np-next" onClick={() => setSheet('queue')} title="See everything in the queue">
            <span className="np-next-label">Up next</span>
            <span className="np-next-song">{next ? [next.title, next.artist].filter(Boolean).join(' · ') : 'Nothing queued'}</span>
            {more > 0 && <span className="np-next-more">+{more}</span>}
          </button>
        </div>

        {sheet && (
          <div className="np-sheet" role="dialog" aria-label={sheet === 'queue' ? 'Queue' : 'Search and library'}>
            <div className="np-sheet-head">
              <button type="button" className="np-hbtn" aria-label="Back to the player" title="Back to the player (Esc)" onClick={() => setSheet(null)}>
                <Icon name="back" size={16} strokeWidth={2} />
              </button>
              <strong>{sheet === 'queue' ? 'Up next' : 'Search and library'}</strong>
              {sheet === 'queue' && canControl && (
                <button type="button" className="np-link" onClick={() => setSheet('browse')}>
                  Add songs
                </button>
              )}
              {sheet === 'browse' && (
                <button type="button" className="np-link" onClick={() => setSheet('queue')}>
                  Queue{st.queue.length ? ` (${st.queue.length})` : ''}
                </button>
              )}
            </div>
            {added && <div className="np-added" role="status">{added}</div>}
            <div className="np-sheet-body">
              {sheet === 'queue' && (
                <>
                  {st.queue.length === 0 && <div className="settings-note">Nothing is waiting.</div>}
                  {st.queue.length > 0 && (
                    <ol className="np-queue">
                      {st.queue.map((t, i) => (
                        <li key={i}>
                          <span className="np-qnum">{i + 1}</span>
                          <span className="np-qname">
                            {t.title}
                            {t.artist ? ` - ${t.artist}` : ''}
                            {t.addedBy ? ` (${t.addedBy})` : ''}
                          </span>
                          {canControl && (
                            <button type="button" className="link-btn" onClick={() => act({ action: 'remove', value: i + 1 })}>
                              remove
                            </button>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                  {canControl && st.queue.length > 0 && btn('clear queue', 'Clear everything waiting', () => act({ action: 'clear' }))}
                </>
              )}

              {sheet === 'browse' && canControl && (
                <>
                  <form className="np-search" onSubmit={runSearch}>
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search songs, albums, artists" aria-label="Search songs, albums, artists" autoFocus />
                    <button type="submit" className="btn-secondary np-btn" disabled={searching || !query.trim()}>
                      Search
                    </button>
                  </form>
                  {results ? (
                    <>
                      <button type="button" className="np-link" onClick={() => setResults(null)}>
                        Back to the library
                      </button>
                      <ul className="np-results">
                        {results.length === 0 && <li className="settings-note">Nothing found.</li>}
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
                              <button type="button" className="link-btn" onClick={() => sheetAct({ action: 'play-now', itemId: r.id, kind: r.kind })}>
                                Play now
                              </button>
                              <button type="button" className="link-btn" onClick={() => sheetAct({ action: 'queue', itemId: r.id, kind: r.kind })}>
                                Add to queue
                              </button>
                              {(r.kind === 'album' || (r.kind === 'song' && r.albumId)) && (
                                <button type="button" className="link-btn" onClick={() => sheetAct({ action: 'play-album', itemId: r.kind === 'album' ? r.id : r.albumId })}>
                                  Play album
                                </button>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <BrowseSection sessionToken={sessionToken} serverId={serverId} act={sheetAct} />
                  )}
                </>
              )}
              {error && <div className="error-text">{error}</div>}
            </div>
          </div>
        )}
      </aside>
    </>
  )
}

export default NowPlayingPanel
