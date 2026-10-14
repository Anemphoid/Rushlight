import { useState, useMemo } from 'react'
import AuthLayout from './AuthLayout'
import { keyWords, pickCheckPositions, checkAnswers } from '../recoveryKey'

// Shows a recovery key once and won't let the person continue until they have saved it,
// ticked that they understand, and typed a few of its words back. `onConfirm` tells the
// server the key counts (and may throw, in which case the message is shown).
// Used at sign-up, after a password reset, on the one-time prompt for older accounts,
// and when regenerating a key from Settings.
function RecoveryKeyScreen({ title = 'Save your recovery key', recoveryKey, onConfirm, onCancel, cancelLabel = 'Cancel', confirmLabel = 'I saved it, continue' }) {
  const words = useMemo(() => keyWords(recoveryKey), [recoveryKey])
  const positions = useMemo(() => pickCheckPositions(words.length), [words.length])
  const [understood, setUnderstood] = useState(false)
  const [answers, setAnswers] = useState(() => positions.map(() => ''))
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const ready = understood && checkAnswers(recoveryKey, positions, answers)

  async function copy() {
    try {
      await navigator.clipboard.writeText(words.join(' '))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked: the words are on screen to write down
    }
  }

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      await onConfirm()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      heading={title}
      sub="This key is the only way back into your account if you forget your password. It is shown once. No one can recover it for you: not the server admin and not the developer."
      wide
    >
      <div className="key-grid" aria-label="Your recovery key">
        {words.map((w, i) => (
          <div className="key-word" key={i}>
            <span className="key-num">{i + 1}</span>
            {w}
          </div>
        ))}
      </div>
      <button type="button" className="auth-secondary block" onClick={copy}>
        {copied ? 'Copied' : 'Copy the key'}
      </button>
      <p className="auth-hint">Write it down or save it in a password manager, somewhere that is not this computer alone.</p>

      <label className="auth-check block">
        <input type="checkbox" id="keyUnderstood" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
        I understand that if I lose both my password and this key, my account can't be recovered.
      </label>

      <p className="auth-hint">To check you saved it, type these words from the key:</p>
      <div className="key-check">
        {positions.map((pos, i) => (
          <div className="auth-field" key={pos}>
            <label htmlFor={'key-word-' + pos}>Word {pos + 1}</label>
            <input
              id={'key-word-' + pos}
              value={answers[i]}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(e) => setAnswers((a) => a.map((v, j) => (j === i ? e.target.value : v)))}
            />
          </div>
        ))}
      </div>

      <button type="button" className="auth-primary" disabled={!ready || busy} onClick={confirm}>
        {busy ? 'Saving…' : confirmLabel}
      </button>
      {error && <div className="auth-error">{error}</div>}
      {onCancel && (
        <p className="auth-alt">
          <button type="button" className="auth-link strong" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
        </p>
      )}
    </AuthLayout>
  )
}

export default RecoveryKeyScreen
