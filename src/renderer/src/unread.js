// Unread tracking for text spaces, plus desktop notifications. Kept outside
// React for the same reason as voice.js and the persistence-vote bookkeeping:
// the tree screen is rebuilt whenever you visit Settings, and what you have
// and haven't read must not reset when that happens.
//
// "Read" means the newest message id you've had in front of you. Spaces seen
// for the first time are baselined at their newest message, so opening a
// server never starts with a pile of old messages marked unread.
const SEEN_PREF = 'rushlight-seen-messages'
const NOTIFY_PREF = 'rushlight-notifications'

function load() {
  try {
    return JSON.parse(localStorage.getItem(SEEN_PREF) || '{}') || {}
  } catch {
    return {}
  }
}

let seen = load() // scoped space key -> newest message id read
let counts = {} // scoped space key -> unread messages
let notified = {} // scoped space key -> newest id already announced
let snapshot = {}
const listeners = new Set()

function save() {
  try {
    localStorage.setItem(SEEN_PREF, JSON.stringify(seen))
  } catch {
    // storage unavailable — read state just won't survive a restart
  }
}

function publish() {
  snapshot = { ...counts }
  listeners.forEach((l) => l())
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSnapshot() {
  return snapshot
}

export const scopedKey = (serverId, spaceKey) => `${serverId}:${spaceKey}`

export function notificationsEnabled() {
  try {
    return localStorage.getItem(NOTIFY_PREF) !== 'off'
  } catch {
    return true
  }
}

export function setNotificationsEnabled(on) {
  try {
    if (on) localStorage.removeItem(NOTIFY_PREF)
    else localStorage.setItem(NOTIFY_PREF, 'off')
  } catch {
    // ignore
  }
}

function notify(title, newOnes) {
  if (!notificationsEnabled() || typeof Notification === 'undefined') return
  const last = newOnes[newOnes.length - 1]
  const body =
    newOnes.length === 1
      ? `${last.author}: ${last.text}`
      : `${newOnes.length} new messages, latest from ${last.author}`
  try {
    const n = new Notification(title, { body, silent: true })
    n.onclick = () => window.focus()
  } catch {
    // notifications unavailable on this system
  }
}

// Called with each fresh batch of a space's messages. isOpen means it's the
// space on screen; if the window also has focus, it's being read right now.
export function observe({ key, title, messages, isOpen, selfId }) {
  const maxId = messages.reduce((m, msg) => (msg.id != null && msg.id > m ? msg.id : m), 0)
  if (!(key in seen) || seen[key] > maxId) {
    // First sight (or the server's ids started over): nothing before now counts.
    seen[key] = maxId
    notified[key] = maxId
    save()
  }
  if (isOpen && document.hasFocus()) {
    if (seen[key] !== maxId) {
      seen[key] = maxId
      save()
    }
    notified[key] = maxId
    if (counts[key]) {
      counts[key] = 0
      publish()
    }
    return
  }
  const fresh = messages.filter((m) => m.id != null && m.id > seen[key] && m.authorId !== selfId)
  if ((counts[key] || 0) !== fresh.length) {
    counts[key] = fresh.length
    publish()
  }
  const toAnnounce = fresh.filter((m) => m.id > (notified[key] || 0))
  if (toAnnounce.length) {
    notified[key] = toAnnounce[toAnnounce.length - 1].id
    notify(title, toAnnounce)
  }
}

// You opened a space: drop its dot now; the next fetch moves the read marker.
export function clear(key) {
  if (counts[key]) {
    counts[key] = 0
    publish()
  }
}
