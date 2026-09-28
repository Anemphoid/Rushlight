import { useState, useRef, useEffect } from 'react'
import * as voice from '../voice'

function MicSpeakerCheck() {
  const [inputDevices, setInputDevices] = useState([])
  const [outputDevices, setOutputDevices] = useState([])
  const [selectedInput, setSelectedInput] = useState(() => voice.getSavedDevices().input)
  const [selectedOutput, setSelectedOutput] = useState(() => voice.getSavedDevices().output)
  const [testing, setTesting] = useState(false)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState('')
  const [speakerTesting, setSpeakerTesting] = useState(false)

  const streamRef = useRef(null)
  const audioCtxRef = useRef(null)
  const rafRef = useRef(null)

  async function refreshDeviceList() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const inputs = devices.filter((d) => d.kind === 'audioinput')
      const outputs = devices.filter((d) => d.kind === 'audiooutput')
      setInputDevices(inputs)
      setOutputDevices(outputs)
      // A remembered device that's been unplugged shouldn't stay selected.
      setSelectedInput((cur) => (cur && !inputs.some((d) => d.deviceId === cur) ? '' : cur))
      setSelectedOutput((cur) => (cur && !outputs.some((d) => d.deviceId === cur) ? '' : cur))
    } catch {
      // enumeration failing outright is rare — leave lists empty
    }
  }

  function stopMicTest() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close()
      audioCtxRef.current = null
    }
    setTesting(false)
    setLevel(0)
  }

  async function startMicTest() {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedInput ? { deviceId: { exact: selectedInput } } : true
      })
      streamRef.current = stream
      await refreshDeviceList() // device labels only populate after permission is granted

      const audioCtx = new AudioContext()
      audioCtxRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      const data = new Uint8Array(analyser.fftSize)

      function tick() {
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / data.length)
        // Rough sensitivity heuristic — normal speech should land mid-bar,
        // real tuning needs a live mic to check against.
        setLevel(Math.min(100, Math.round(rms * 280)))
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()
      setTesting(true)
    } catch (err) {
      setError(
        err.name === 'NotAllowedError'
          ? 'Microphone permission was denied.'
          : 'Could not access microphone: ' + err.message
      )
    }
  }

  function handleOutputChange(id) {
    setSelectedOutput(id)
    voice.setOutputDevice(id)
  }

  function handleInputChange(id) {
    setSelectedInput(id)
    voice.setInputDevice(id)
    if (testing) {
      stopMicTest()
      setTimeout(startMicTest, 50)
    }
  }

  async function testSpeaker() {
    setSpeakerTesting(true)
    try {
      const audioCtx = new AudioContext()
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume()
      }
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.frequency.value = 440
      gain.gain.setValueAtTime(0, audioCtx.currentTime)
      gain.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + 0.05)
      gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.6)
      osc.connect(gain)

      if (selectedOutput) {
        const dest = audioCtx.createMediaStreamDestination()
        gain.connect(dest)
        const audioEl = new Audio()
        audioEl.srcObject = dest.stream
        if (typeof audioEl.setSinkId === 'function') {
          try {
            await audioEl.setSinkId(selectedOutput)
          } catch {
            // unsupported or denied — falls back to the default output
          }
        }
        audioEl.play()
      } else {
        gain.connect(audioCtx.destination)
      }

      osc.start()
      osc.stop(audioCtx.currentTime + 0.65)
      setTimeout(() => {
        audioCtx.close()
        setSpeakerTesting(false)
      }, 700)
    } catch {
      setSpeakerTesting(false)
    }
  }

  useEffect(() => {
    refreshDeviceList()
    return () => stopMicTest()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const levelColor =
    level > 90 ? 'var(--danger)' : level > 70 ? 'var(--label)' : 'var(--accent)'

  return (
    <>
      <div className="field">
        <label>Microphone</label>
        <select value={selectedInput} onChange={(e) => handleInputChange(e.target.value)}>
          <option value="">System default</option>
          {inputDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || 'Microphone'}
            </option>
          ))}
        </select>
      </div>

      <div className="mic-meter">
        <div
          className="mic-meter-fill"
          style={{ width: level + '%', background: levelColor }}
        />
      </div>

      <button
        type="button"
        className="btn-secondary"
        style={{ marginBottom: 10 }}
        onClick={testing ? stopMicTest : startMicTest}
      >
        {testing ? 'Stop test' : 'Test microphone'}
      </button>
      {error && <div className="error-text">{error}</div>}

      <div className="field" style={{ marginTop: 6 }}>
        <label>Speaker</label>
        <select value={selectedOutput} onChange={(e) => handleOutputChange(e.target.value)}>
          <option value="">System default</option>
          {outputDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || 'Speaker'}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        className="btn-secondary"
        onClick={testSpeaker}
        disabled={speakerTesting}
      >
        {speakerTesting ? 'Playing…' : 'Test speaker'}
      </button>
    </>
  )
}

export default MicSpeakerCheck
