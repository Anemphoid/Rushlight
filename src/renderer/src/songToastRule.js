// When the song pop-up shows. It is for a song that STARTS while you are there, never for one that is already
// playing when you arrive: that includes arriving a moment before Jellybox's presence is known, when the first
// answer says "nothing here" and the next says "song X, 40 seconds in".
// A song seen for the first time that is more than LATE_MS in was already playing, so it is remembered silently.
// The state is polled every 3 s, so a song that really just started is never more than a few seconds in.
export const LATE_MS = 8000

// seen: undefined before the first answer, else the track id last observed (null = nothing playing).
// track: undefined while loading, null when nothing plays, else { id, positionMs }.
// Returns { seen, show } where show says whether to pop up for this track.
export function toastDecision(seen, track, enabled) {
  if (track === undefined) return { seen, show: false }
  const id = track ? track.id : null
  if (seen === undefined) return { seen: id, show: false } // first look: remember it, say nothing
  if (id === seen) return { seen, show: false }
  if (!id || !enabled) return { seen: id, show: false }
  const late = Number(track.positionMs) > LATE_MS
  return { seen: id, show: !late }
}
