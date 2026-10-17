// What this computer remembers about other people's devices: which device ids it has already seen for each person
// (so a new one is noticed) and which safety number it was told to trust (the verified tick). Public numbers only,
// kept in localStorage per account on this server address. A tick holds only while the number is the same.
export function createTrust(storage, scope) {
  const key = (name) => `rushlight-trust:${name}:${scope}`
  const read = (name) => {
    try {
      const v = JSON.parse(storage.getItem(key(name)) || 'null')
      return v && typeof v === 'object' ? v : {}
    } catch {
      return {}
    }
  }
  const write = (name, value) => {
    try {
      storage.setItem(key(name), JSON.stringify(value))
    } catch {
      // won't persist; applies for this session only
    }
  }
  return {
    // null = this person has never been seen here (the first look only sets the baseline)
    seen(serverId, accountId) {
      const all = read('seen')
      const v = all[`${serverId}:${accountId}`]
      return Array.isArray(v) ? v : null
    },
    setSeen(serverId, accountId, ids) {
      const all = read('seen')
      all[`${serverId}:${accountId}`] = [...ids].sort((a, b) => a - b)
      write('seen', all)
    },
    verified(accountId) {
      const v = read('verified')[accountId]
      return typeof v === 'string' ? v : null
    },
    setVerified(accountId, number) {
      const all = read('verified')
      if (number) all[accountId] = number
      else delete all[accountId]
      write('verified', all)
    },
    forgetAll() {
      for (const name of ['seen', 'verified']) {
        try {
          storage.removeItem(key(name))
        } catch {
          // nothing to clear
        }
      }
    }
  }
}

// What to tell the person: for each other person (and for their own account), a new device since the last look,
// or a verified person whose number is no longer the one that was checked. `known` is { seen, verified } lookups.
// Returns { notices, baseline } where baseline lists [accountId, ids] to store silently for first sightings.
export function findNotices({ people, myAccountId, myDeviceId, trust, serverId }) {
  const notices = []
  const baseline = []
  for (const p of Object.values(people)) {
    const ids = p.devices.map((d) => d.id)
    const seen = trust.seen(serverId, p.accountId)
    if (seen === null) {
      baseline.push([p.accountId, ids])
      continue
    }
    const fresh = p.devices.filter((d) => !seen.includes(d.id) && d.id !== myDeviceId)
    const was = trust.verified(p.accountId)
    const changed = !!was && was !== p.number
    if (fresh.length === 0 && !changed) {
      // a device that only went away, or this computer: nothing to say, keep the record current
      if (ids.some((i) => !seen.includes(i))) baseline.push([p.accountId, ids])
      continue
    }
    notices.push({
      id: `${p.accountId}:${ids.join(',')}:${p.number}`,
      accountId: p.accountId,
      username: p.username,
      own: p.accountId === myAccountId,
      newDevices: fresh.map((d) => ({ id: d.id, label: d.label, createdAt: d.createdAt })),
      verifiedChanged: changed
    })
  }
  return { notices, baseline }
}
