// What the voice connection is built with: how the microphone is captured and how the audio is sent. Kept apart from voice.js (which needs
// Electron's build tooling) so a test can check it.
import { AudioPresets } from 'livekit-client'

// What the browser is asked to do to the microphone. Voice isolation (a newer, stronger noise filter some systems offer) follows the noise
// suppression switch, so "off" really is off.
export function captureConstraints(capture) {
  return {
    noiseSuppression: capture.noiseSuppression,
    voiceIsolation: capture.noiseSuppression,
    autoGainControl: capture.autoGainControl,
    echoCancellation: capture.echoCancellation
  }
}

// Capture options for the microphone track, with the chosen device when there is one.
export function captureOptions(capture, deviceId) {
  return { ...(deviceId ? { deviceId } : {}), ...captureConstraints(capture) }
}

// How the audio is sent: Opus at 96 kbps (LiveKit's "music, high quality" mono preset, up from 48) so a good microphone sounds like one at the
// other end, and no silence suppression (DTX), which clips quiet word endings. Redundant packets (RED) are left as LiveKit has them.
export const SEND_BITRATE = AudioPresets.musicHighQuality.maxBitrate
export const publishDefaults = { audioPreset: AudioPresets.musicHighQuality, dtx: false }

export function roomOptions({ input, output, capture, e2ee }) {
  return {
    adaptiveStream: true,
    dynacast: true,
    publishDefaults,
    audioCaptureDefaults: captureOptions(capture, input),
    audioOutput: output ? { deviceId: output } : undefined,
    ...(e2ee ? { e2ee } : {})
  }
}
