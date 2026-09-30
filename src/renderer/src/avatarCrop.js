// Bakes a pan/zoom selection into a fixed-size square image, the same
// pattern Discord/GitHub/etc. use: the server only ever stores one final
// square, never the original photo or separate crop coordinates.
export const AVATAR_OUTPUT_SIZE = 256

// offset is in the SAME pixel units as image.width/height (not screen
// pixels) — {0,0} centers the image; zoom is a multiplier where 1 means the
// image's shorter side exactly fills the frame.
export function cropToBlob(image, { zoom, offsetX, offsetY }) {
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_OUTPUT_SIZE
  canvas.height = AVATAR_OUTPUT_SIZE
  const ctx = canvas.getContext('2d')

  const shortSide = Math.min(image.width, image.height)
  const cropSize = shortSide / Math.max(zoom, 0.01) // higher zoom = a smaller source region = more magnified
  const centerX = image.width / 2 - offsetX
  const centerY = image.height / 2 - offsetY

  // Clamp so the source rectangle never reaches outside the actual image,
  // which is what "can't drag the photo away and leave a blank edge" means.
  const half = cropSize / 2
  const sx = Math.min(Math.max(centerX - half, 0), image.width - cropSize)
  const sy = Math.min(Math.max(centerY - half, 0), image.height - cropSize)

  ctx.drawImage(image, sx, sy, cropSize, cropSize, 0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image'))),
      'image/jpeg',
      0.85
    )
  })
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1]) // strip the data: prefix
    reader.onerror = () => reject(new Error('Could not read the cropped image'))
    reader.readAsDataURL(blob)
  })
}

