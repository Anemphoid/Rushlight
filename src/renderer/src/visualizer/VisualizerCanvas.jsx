import { useEffect, useRef, useState } from 'react'
import { createTap } from './audioTap'
import { FrameGovernor } from './governor'
import { drawSimple, accentColour } from './simpleStyles'
import { loadMilkdrop } from './milkdrop'
import * as voice from '../voice'

const SHUFFLE_MS = 25000
const BLEND_S = 2.7

// One canvas that draws while `active` is true and not a moment longer: when it turns false (switched
// off, nothing playing, panel or window hidden) the loop is cancelled and the audio tap closed, so it
// costs nothing. `mode` is 'simple' (a built-in style) or 'milkdrop' (butterchurn, loaded on first use).
// For milkdrop, `controlRef` receives { next, previous, load, names, current } and `onPreset(name)` is told
// of every change.
function VisualizerCanvas({ mode, style, active, botAudioId, reducedMotion, controlRef, onPreset, shuffle, onError, className }) {
  const canvasRef = useRef(null)
  const [message, setMessage] = useState('')
  // read by the shuffle timer, so turning shuffle on or off never restarts the picture
  const shuffleRef = useRef(shuffle)
  shuffleRef.current = shuffle

  useEffect(() => {
    if (!active) return undefined
    const canvas = canvasRef.current
    if (!canvas) return undefined
    let stopped = false
    let raf = 0
    let tap = null
    let viz = null
    let shuffleTimer = null
    const governor = new FrameGovernor({ reducedMotion })
    setMessage('')

    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = Math.max(2, Math.round(canvas.clientWidth * dpr * governor.scale))
      const h = Math.max(2, Math.round(canvas.clientHeight * dpr * governor.scale))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        if (viz) viz.setRendererSize(w, h)
      }
    }

    async function start() {
      tap = await createTap(voice.getBotMediaTrack())
      if (stopped) {
        if (tap) tap.dispose()
        return
      }
      if (!tap) {
        setMessage('Jellybox audio is not available here.')
        return
      }
      if (mode === 'milkdrop') {
        try {
          const lib = await loadMilkdrop()
          if (stopped) return
          // a WebGL canvas can only ever give a webgl context, so this one is for butterchurn only
          viz = lib.butterchurn.createVisualizer(tap.ctx, canvas, { width: canvas.width, height: canvas.height, pixelRatio: 1 })
          viz.connectAudio(tap.source)
          let current = lib.names[Math.floor(Math.random() * lib.names.length)]
          const load = (name, blend = BLEND_S) => {
            if (!lib.presets[name]) return
            current = name
            viz.loadPreset(lib.presets[name], blend)
            if (onPreset) onPreset(name)
          }
          const step = (delta) => {
            const i = Math.max(0, lib.names.indexOf(current))
            load(lib.names[(i + delta + lib.names.length) % lib.names.length])
          }
          if (controlRef) {
            controlRef.current = {
              names: lib.names,
              load: (n) => load(n),
              next: () => step(1),
              previous: () => step(-1),
              get current() {
                return current
              }
            }
          }
          load(current, 0)
          shuffleTimer = setInterval(() => {
            if (!shuffleRef.current) return
            const others = lib.names.filter((n) => n !== current)
            load(others[Math.floor(Math.random() * others.length)])
          }, SHUFFLE_MS)
        } catch (err) {
          if (!stopped) {
            setMessage('The visualizer could not start here.')
            if (onError) onError(err)
          }
          return
        }
      }
      loop()
    }

    const freq = new Uint8Array(1024)
    const time = new Uint8Array(2048)
    const colour = accentColour()
    let ctx2d = null

    function loop(now = performance.now()) {
      if (stopped) return
      raf = requestAnimationFrame(loop)
      if (!governor.shouldDraw(now)) return
      fit()
      if (viz) {
        viz.render()
      } else if (tap) {
        if (!ctx2d) ctx2d = canvas.getContext('2d')
        tap.analyser.getByteFrequencyData(freq)
        tap.analyser.getByteTimeDomainData(time)
        drawSimple(ctx2d, style, canvas.width, canvas.height, freq, time, colour)
      }
      governor.frameDrawn(now)
    }

    start()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      clearInterval(shuffleTimer)
      if (controlRef) controlRef.current = null
      if (tap) tap.dispose()
      // let the GPU go: nothing is left drawing
      try {
        const gl = canvas.getContext('webgl2')
        if (gl && viz) gl.getExtension('WEBGL_lose_context')?.loseContext()
      } catch {
        // nothing to release
      }
    }
    // controlRef/onPreset/onError are stable callbacks from the parent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, mode, style, botAudioId, reducedMotion])

  return (
    <>
      {/* a fresh canvas for every start: a canvas keeps its first kind of context, and a lost WebGL one is gone */}
      <canvas key={[active, mode, style, botAudioId, reducedMotion].join('|')} ref={canvasRef} className={'viz-canvas ' + (className || '')} />
      {message && <div className="viz-message">{message}</div>}
    </>
  )
}

export default VisualizerCanvas
