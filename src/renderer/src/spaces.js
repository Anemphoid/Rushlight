// Names for the spaces in a server's tree, by the keys presence uses.
//
// presence and the admin guest list refer to a space as 'channel:3' or 'room:7';
// this turns that into something to read: "General", or "General / Lobby" for a room.
export function spaceNameFor(channels, key) {
  if (!key || !Array.isArray(channels)) return null
  const [type, rawId] = String(key).split(':')
  const id = Number(rawId)
  for (const ch of channels) {
    if (type === 'channel' && ch.id === id) return ch.name
    if (type === 'room') {
      const room = (ch.rooms || []).find((r) => r.id === id)
      if (room) return `${ch.name} / ${room.name}`
    }
  }
  return null
}
