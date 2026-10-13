// Preloaded into the screenshot server (NODE_OPTIONS=--require) so its clock stands still at FIXED_NOW. Message
// times, "created just now" and Jellybox's progress then come out the same on every run. Only for pictures.
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
