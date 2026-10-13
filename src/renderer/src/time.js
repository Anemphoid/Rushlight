// Small, readable time labels shared by the admin screens.

// "42m left", "5h left", "3d left", for a future timestamp (ms).
export function formatExpiry(ts) {
  if (!ts) return null
  const diffMs = ts - Date.now()
  if (diffMs <= 0) return 'expiring now'
  const mins = Math.round(diffMs / 60000)
  if (mins < 60) return `${mins}m left`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h left`
  return `${Math.round(hours / 24)}d left`
}

// "just now", "12m ago", "5h ago", "3d ago", for a past timestamp (ms).
export function formatAge(ts) {
  if (!ts) return ''
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// The calendar day a timestamp falls on, in the viewer's own timezone, as a sortable key.
export function dayKey(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

// "Today", "Yesterday", then the date ("Mon, Oct 5", with the year once it is not this year), all in the
// viewer's own timezone and language. `locale` is only for tests.
export function dayLabel(ts, now = Date.now(), locale = undefined) {
  if (dayKey(ts) === dayKey(now)) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (dayKey(ts) === dayKey(yesterday.getTime())) return 'Yesterday'
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear()
  return new Date(ts).toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

