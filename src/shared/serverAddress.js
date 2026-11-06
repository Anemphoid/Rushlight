// The address of the Rushlight server, as a person types it and as the app keeps it. Used by the main process (to check
// what is saved) and by the sign-in screens (to check what is typed), so both agree.

// 'http://192.168.68.70:4000' for '192.168.68.70:4000', 'http://host' for ' host ', or { error }. Only http and https, a host,
// no login in the address and nothing after the host and port: it is the server's front door, not a page on it.
export function normalizeServerAddress(input) {
  if (typeof input !== 'string') return { error: 'Enter the server address.' }
  let text = input.trim()
  if (!text) return { error: 'Enter the server address.' }
  if (text.length > 200) return { error: 'That address is too long.' }
  const schemeGiven = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
  if (!schemeGiven) {
    // "host:port" would otherwise read as a scheme called "host"
    if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^/]*:\d+(\/|$)/.test(text)) return { error: 'Use an address that starts with http:// or https://, or just the host and port.' }
    text = 'http://' + text
  }
  let url
  try {
    url = new URL(text)
  } catch {
    return { error: "That doesn't look like an address. Try something like 192.168.68.70:4000." }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: 'Use an address that starts with http:// or https://.' }
  if (!url.hostname) return { error: 'The address needs a host.' }
  if (url.username || url.password) return { error: 'The address should not include a user name or password.' }
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) return { error: 'Enter just the host and port, like 192.168.68.70:4000, with nothing after it.' }
  return { url: url.origin, schemeGiven }
}

// The addresses to try, in order. A typed scheme is taken as meant. With none, https first (a server behind a proxy with a
// certificate) and then http (a server on the home network), and whichever answers is the one saved.
export function candidateAddresses(input) {
  const checked = normalizeServerAddress(input)
  if (checked.error) return { error: checked.error }
  if (checked.schemeGiven) return { urls: [checked.url] }
  const host = checked.url.replace(/^http:\/\//, '')
  return { urls: [new URL('https://' + host).origin, checked.url] }
}

// What to show: the address without its scheme, as the sign-in screens always have.
export const displayAddress = (url) => (typeof url === 'string' ? url.replace(/^https?:\/\//, '') : '')

// The saved config after the address is changed: the new address, with `scopeId` (what this computer's encryption keys are
// filed under) kept as it was, or set to the old address the first time, so the same server at a new address still finds
// them and this computer is not mistaken for a new one. Throws with a plain message if the address is not usable.
export function withNewAddress(current, input) {
  const checked = normalizeServerAddress(input)
  if (checked.error) throw new Error(checked.error)
  return { ...current, serverUrl: checked.url, scopeId: current.scopeId || current.serverUrl }
}
