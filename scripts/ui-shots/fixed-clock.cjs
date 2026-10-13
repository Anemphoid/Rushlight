// Preloaded into the screenshot server (NODE_OPTIONS=--require) so its clock stands still at FIXED_NOW and its
// Math.random follows a fixed sequence. Message times, "created just now", Jellybox's progress and the bot's
// choice of friendly reply then come out the same on every run. Only for pictures.
const NOW = Number(process.env.FIXED_NOW)
if (NOW) {
  const Real = Date
  class FixedDate extends Real {
    constructor(...args) {
      if (args.length === 0) super(NOW)
      else super(...args)
    }
    static now() {
      return NOW
    }
  }
  globalThis.Date = FixedDate
}

// the bot picks its wording with Math.random; the same calls in the same order give the same words
{
  let seed = 987654321
  Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
}
