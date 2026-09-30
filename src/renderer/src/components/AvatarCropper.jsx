import { useState, useRef, useCallback } from 'react'
import { cropToBlob, blobToBase64 } from '../avatarCrop'

const FRAME_SIZE = 220 // on-screen preview size in CSS pixels
const MAX_ZOOM = 4

// Picking, panning, and zooming happen entirely client-side against an
// object URL — nothing is uploaded until "Use this photo" bakes the current
// view into one square JPEG. onDone receives { base64, mime }; onCancel
// backs out with nothing changed.
function AvatarCropper({ onDone, onCancel }) {
  const [objectUrl, setObjectUrl] = useState(null)
  const [image, setImage] = useState(null) // the loaded HTMLImageElement, once ready
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 }) // in source-image pixels
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dragStart = useRef(null)
  const fileInputRef = useRef(null)

  function handleFile(e) {
    const file = e.target.files && e.target.files[0]
    e.target.value = '' // so picking the same file twice still fires onChange
    if (!file) return
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setError('Please choose a JPEG, PNG, or WebP image.')
      return
    }
    setError('')
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      setImage(img)
      setObjectUrl(url)
      setZoom(1)
      setOffset({ x: 0, y: 0 })
    }
    img.onerror = () => {
      setError("Couldn't read that image.")
      URL.revokeObjectURL(url)
    }
    img.src = url
  }

  // The on-screen frame is FRAME_SIZE CSS pixels; the crop math works in the
  // image's own pixel units, so drag distance has to be converted by
  // however much the image is currently scaled down to fit the frame.
  const shortSide = image ? Math.min(image.width, image.height) : 1
  const screenToImageScale = shortSide / zoom / FRAME_SIZE

  const clampOffset = useCallback(
    (next) => {
      if (!image) return next
      const cropSize = shortSide / zoom
      const half = cropSize / 2
      const maxX = image.width / 2 - half
      const maxY = image.height / 2 - half
      return {
        x: Math.min(Math.max(next.x, -maxX), maxX),
        y: Math.min(Math.max(next.y, -maxY), maxY)
      }
    },
    [image, shortSide, zoom]
  )

  function handlePointerDown(e) {
    if (!image) return
    dragStart.current = { x: e.clientX, y: e.clientY, offset }
    setDragging(true)
    e.target.setPointerCapture(e.pointerId)
  }
  function handlePointerMove(e) {
    if (!dragging || !dragStart.current) return
    const dxScreen = e.clientX - dragStart.current.x
    const dyScreen = e.clientY - dragStart.current.y
    // Dragging the photo right means revealing more of its LEFT side, i.e.
    // the offset (which shifts the crop window, not the photo) moves the
    // opposite way from the pointer.
    setOffset(
      clampOffset({
        x: dragStart.current.offset.x - dxScreen * screenToImageScale,
        y: dragStart.current.offset.y - dyScreen * screenToImageScale
      })
    )
  }
  function handlePointerUp() {
    setDragging(false)
    dragStart.current = null
  }

  function handleZoomChange(next) {
    const z = Number(next)
    setZoom(z)
    setOffset((prev) => clampOffset(prev))
  }

  async function handleConfirm() {
    if (!image) return
    setBusy(true)
    setError('')
    try {
      const blob = await cropToBlob(image, { zoom, offsetX: offset.x, offsetY: offset.y })
      const base64 = await blobToBase64(blob)
      onDone({ base64, mime: blob.type })
    } catch (err) {
      setError(err.message || 'Something went wrong preparing that image.')
      setBusy(false)
    }
  }

  return (
    <div className="poll-backdrop">
      <div className="poll-card" style={{ maxWidth: 340 }}>
        <h2>Choose a picture</h2>

        {!image ? (
          <>
            <p className="settings-note">
              JPEG, PNG, or WebP. You'll be able to drag and zoom to frame it before
              anyone sees it.
            </p>
            <button type="button" className="btn-primary" onClick={() => fileInputRef.current.click()}>
              Pick an image
            </button>
          </>
        ) : (
          <>
            <div
              className="avatar-crop-frame"
              style={{ width: FRAME_SIZE, height: FRAME_SIZE }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              <img
                src={objectUrl}
                alt=""
                draggable={false}
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  width: (image.width / shortSide) * zoom * FRAME_SIZE,
                  height: (image.height / shortSide) * zoom * FRAME_SIZE,
                  transform: `translate(-50%, -50%) translate(${(-offset.x / shortSide) * zoom * FRAME_SIZE}px, ${(-offset.y / shortSide) * zoom * FRAME_SIZE}px)`,
                  pointerEvents: 'none',
                  userSelect: 'none'
                }}
              />
            </div>
            <p className="settings-note" style={{ textAlign: 'center' }}>
              Drag to reposition, so people actually see the part that matters.
            </p>
            <input
              type="range"
              min="1"
              max={MAX_ZOOM}
              step="0.05"
              value={zoom}
              onChange={(e) => handleZoomChange(e.target.value)}
              style={{ width: '100%' }}
            />
            <div className="create-form-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  URL.revokeObjectURL(objectUrl)
                  setImage(null)
                  setObjectUrl(null)
                }}
              >
                Choose a different image
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={handleConfirm}>
                {busy ? 'Saving…' : 'Use this photo'}
              </button>
            </div>
          </>
        )}

        {error && <p className="error-text">{error}</p>}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFile}
          style={{ display: 'none' }}
        />

        <button type="button" className="link-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export default AvatarCropper
