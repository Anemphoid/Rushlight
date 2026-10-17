// Safety numbers: a short number for a person, made from the public keys of all their devices, so two people can
// check (in person, or on a call they trust) that the server has not slipped a different key in for someone. Pure
// WebCrypto, same code in Electron and in the Node tests. Public keys only: nothing secret goes through here.
const enc = new TextEncoder()
const B64URL = /^[A-Za-z0-9_-]+$/

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
}

function fromB64url(text) {
  if (typeof text !== 'string' || !B64URL.test(text)) throw new Error('not a key')
  const pad = '='.repeat((4 - (text.length % 4)) % 4)
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

// 30 digits from 20 bytes of a hash, as six groups of five: "12345 67890 ...". Each group is 4 bytes mod 100000
// (the small bias is irrelevant for a number that is only ever compared whole).
function digits(hash, groups) {
  const out = []
  for (let g = 0; g < groups; g++) {
    const n = ((hash[g * 4] << 24) >>> 0) + (hash[g * 4 + 1] << 16) + (hash[g * 4 + 2] << 8) + hash[g * 4 + 3]
    out.push(String(n % 100000).padStart(5, '0'))
  }
  return out.join(' ')
}

// One device: shown next to its name so a person can tell which of their computers it is.
export async function deviceFingerprint(publicKey) {
  const key = fromB64url(publicKey)
  const hash = await sha256(new Uint8Array([...enc.encode('rushlight-device-v1\0'), ...key]))
  return digits(hash, 4)
}

// One person: all their current devices together, in a fixed order, so everyone computes the same number for them.
// It changes when they add or remove a computer, which is exactly when it should be checked again.
export async function safetyNumber(publicKeys) {
  const keys = [...new Set(publicKeys)].sort()
  if (keys.length === 0) return ''
  let all = [...enc.encode('rushlight-safety-v1\0')]
  for (const k of keys) {
    const bytes = fromB64url(k)
    all = all.concat([bytes.length], [...bytes])
  }
  return digits(await sha256(new Uint8Array(all)), 6)
}

// Groups the server's device list by person: { [accountId]: { accountId, username, devices, number } }.
export async function peopleFromDevices(devices) {
  const people = {}
  for (const d of devices) {
    if (!people[d.accountId]) people[d.accountId] = { accountId: d.accountId, username: d.username, devices: [] }
    people[d.accountId].devices.push(d)
  }
  for (const p of Object.values(people)) {
    p.number = await safetyNumber(p.devices.map((d) => d.publicKey))
    for (const d of p.devices) d.fingerprint = await deviceFingerprint(d.publicKey)
  }
  return people
}
