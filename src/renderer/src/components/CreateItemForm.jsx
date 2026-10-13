import { useState } from 'react'
import { keptNotice } from '../retention'

function CreateItemForm({ kind, onCancel, onCreate, retentionMonths }) {
  const [name, setName] = useState('')
  const [mode, setMode] = useState('both')
  const [persistent, setPersistent] = useState(false)

  function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    onCreate({ name: name.trim(), mode, persistent })
  }

  return (
    <form className="create-form" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder={kind === 'channel' ? 'Channel name' : 'Room name'}
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <div className="mode-row">
        {['voice', 'text', 'both'].map((m) => (
          <button
            type="button"
            key={m}
            className={'mode-chip' + (mode === m ? ' active' : '')}
            onClick={() => setMode(m)}
          >
            {m === 'both' ? 'Voice + Text' : m[0].toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>
      <div className="checkbox-row" style={{ marginBottom: 10 }}>
        <input
          type="checkbox"
          id={'persistent-' + kind}
          checked={persistent}
          onChange={(e) => setPersistent(e.target.checked)}
        />
        <label htmlFor={'persistent-' + kind} style={{ marginBottom: 0 }}>
          Persistent (keep history)
        </label>
      </div>
      {persistent && retentionMonths && (
        <p className="settings-note" style={{ marginTop: -4, marginBottom: 10 }}>
          {keptNotice(retentionMonths)}
        </p>
      )}
      <div className="create-form-actions">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn-primary">
          Create
        </button>
      </div>
    </form>
  )
}

export default CreateItemForm
