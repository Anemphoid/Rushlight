// How long persistent history is kept, in words people can read. The server decides (3, 6, 9 or 12 months,
// 12 by default); the client only reports it plainly wherever someone creates or reads persistent chat.
export const RETENTION_CHOICES = [3, 6, 9, 12]

export function retentionLabel(months) {
  return `${months} months`
}

// The sentence shown when a persistent room or channel is being made.
export function keptNotice(months) {
  return `History is kept for ${retentionLabel(months)}, then the oldest messages are deleted.`
}
