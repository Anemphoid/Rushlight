// How a remote person's audio reaches the speakers, kept apart from voice.js (which
// needs a browser and LiveKit to load) so it can be tested.
//
// Deafen has to hold for every track, including ones that arrive while deafened (someone
// rejoining, or an admin muting and then unmuting them). livekit-client's RemoteAudioTrack
// does not carry a volume of 0 onto an element attached afterwards: its attach() only
// re-applies the stored volume `if (this.elementVolume)`, and 0 is falsy, so a track
// subscribed while deafened played at full volume. Two defenses, both cheap:
//   - set the volume AFTER attaching, when there is an element to set it on, and
//   - when silenced, also mute the element itself, so it stays silent whatever its volume.

// Set the volume on a track's attached elements. `silent` (deafened) forces zero and mutes.
export function applyTrackVolume(track, volume, silent) {
  track.setVolume(silent ? 0 : volume)
  for (const el of track.attachedElements || []) el.muted = !!silent
}

// Attach a track to a new element and apply the volume to it. Returns the element.
export function attachRemoteAudio(track, volume, silent) {
  const el = track.attach()
  applyTrackVolume(track, volume, silent)
  return el
}
