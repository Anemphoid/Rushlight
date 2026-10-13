// The small built-in styles: spectrum bars and waveform. Plain canvas, drawn in the skin's
// accent colour. They are the small view, and the fallback when WebGL 2 is missing.
export function accentColour(el = document.documentElement) {
  const v = getComputedStyle(el).getPropertyValue('--accent').trim()
  return v || '#d9903f'
}

// freq: Uint8Array of 0-255 spectrum values, time: Uint8Array of 0-255 waveform samples (128 = silence).
export function drawSimple(ctx, style, w, h, freq, time, colour) {
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = colour
  ctx.strokeStyle = colour
  ctx.lineWidth = Math.max(1.5, h / 60)
  if (style === 'wave') {
    ctx.beginPath()
    const step = Math.max(1, Math.floor(time.length / w))
    for (let x = 0; x < w; x++) {
      const v = time[Math.min(time.length - 1, x * step)] / 255
      const y = v * h
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    return
  }
  // bars: log-ish spacing so the bass gets room
  const bars = Math.max(12, Math.min(48, Math.floor(w / 8)))
  const gap = 2
  const bw = (w - gap * (bars - 1)) / bars
  for (let i = 0; i < bars; i++) {
    const lo = Math.floor(Math.pow(i / bars, 1.8) * freq.length * 0.75)
    const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / bars, 1.8) * freq.length * 0.75))
    let peak = 0
    for (let k = lo; k < hi; k++) peak = Math.max(peak, freq[k])
    const bh = Math.max(2, (peak / 255) * h)
    ctx.fillRect(i * (bw + gap), h - bh, bw, bh)
  }
}
