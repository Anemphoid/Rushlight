// Keeps the visualizer smooth on a weak computer. It aims for 60 frames per second and measures the
// real gap between frames. If frames start dropping it first lowers the internal render resolution
// (a few steps) and only when that is at its floor and it is still slow does it step down to 30.
// It never climbs back up in the same session, so it cannot flap.
export const SCALES = [1, 0.75, 0.5, 0.35]
const WINDOW = 45 // frames per measurement
const SLOW_MS = 22 // average gap above this means under about 45 fps

export class FrameGovernor {
  constructor({ reducedMotion = false } = {}) {
    this.scaleIndex = 0
    this.fps = reducedMotion ? 15 : 60
    this.last = null
    this.gaps = []
  }

  get scale() {
    return SCALES[this.scaleIndex]
  }

  get minGapMs() {
    return 1000 / this.fps - 2
  }

  // Whether a frame should be drawn now (30 fps and the reduced-motion rate skip frames).
  shouldDraw(now) {
    return this.last === null || now - this.last >= this.minGapMs
  }

  // Call after drawing a frame. Returns 'scale' or 'fps' when it just stepped down, else null.
  frameDrawn(now) {
    if (this.last !== null) this.gaps.push(now - this.last)
    this.last = now
    if (this.gaps.length < WINDOW) return null
    const avg = this.gaps.reduce((a, b) => a + b, 0) / this.gaps.length
    this.gaps = []
    // judged against what we are aiming for: at 30 fps a 33 ms gap is on target
    if (avg <= (this.fps === 60 ? SLOW_MS : 1000 / this.fps + 6)) return null
    if (this.scaleIndex < SCALES.length - 1) {
      this.scaleIndex++
      return 'scale'
    }
    if (this.fps === 60) {
      this.fps = 30
      return 'fps'
    }
    return null
  }

  // A pause (switched off, hidden, not playing) must not look like a slow frame.
  resetClock() {
    this.last = null
    this.gaps = []
  }
}
