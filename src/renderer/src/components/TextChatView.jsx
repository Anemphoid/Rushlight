import { useState, useRef, useEffect, Fragment } from 'react'
import Avatar from './Avatar'
import { avatarUrl } from '../api'
import { redactionBars } from '../redaction'
import { dayKey, dayLabel } from '../time'

// When a message was written. A guest's local-only message has no stored time, so it is today's.
const when = (m) => m.createdAt || Date.now()

function TextChatView({ roomName, screenName, avatarColor, messages, onSend, localOnly, persistent, retentionMonths }) {
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
            {persistent ? (retentionMonths ? `history kept for ${retentionMonths} months` : 'history is kept') : 'cleared when everyone leaves'}
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
          <Fragment key={i}>
            {i === 0 || dayKey(when(m)) !== dayKey(when(messages[i - 1])) ? (
              <div className="day-divider" role="separator">
                <span>{dayLabel(when(m))}</span>
              </div>
            ) : null}
          {m.redacted ? (
            // The author deleted their account: the server kept nothing, so this is only a mark.
            // No avatar, no name, no profile, and no text for anyone to select or copy.
            <div className="text-chat-message redacted-message">
              <div className="redacted-gutter" aria-hidden="true" />
              <div className="text-chat-message-content">
                <div className="text-chat-message-meta">
                  <span className="redacted-author" role="img" aria-label="Redacted author" />
                  <span className="settings-note" style={{ margin: 0 }}>
                    {m.time}
                  </span>
                </div>
                <div className="redacted-bars" role="img" aria-label="Redacted message">
                  {redactionBars(m.id).map((w, j) => (
                    <span className="redacted-bar" key={j} style={{ width: w + '%' }} />
                  ))}
                </div>
              </div>
            </div>
          ) : (
          <div className="text-chat-message">
            <Avatar color={m.avatarColor} name={m.author} imageUrl={avatarUrl(m.authorId, m.avatarUpdatedAt)} size={36} />
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
          )}
          </Fragment>
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
