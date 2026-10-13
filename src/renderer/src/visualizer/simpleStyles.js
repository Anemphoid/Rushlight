// The small built-in styles: spectrum bars, waveform and radial. Plain canvas, drawn in the skin's
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
  if (style === 'radial') {
    const cx = w / 2
    const cy = h / 2
    const base = Math.min(w, h) * 0.22
    const reach = Math.min(w, h) * 0.26
    const bars = 64
    for (let i = 0; i < bars; i++) {
      const v = freq[Math.floor((i / bars) * freq.length * 0.7)] / 255
      const a = (i / bars) * Math.PI * 2 - Math.PI / 2
      const r0 = base
      const r1 = base + Math.max(1, v * reach)
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
      ctx.stroke()
    }
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
