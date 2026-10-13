import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import * as api from '../api'

const SHOW_MS = 10000 // how long it stays before it fades out
const FADE_MS = 600

// Where to draw it: inside the full screen element while one is up (nothing outside it is shown then), else the page.
function useHost() {
  const [host, setHost] = useState(() => document.fullscreenElement || document.body)
  useEffect(() => {
    const on = () => setHost(document.fullscreenElement || document.body)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  return host
}

// A small notice in the bottom right that fades in when the song changes (cover, artist, title) and fades out after
// about ten seconds. It does not show for the song already playing when someone arrives, only for changes.
function SongToast({ track, sessionToken, serverId, enabled }) {
  const [shown, setShown] = useState(null) // the track on show, or null
  const [visible, setVisible] = useState(false) // drives the fade
  const [cover, setCover] = useState(null)
  const seen = useRef(undefined) // undefined: nothing observed yet
  const host = useHost()
  const trackId = track ? track.id : null

  useEffect(() => {
    if (seen.current === undefined) {
      seen.current = trackId // first look: remember it, say nothing
      return undefined
    }
    if (trackId === seen.current) return undefined
    seen.current = trackId
    if (!trackId || !enabled) {
      setVisible(false)
      return undefined
    }
    setShown(track)
    // one frame after mounting, so the fade in has something to fade from
    const raf = requestAnimationFrame(() => setVisible(true))
    const fade = setTimeout(() => setVisible(false), SHOW_MS)
    const gone = setTimeout(() => setShown(null), SHOW_MS + FADE_MS)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(fade)
      clearTimeout(gone)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, enabled])

  const shownId = shown ? shown.id : null
  useEffect(() => {
    let url = null
    let cancelled = false
    setCover(null)
    if (shownId) {
      api.fetchMusicCover(sessionToken, serverId, shownId).then((u) => {
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
  }, [sessionToken, serverId, shownId])

  if (!shown) return null
  return createPortal(
    <div className={'song-toast' + (visible ? ' visible' : '') + (host !== document.body ? ' over-fullscreen' : '')} role="status" aria-live="polite">
      <div className="song-toast-art">{cover ? <img src={cover} alt="" /> : <span aria-hidden="true">music</span>}</div>
      <div className="song-toast-text">
        <div className="song-toast-label">Now playing</div>
        <div className="song-toast-title">{shown.title}</div>
        <div className="song-toast-artist">{shown.artist || shown.album}</div>
      </div>
    </div>,
    host
  )
}

export default SongToast
