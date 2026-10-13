// A Web Audio analyser on the bot's incoming audio track. It is never connected to the speakers, so
// nothing is heard twice: it only reads what this person is already being sent.
export async function createTap(mediaStreamTrack) {
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext
  if (!Ctx || !mediaStreamTrack) return null
  const ctx = new Ctx()
  try {
    await ctx.resume()
  } catch {
    // an analyser still reads once resumed by a later user action
  }
  const source = ctx.createMediaStreamSource(new MediaStream([mediaStreamTrack]))
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  analyser.smoothingTimeConstant = 0.8
  source.connect(analyser)
  return {
    ctx,
    source,
    analyser,
    dispose() {
      try {
        source.disconnect()
      } catch {
        // already gone
      }
      ctx.close().catch(() => {})
    }
  }
}
