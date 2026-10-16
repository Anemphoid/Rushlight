// Where a computer keeps its encryption keys between runs. A store is scoped to one account on one server
// address (`scope`), because device ids belong to that server's database. Two kinds:
//   - the device identity: the non-extractable private CryptoKey (structured-cloned straight into IndexedDB,
//     so its bytes are never available to this code), the public key text, and the id the server gave it;
//   - server keys: 32 bytes per server per epoch, which have to be readable so they can be wrapped again for
//     a new member or computer.
// The memory store is for tests and for a browser that refuses IndexedDB (nothing then survives a restart).

export function memoryStore() {
  const devices = new Map()
  const keys = new Map()
  return {
    kind: 'memory',
    async getDevice(scope) {
      return devices.get(scope) || null
    },
    async putDevice(scope, device) {
      devices.set(scope, device)
    },
    async getServerKeys(scope, serverId) {
      return new Map([...(keys.get(`${scope}|${serverId}`) || new Map())].map(([e, k]) => [e, new Uint8Array(k)]))
    },
    async putServerKey(scope, serverId, epoch, bytes) {
      const id = `${scope}|${serverId}`
      if (!keys.has(id)) keys.set(id, new Map())
      keys.get(id).set(epoch, new Uint8Array(bytes))
    },
    async clear(scope) {
      devices.delete(scope)
      for (const id of [...keys.keys()]) if (id.startsWith(scope + '|')) keys.delete(id)
    }
  }
}

const DB_NAME = 'rushlight-e2ee'
const DEVICE = 'device'
const KEYS = 'serverKeys'

function open(idb) {
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      db.createObjectStore(DEVICE)
      db.createObjectStore(KEYS)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const done = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

export function indexedDbStore(idb = globalThis.indexedDB) {
  let dbPromise = null
  const db = () => (dbPromise ||= open(idb))
  const tx = async (store, mode) => (await db()).transaction(store, mode).objectStore(store)
  return {
    kind: 'indexeddb',
    async getDevice(scope) {
      return (await done((await tx(DEVICE, 'readonly')).get(scope))) || null
    },
    async putDevice(scope, device) {
      await done((await tx(DEVICE, 'readwrite')).put(device, scope))
    },
    async getServerKeys(scope, serverId) {
      const store = await tx(KEYS, 'readonly')
      const prefix = `${scope}|${serverId}|`
      const out = new Map()
      const range = IDBKeyRange.bound(prefix, prefix + '￿')
      const keys = await done(store.getAllKeys(range))
      const values = await done(store.getAll(range))
      keys.forEach((k, i) => out.set(Number(k.slice(prefix.length)), new Uint8Array(values[i])))
      return out
    },
    async putServerKey(scope, serverId, epoch, bytes) {
      await done((await tx(KEYS, 'readwrite')).put(new Uint8Array(bytes), `${scope}|${serverId}|${epoch}`))
    },
    async clear(scope) {
      const d = await db()
      const t = d.transaction([DEVICE, KEYS], 'readwrite')
      t.objectStore(DEVICE).delete(scope)
      t.objectStore(KEYS).delete(IDBKeyRange.bound(scope + '|', scope + '|￿'))
      await new Promise((resolve, reject) => {
        t.oncomplete = resolve
        t.onerror = () => reject(t.error)
      })
    }
  }
}

// The store the app uses: IndexedDB where there is one, memory otherwise.
export function defaultStore() {
  try {
    if (globalThis.indexedDB) return indexedDbStore()
  } catch {
    // fall through
  }
  return memoryStore()
}
