// Avatars are shown only to their owner and people who share a server with them (server v0.22.0), so the picture is fetched
// with the token and drawn from a blob URL instead of letting the <img> tag ask on its own. Outside React like voice.js; the
// token is set by App and everything is dropped (and the blob URLs revoked) when it changes, so one person's pictures never
// outlive their sign-in.
import { useEffect, useSyncExternalStore } from 'react'

let auth = null
let version = 0
const pictures = new Map() // url -> Promise of a blob URL, or null when there is no picture to show
const listeners = new Set()
const notify = () => {
  version++
  for (const l of listeners) l()
}

export function setAvatarAuth(token) {
  if (token === auth) return
  auth = token || null
  for (const p of pictures.values()) p.then((u) => u && URL.revokeObjectURL(u)).catch(() => {})
  pictures.clear()
  notify()
}

const isApiAvatar = (url) => typeof url === 'string' && url.includes('/api/avatars/')

// A blob URL for the picture, or null (not allowed, no picture, no sign-in, or the server is unreachable). A failure because
// the server could not be reached is not remembered, so the next draw tries again.
export function loadAvatar(url) {
  if (!auth) return Promise.resolve(null)
  if (pictures.has(url)) return pictures.get(url)
  const token = auth
  const p = fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    .then(async (res) => (res.ok ? URL.createObjectURL(await res.blob()) : null))
    .catch(() => {
      if (pictures.get(url) === p) pictures.delete(url)
      return null
    })
  pictures.set(url, p)
  return p
}

const subscribe = (l) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

// What an <img> should use for this avatar url: the url itself for anything that is not a Rushlight avatar (the music bot's
// bundled picture), a blob URL once fetched, null until then.
export function useAvatarSrc(url, setSrc) {
  const v = useSyncExternalStore(subscribe, () => version)
  useEffect(() => {
    let cancelled = false
    if (!url) return setSrc(null)
    if (!isApiAvatar(url)) return setSrc(url)
    setSrc(null)
    loadAvatar(url).then((u) => !cancelled && setSrc(u))
    return () => {
      cancelled = true
    }
  }, [url, v])
}
