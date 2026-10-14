import { useState, useEffect, useRef, useSyncExternalStore } from 'react'
import * as voice from '../voice'
import Visualizer from '../visualizer/Visualizer'
import SongToast from './SongToast'
import BrowseSection from './BrowseSection'
import * as api from '../api'
import * as songPrefs from '../songPrefs'
import Icon from './Icon'
import { loadPrefs } from '../visualizer/prefs'

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
function WidenWindow() {
  useEffect(() => {
    try {
      window.api?.windowWiden?.(COLUMN_WIDTH)
    } catch {
      // no window API (tests): nothing to widen
    }
    return () => {
      try {
        window.api?.windowWiden?.(0)
      } catch {
        // ignore
      }
    }
  }, [])
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
  const [tab, setTab] = useState('queue')
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
  const setToast = songPrefs.setSongToastEnabled
  function toggleOpen() {
    setOpen((o) => {
      try {
        localStorage.setItem('rushlight.jellyboxOpen', o ? '0' : '1')
      } catch {
        // not remembered
      }
      return !o
    })
  }
  const alive = useRef(true)
  const v = useSyncExternalStore(voice.subscribe, voice.getSnapshot)

  useEffect(() => {
    alive.current = true
    setSt(null)
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

  const tabs = [
    { id: 'queue', label: `Up next${st.queue.length ? ' · ' + st.queue.length : ''}` },
    ...(canControl ? [{ id: 'search', label: 'Search' }, { id: 'library', label: 'Library' }] : [])
  ]
  const shownTab = tabs.some((t) => t.id === tab) ? tab : 'queue'

  return (
    <>
      {toast}
      <aside className={'now-playing side' + (vizOn ? ' viz-on' : '')} aria-label="Jellybox">
        <WidenWindow />
        <div className="np-header">
          <strong>Jellybox</strong>
          <span className="member-badge">bot</span>
          {playing && <span className="settings-note np-state">{st.state === 'paused' ? 'paused' : 'playing'}</span>}
          <button type="button" className="np-toggle" aria-expanded="true" aria-label="Hide Jellybox" title="Fold this away" onClick={toggleOpen}>
            <Icon name="forward" size={16} strokeWidth={2} />
          </button>
        </div>

        <div className="np-player">
          {playing ? (
            <div className="np-now">
              <div className="np-cover">{cover ? <img src={cover} alt="" /> : <Icon name="music" size={40} strokeWidth={1.4} />}</div>
              <div className="np-info">
                <div className="np-title" title={playing.title}>{playing.title}</div>
                <div className="np-artist">{[playing.artist, playing.album].filter(Boolean).join(' · ')}</div>
              </div>
            </div>
          ) : (
            <div className="settings-note np-idle">{idle}</div>
          )}

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
            player={{ track: playing || null, paused: st.state === 'paused', canControl, act }}
            search={{ canSearch: canControl, run: async (q) => (await api.searchMusic(sessionToken, serverId, q)).results, act: (b) => act(b, { rethrow: true }) }}
          />
        </div>

        <div className="np-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={shownTab === t.id} className="np-tabbtn" onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="np-tabbody" key={shownTab}>
          {shownTab === 'queue' && (
            <>
              {st.queue.length === 0 && <div className="settings-note">Nothing is waiting.</div>}
              {st.queue.length > 0 && (
                <ol className="np-queue">
                  {st.queue.slice(0, 2).map((t, i) => (
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
                  {st.queue.length > 2 && <li className="settings-note np-more">and {st.queue.length - 2} more</li>}
                </ol>
              )}
              {canControl && st.queue.length > 0 && btn('clear queue', 'Clear everything waiting', () => act({ action: 'clear' }))}
              <label className="np-toast-toggle">
                <input type="checkbox" checked={toastOn} onChange={(e) => setToast(e.target.checked)} /> Pop up when the song changes
              </label>
            </>
          )}

          {shownTab === 'search' && canControl && (
            <>
              <form className="np-search" onSubmit={runSearch}>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search songs, albums, artists" aria-label="Search songs, albums, artists" />
                <button type="submit" className="btn-secondary np-btn" disabled={searching || !query.trim()}>
                  Search
                </button>
              </form>
              {results && (
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
                        <button type="button" className="link-btn" onClick={() => act({ action: 'play-now', itemId: r.id, kind: r.kind })}>
                          Play now
                        </button>
                        <button type="button" className="link-btn" onClick={() => act({ action: 'queue', itemId: r.id, kind: r.kind })}>
                          Add to queue
                        </button>
                        {(r.kind === 'album' || (r.kind === 'song' && r.albumId)) && (
                          <button type="button" className="link-btn" onClick={() => act({ action: 'play-album', itemId: r.kind === 'album' ? r.id : r.albumId })}>
                            Play album
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {shownTab === 'library' && canControl && <BrowseSection sessionToken={sessionToken} serverId={serverId} act={act} />}
          {error && <div className="error-text">{error}</div>}
        </div>
      </aside>
    </>
  )
}

export default NowPlayingPanel
