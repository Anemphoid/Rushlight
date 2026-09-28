import { useState, useRef, useEffect } from 'react'
import Avatar from './Avatar'

function TextChatView({ roomName, screenName, avatarColor, messages, onSend, localOnly, persistent }) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const listRef = useRef(null)

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  async function sendMessage(e) {
    e.preventDefault()
    if (!draft.trim() || sending) return
    setSending(true)
    setSendError('')
    try {
      await onSend({
        author: screenName || 'You',
        avatarColor,
        text: draft.trim(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      })
      setDraft('')
    } catch (err) {
      // Keep the draft so nothing typed is lost.
      setSendError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="text-chat">
      <div className="text-chat-header">
        <span className="mode-label">t</span>
        {roomName}
        {!localOnly && (
          <span className="chat-retention">
            {persistent ? 'history is kept' : 'cleared when everyone leaves'}
          </span>
        )}
      </div>

      <div className="text-chat-list" ref={listRef}>
        {messages.length === 0 && (
          <p className="settings-note" style={{ textAlign: 'center', marginTop: 20 }}>
            {localOnly
              ? "No messages yet. Guest chat isn't saved or shared — sign in with an account for shared history."
              : 'No messages yet.'}
          </p>
        )}
        {messages.map((m, i) => (
          <div className="text-chat-message" key={i}>
            <Avatar color={m.avatarColor} name={m.author} size={36} />
            <div className="text-chat-message-content">
              <div className="text-chat-message-meta">
                <strong>{m.author}</strong>
                <span className="settings-note" style={{ margin: 0 }}>
                  {m.time}
                </span>
              </div>
              <div className="text-chat-message-body">{m.text}</div>
            </div>
          </div>
        ))}
      </div>

      {sendError && (
        <div className="error-text" style={{ padding: '0 16px 6px' }}>
          {sendError}
        </div>
      )}

      <form className="text-chat-composer" onSubmit={sendMessage}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Message ${roomName}`}
        />
        <button type="submit" className="btn-primary" style={{ width: 'auto', padding: '0 18px' }}>
          Send
        </button>
      </form>
    </div>
  )
}

export default TextChatView
