import { useState, useEffect, useRef } from 'react'
import * as api from '../api'
import Avatar from './Avatar'
import jellyboxImage from '../assets/images/jellybox.png'

const POLL_MS = 3000

function fmt(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Jellybox's panel for a voice room. Everyone in the server sees what is playing and what is queued;
// only admins and the owner can press the buttons or use the search box. Hidden when nothing is linked.
// The progress bar runs from the last reported position, so it moves smoothly between the few-second polls.
function NowPlayingPanel({ sessionToken, serverId, space }) {
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
  const alive = useRef(true)

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

  if (!st || !st.available) return null

  const canControl = !!st.canControl
  const position = playing
    ? Math.min(playing.durationMs || Infinity, playing.positionMs + (st.state === 'playing' ? now - fetchedAt : 0))
    : 0
  const fraction = playing && playing.durationMs ? Math.min(1, position / playing.durationMs) : 0

  async function act(body) {
    setError('')
    try {
      const out = await api.musicControl(sessionToken, space.type, space.id, body)
      setSt({ ...out, canControl })
      setFetchedAt(Date.now())
      if (typeof out.volume === 'number') setVolume(out.volume)
    } catch (err) {
      setError(err.message)
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

  const btn = (label, title, onClick, disabled = false) => (
    <button type="button" className="btn-secondary np-btn" title={canControl ? title : 'Only admins and the owner can use this'} disabled={!canControl || disabled} onClick={onClick}>
      {label}
    </button>
  )

  return (
    <div className="now-playing">
      <div className="np-header">
        <Avatar name="Jellybox" imageUrl={jellyboxImage} size={28} />
        <strong>Jellybox</strong>
        <span className="member-badge">bot</span>
        <span className="settings-note" style={{ margin: 0 }}>
          {playing ? (st.state === 'paused' ? 'paused' : 'playing') : 'ready. Type /play in chat, or ask an admin'}
        </span>
      </div>

      {playing && (
        <div className="np-body">
          <div className="np-cover">{cover ? <img src={cover} alt="" /> : <span aria-hidden="true">music</span>}</div>
          <div className="np-info">
            <div className="np-title">{playing.title}</div>
            <div className="np-artist">{[playing.artist, playing.album].filter(Boolean).join(' - ')}</div>
            <div className={'np-bar' + (canControl ? ' seekable' : '')} onClick={seekFromClick} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
              <div className="np-bar-fill" style={{ width: fraction * 100 + '%' }} />
            </div>
            <div className="np-times">
              <span>{fmt(position)}</span>
              <span>{fmt(playing.durationMs)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="np-controls">
        {btn('prev', 'Restart the song; press again within 3 seconds to go back one', () => act({ action: 'previous' }), !playing)}
        {btn(st.state === 'paused' ? 'play' : 'pause', 'Play or pause', () => act({ action: st.state === 'paused' ? 'resume' : 'pause' }), !playing)}
        {btn('skip', 'Skip this song', () => act({ action: 'skip' }), !playing)}
        <label className="np-volume">
          <span className="settings-note" style={{ margin: 0 }}>vol {volume}</span>
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
        {canControl && st.queue.length > 0 && btn('clear queue', 'Clear everything waiting', () => act({ action: 'clear' }))}
      </div>

      {st.queue.length > 0 && (
        <ol className="np-queue">
          {st.queue.slice(0, 8).map((t, i) => (
            <li key={i}>
              <span>
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
          {st.queue.length > 8 && <li className="settings-note">and {st.queue.length - 8} more</li>}
        </ol>
      )}

      {canControl && (
        <form className="np-search" onSubmit={runSearch}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search songs, albums, artists" />
          <button type="submit" className="btn-secondary np-btn" disabled={searching || !query.trim()}>
            Search
          </button>
        </form>
      )}
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
      {error && <div className="error-text">{error}</div>}
    </div>
  )
}

export default NowPlayingPanel
