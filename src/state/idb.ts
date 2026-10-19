const DB = 'kppu-hr'
const STORE = 'kv'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await open()
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE), req = tx.objectStore(STORE).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
    tx.onabort = () => reject(tx.error)
  }) } finally { db.close() }
}

export async function idbSet(key: string, value: unknown): Promise<boolean> {
  try {
    const db = await open()
    return await new Promise(resolve => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, key)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
    })
  } catch { return false }
}
