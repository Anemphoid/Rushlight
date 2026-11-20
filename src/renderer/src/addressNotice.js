// What an owner or admin is told when the server's computer has a new network address (server v0.25.0 or later, which sends
// `addressChange` only to admins). Voice breaks quietly in that case, so the app says what happened, shows the new address and
// offers a message to send friends. Everything here comes from the server, so it is checked before it is shown or copied.
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/

const clean = (text, max) =>
  typeof text === 'string'
    ? // eslint-disable-next-line no-control-regex
      text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
    : ''

export function addressNoticeOf(data) {
  const a = data && data.addressChange
  if (!a || typeof a !== 'object') return null
  const configured = typeof a.configured === 'string' && IPV4.test(a.configured) ? a.configured : ''
  const suggested = typeof a.suggested === 'string' && IPV4.test(a.suggested) ? a.suggested : ''
  if (!configured) return null
  // The message is rebuilt only if it names the address the server suggested: anything else is not copied.
  const message = suggested && clean(a.message, 300).includes(`//${suggested}:`) ? clean(a.message, 300) : ''
  return { configured, suggested, message }
}
