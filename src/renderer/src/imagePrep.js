// Getting a picture ready to send. The server would strip personal details itself, but doing it here
// too has two benefits: a phone photo's rotation (kept in EXIF, which the server removes) is baked into
// the pixels so it stays the right way up, and big photos are shrunk to something a chat can carry.
// Drawing through a canvas drops every kind of metadata, so nothing but pixels leaves this computer.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // the server's default limit
export const MAX_SIDE = 2560 // longest side after shrinking
const SAFE_BYTES = MAX_IMAGE_BYTES - 64 * 1024 // leave room so a close call is not refused

// The size to draw at: the same shape, with the longest side no more than `max`, never enlarged.
export function fitWithin(width, height, max = MAX_SIDE) {
  const longest = Math.max(width, height)
  if (!(longest > 0)) return { width: 0, height: 0 }
  const scale = Math.min(1, max / longest)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

// PNG and WebP stay what they are (screenshots and transparency survive); anything else becomes JPEG.
export function outputTypeFor(sourceType) {
  if (sourceType === 'image/png') return 'image/png'
  if (sourceType === 'image/webp') return 'image/webp'
  return 'image/jpeg'
}

export function isPictureFile(file) {
  return !!file && typeof file.type === 'string' && file.type.startsWith('image/')
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality))
}

// Returns { blob, width, height }; throws an Error whose message can be shown as it is.
export async function prepareImage(file) {
  if (!isPictureFile(file)) throw new Error("That isn't a picture.")
  let bitmap
  try {
    // 'from-image' applies the camera's rotation while decoding
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error("Couldn't read that picture.")
  }
  try {
    let type = outputTypeFor(file.type)
    let max = MAX_SIDE
    for (let attempt = 0; attempt < 6; attempt++) {
      const { width, height } = fitWithin(bitmap.width, bitmap.height, max)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const g = canvas.getContext('2d')
      if (type === 'image/jpeg') {
        g.fillStyle = '#ffffff' // JPEG has no transparency
        g.fillRect(0, 0, width, height)
      }
      g.drawImage(bitmap, 0, 0, width, height)
      const blob = await toBlob(canvas, type, 0.88)
      if (!blob) throw new Error("Couldn't prepare that picture.")
      if (blob.size <= SAFE_BYTES) return { blob, width, height }
      // still too big: a lossless picture becomes a JPEG, then everything gets smaller
      if (type !== 'image/jpeg') type = 'image/jpeg'
      else max = Math.round(max * 0.75)
    }
    throw new Error('That picture is too big to send.')
  } finally {
    bitmap.close?.()
  }
}
