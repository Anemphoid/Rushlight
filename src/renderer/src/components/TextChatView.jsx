import Icon from './Icon'
import { useState, useRef, useEffect, Fragment } from 'react'
import Avatar from './Avatar'
import ChatImage from './ChatImage'
import { prepareImage, isPictureFile } from '../imagePrep'
import { avatarUrl } from '../api'
import { redactionBars } from '../redaction'
import { dayKey, dayLabel } from '../time'
import jellyboxImage from '../assets/images/jellybox.png'

// When a message was written. A guest's local-only message has no stored time, so it is today's.
const when = (m) => m.createdAt || Date.now()

function TextChatView({ roomName, screenName, avatarColor, messages, onSend, onSendImage, sessionToken, localOnly, persistent, retentionMonths, encrypted, keyState }) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const listRef = useRef(null)
  const fileInput = useRef(null)
  // A picture chosen but not yet sent: { blob, previewUrl }. The draft becomes its caption.
  const [pending, setPending] = useState(null)
  const [preparing, setPreparing] = useState(false)
  const [dragging, setDragging] = useState(false)
  // In an encrypted server a picture is sealed on this computer, which needs the server's key.
  const canSendImages = !localOnly && !!onSendImage && !!sessionToken && (!encrypted || keyState === 'ready')
  // This computer cannot write here until it holds the server's key (it arrives from another member's Rushlight).
  const noKey = !!encrypted && (keyState === 'waiting' || keyState === 'problem')
  // True while the person is at (or near) the bottom. The list is replaced on every poll, so only
  // follow new messages when they were already reading the latest; scrolling up must stay put.
  const stickRef = useRef(true)

  function onListScroll() {
    const el = listRef.current
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  useEffect(() => {
    stickRef.current = true // a different room starts at the latest message
  }, [roomName])

  useEffect(() => {
    if (listRef.current && stickRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages, roomName])

  useEffect(() => {
    return () => {
      if (pending) URL.revokeObjectURL(pending.previewUrl)
    }
  }, [pending])

  useEffect(() => {
    setPending(null) // a picture chosen for one room is not sent to another
  }, [roomName])

  async function choosePicture(file) {
    if (!canSendImages || !file) return
    setSendError('')
    if (!isPictureFile(file)) {
      setSendError("That isn't a picture.")
      return
    }
    setPreparing(true)
    try {
      const { blob, width, height } = await prepareImage(file)
      setPending({ blob, width, height, previewUrl: URL.createObjectURL(blob) })
    } catch (err) {
      setSendError(err.message)
    } finally {
      setPreparing(false)
    }
  }

  function onPaste(e) {
    const file = [...(e.clipboardData?.files || [])].find(isPictureFile)
    if (file && canSendImages) {
      e.preventDefault()
      choosePicture(file)
    }
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = [...(e.dataTransfer?.files || [])].find(isPictureFile)
    if (file) choosePicture(file)
  }

  async function sendMessage(e) {
    e.preventDefault()
    if ((!draft.trim() && !pending) || sending || preparing) return
    setSending(true)
    setSendError('')
    stickRef.current = true // their own message always scrolls into view
    try {
      if (pending) {
        await onSendImage(pending.blob, { text: draft.trim(), avatarColor, width: pending.width, height: pending.height })
        setPending(null)
      } else {
        await onSend({
          author: screenName || 'You',
          avatarColor,
          text: draft.trim(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        })
      }
      setDraft('')
    } catch (err) {
      // Keep the draft so nothing typed is lost.
      setSendError(err.message)
    } finally {
      setSending(false)
    }
  }

  // Messages already in the room when it opens appear as they are; ones that arrive after it is open ease in.
  const opened = useRef({ room: null, count: 0 })
  if (opened.current.room !== roomName) opened.current = { room: roomName, count: messages.length === 0 ? -1 : messages.length }
  else if (opened.current.count === -1 && messages.length > 0) opened.current.count = messages.length
  const isNew = (i) => opened.current.count >= 0 && i >= opened.current.count

  return (
    <div
      className={'text-chat' + (dragging ? ' drop-target' : '')}
      onDragOver={(e) => {
        if (canSendImages && [...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <div className="text-chat-header">
        <Icon name="text" size={18} />
        <span className="text-chat-title">{roomName}</span>
        {encrypted && (
          <span className="chat-encrypted" title="Only the people in this server can read this. The server only stores scrambled text.">
            encrypted
          </span>
        )}
        {!localOnly && (
          <span className="chat-retention">
            {persistent ? (retentionMonths ? `history kept for ${retentionMonths} months` : 'history is kept') : 'cleared when everyone leaves'}
          </span>
        )}
      </div>

      {noKey && (
        <div className="key-notice" role="status">
          {keyState === 'problem'
            ? "Couldn't get this server's key. Check your connection; Rushlight keeps trying."
            : "This computer doesn't have this server's key yet. It arrives when another member opens Rushlight, so messages stay hidden until then."}
        </div>
      )}
      <div className="text-chat-list" ref={listRef} onScroll={onListScroll}>
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
            <div className={'text-chat-message redacted-message' + (isNew(i) ? ' msg-new' : '')}>
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
          <div className={'text-chat-message' + (isNew(i) ? ' msg-new' : '')}>
            <Avatar color={m.avatarColor} name={m.author} imageUrl={m.bot ? jellyboxImage : avatarUrl(m.authorId, m.avatarUpdatedAt)} size={36} />
            <div className="text-chat-message-content">
              <div className="text-chat-message-meta">
                <strong>{m.author}</strong>
                {m.bot && <span className="member-badge">bot</span>}
                <span className="settings-note" style={{ margin: 0 }}>
                  {m.time}
                </span>
              </div>
              {m.locked ? (
                <div className="text-chat-message-body locked-message">
                  {m.locked === 'no_key' ? "Can't be read on this computer yet." : 'This message could not be opened.'}
                </div>
              ) : (
                m.text && <div className="text-chat-message-body">{m.text}</div>
              )}
              {m.image && !m.locked && sessionToken && <ChatImage key={m.image.id} image={m.image} token={sessionToken} author={m.author} />}
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

      {(pending || preparing) && (
        <div className="composer-picture">
          {pending ? <img src={pending.previewUrl} alt="Picture ready to send" /> : <span className="settings-note">Getting the picture ready...</span>}
          {pending && <span className="settings-note">Add a caption if you like, then Send.</span>}
          {pending && (
            <button type="button" className="link-btn" onClick={() => setPending(null)}>
              remove
            </button>
          )}
        </div>
      )}
      <form className="text-chat-composer" onSubmit={sendMessage}>
        {canSendImages && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files && e.target.files[0]
                e.target.value = ''
                choosePicture(f)
              }}
            />
            <button
              type="button"
              className="btn-secondary composer-picture-btn"
              title="Send a picture (or paste or drop one here)"
              onClick={() => fileInput.current && fileInput.current.click()}
            >
              <Icon name="image" size={20} strokeWidth={1.7} />
              <span className="composer-btn-text">image</span>
            </button>
          </>
        )}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={onPaste}
          placeholder={pending ? 'Add a caption' : noKey ? 'Waiting for the key' : `Message in ${roomName}`}
          disabled={noKey}
        />
        <button type="submit" className="btn-primary composer-send" disabled={noKey}>
          <span className="composer-btn-text">Send</span>
          <Icon name="send" size={18} strokeWidth={2} />
        </button>
      </form>
    </div>
  )
}

export default TextChatView
