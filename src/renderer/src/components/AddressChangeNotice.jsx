import { useState } from 'react'

// For owners and admins, across the top of a server: the computer that runs it has a new network address, so voice will not
// connect until the server's own settings are fixed (chat still works). The app cannot fix that, but it says what to do and
// gives a message to send friends, who type the new address under Settings > Connection.
function AddressChangeNotice({ notice }) {
  const [copied, setCopied] = useState(false)
  if (!notice) return null
  async function copy() {
    try {
      await navigator.clipboard.writeText(notice.message)
      setCopied(true)
    } catch {
      // clipboard blocked: the message is not shown on screen, so say so
      setCopied(false)
    }
  }
  return (
    <div className="device-notices" role="status">
      <div className="device-notice own">
        <span className="device-notice-text">
          <strong>This server's computer has a new address</strong>, so voice will not connect until it is fixed. Chat still works.{' '}
          {notice.suggested ? (
            <>
              It was {notice.configured} and is now {notice.suggested}. On that computer, run <code>./rushlight address</code>
              {' '}(or turn on <code>./rushlight autofix on</code> so it fixes itself next time). Then everyone types the new address under Settings,
              then Connection.
            </>
          ) : (
            <>
              It was {notice.configured} and this computer has no usable address right now (is it off the network?). Voice will work again when it is back.
            </>
          )}
        </span>
        {notice.message && (
          <button type="button" className="link-btn" onClick={copy}>
            {copied ? 'Copied' : 'Copy message for friends'}
          </button>
        )}
      </div>
    </div>
  )
}

export default AddressChangeNotice
