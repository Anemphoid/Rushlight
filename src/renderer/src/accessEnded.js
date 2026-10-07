// What to tell someone whose server stopped letting them in. Newer servers say why
// (expired, removed or banned) with a plain message of their own, which is used
// as it is. An older server sends no reason, so the old wording stays.
export function accessEndedNotice(err) {
  if (err && err.reason && err.message) return err.message
  return 'You were removed from this server.'
}
