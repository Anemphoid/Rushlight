import { useState, useEffect } from 'react'
import Icon from './Icon'
import { useClosing } from './ViewTransition'

// Add a server: make a new one, or join one with a code. Esc, Cancel and the close button leave it.
function ServerDialog({ onCreate, onJoin, onClose: leave }) {
  const [closing, onClose] = useClosing(leave)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  async function run(fn) {
    setError('')
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function handleCreate(e) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Give the server a name.')
      return
    }
    run(() => onCreate(name.trim()))
  }

  function handleJoin(e) {
    e.preventDefault()
    if (!code.trim()) {
      setError('Enter a join code.')
      return
    }
    run(() => onJoin(code.trim()))
  }

  return (
    <div className={'poll-backdrop rl-backdrop' + (closing ? ' closing' : '')}>
      <div className="rl-dialog" role="dialog" aria-modal="true" aria-labelledby="server-dialog-title">
        <div className="rl-dialog-head">
          <h2 id="server-dialog-title">Add a server</h2>
          <button type="button" className="rl-dialog-x" aria-label="Close" title="Close (Esc)" onClick={onClose}>
            <Icon name="close" size={18} strokeWidth={2} />
          </button>
        </div>

        <form onSubmit={handleCreate} className="rl-dialog-section">
          <label htmlFor="server-name-input">Create a new server</label>
          <div className="rl-dialog-row">
            <input id="server-name-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Server name" autoFocus />
            <button type="submit" className="rl-dialog-primary" disabled={busy}>
              Create server
            </button>
          </div>
        </form>

        <div className="rl-dialog-or">or join with a code</div>

        <form onSubmit={handleJoin} className="rl-dialog-section">
          <label htmlFor="server-code-input">Join code</label>
          <div className="rl-dialog-row">
            <input id="server-code-input" className="mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="word-word-1234" autoComplete="off" spellCheck={false} />
            <button type="submit" className="rl-dialog-secondary" disabled={busy}>
              Join server
            </button>
          </div>
        </form>

        {error && <div className="rl-dialog-error">{error}</div>}

        <div className="rl-dialog-foot">
          <button type="button" className="rl-dialog-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export default ServerDialog
