import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import * as api from '../api'

// As wide as the picture itself, but no wider than 360 and no taller than 320 at its own shape, so a tall
// picture gets a narrow box instead of black bars.
const BOX_W = 360
const BOX_H = 320
function fitWidth({ width, height }) {
  return Math.max(1, Math.min(width, BOX_W, Math.round((BOX_H * width) / height)))
}

// One picture in the chat. It is fetched with the sign-in token and shown from a local address; the box
// is sized from the picture's real shape first so the chat does not jump as pictures arrive. Click it
// for a larger view (Esc or a click closes).
function ChatImage({ image, token, author }) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  const [big, setBig] = useState(false)

  useEffect(() => {
    let alive = true
    let made = null
    setUrl(null)
    setFailed(false)
    api.fetchChatImage(token, image.id).then((u) => {
      if (!alive) {
        if (u) URL.revokeObjectURL(u)
        return
      }
      made = u
      if (u) setUrl(u)
      else setFailed(true)
    })
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [image.id, token])

  useEffect(() => {
    if (!big) return
    const onKey = (e) => {
      if (e.key === 'Escape') setBig(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [big])

  const label = author ? `Picture from ${author}` : 'Picture'
  if (failed) return <div className="chat-image-missing settings-note">Picture unavailable</div>

  return (
    <>
      <button
        type="button"
        className="chat-image-frame"
        style={{ aspectRatio: `${image.width} / ${image.height}`, maxWidth: fitWidth(image) }}
        onClick={() => url && setBig(true)}
        aria-label={`${label}, open larger`}
      >
        {url && <img src={url} alt={label} className="chat-image" draggable={false} />}
      </button>
      {big &&
        url &&
        createPortal(
          <div className="chat-image-lightbox" role="dialog" aria-label={label} onClick={() => setBig(false)}>
            <img src={url} alt={label} />
          </div>,
          document.fullscreenElement || document.body
        )}
    </>
  )
}

export default ChatImage
