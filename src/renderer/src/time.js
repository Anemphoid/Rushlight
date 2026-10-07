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
