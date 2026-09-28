import { useState } from 'react'

function ServerDialog({ onCreate, onJoin, onClose }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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
    <div className="poll-backdrop">
      <div className="poll-card">
        <h2>Add a server</h2>

        <form onSubmit={handleCreate}>
          <div className="field">
            <label>Create a new server</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Server name"
              autoFocus
            />
          </div>
          <button type="submit" className="btn-primary" disabled={busy}>
            Create server
          </button>
        </form>

        <div className="dialog-divider">or</div>

        <form onSubmit={handleJoin}>
          <div className="field">
            <label>Join with a code</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. amber-falcon-42"
            />
          </div>
          <button type="submit" className="btn-secondary" disabled={busy}>
            Join server
          </button>
        </form>

        {error && <div className="error-text">{error}</div>}

        <button type="button" className="link-btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export default ServerDialog
