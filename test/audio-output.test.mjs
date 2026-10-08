// Deafen must hold for tracks that arrive while deafened. The stand-in track copies the
// livekit-client RemoteAudioTrack behavior that caused the bug: setVolume only reaches
// elements that are already attached, and attach() re-applies the stored volume only
// `if (this.elementVolume)`, which is false for 0.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyTrackVolume, attachRemoteAudio } from '../src/renderer/src/audioOutput.js'

function quirkyTrack() {
  return {
    attachedElements: [],
    elementVolume: undefined,
    setVolume(v) {
      for (const el of this.attachedElements) el.volume = v
      this.elementVolume = v
    },
    attach() {
      const el = { volume: 1, muted: false } // a fresh audio element plays at full volume
      this.attachedElements.push(el)
      if (this.elementVolume) this.setVolume(this.elementVolume) // 0 is falsy: skipped
      return el
    }
  }
}

test('the stand-in really has the quirk: a volume of 0 set before attach is lost', () => {
  const t = quirkyTrack()
  t.setVolume(0)
  assert.equal(t.attach().volume, 1)
})

test('a track subscribed while deafened comes up silent', () => {
  const t = quirkyTrack()
  const el = attachRemoteAudio(t, 0.8, true)
  assert.equal(el.volume, 0)
  assert.equal(el.muted, true)
})

test('a track subscribed normally gets the output volume times the person volume, unmuted', () => {
  const t = quirkyTrack()
  const el = attachRemoteAudio(t, 0.4, false)
  assert.equal(el.volume, 0.4)
  assert.equal(el.muted, false)
})

test('deafening and undeafening reach tracks that are already playing', () => {
  const t = quirkyTrack()
  const el = attachRemoteAudio(t, 0.6, false)
  applyTrackVolume(t, 0.6, true)
  assert.deepEqual([el.volume, el.muted], [0, true])
  applyTrackVolume(t, 0.6, false)
  assert.deepEqual([el.volume, el.muted], [0.6, false])
})

test('every element of a track is silenced, not just the first', () => {
  const t = quirkyTrack()
  t.attach()
  t.attach()
  applyTrackVolume(t, 1, true)
  assert.ok(t.attachedElements.every((e) => e.volume === 0 && e.muted))
})
