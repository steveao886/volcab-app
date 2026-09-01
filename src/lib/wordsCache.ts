import type { Word } from '../types'

/**
 * The only async cache in the app. See
 * docs/superpowers/specs/2026-09-01-architecture-hardening-design.md §1b for
 * why words left localStorage: measured that day, the words cache was
 * 840,626 of the 977,624 UTF-16 code units the two caches took (86%), on a
 * 5 MiB WebKit quota -- about 1,900 words -- and it is the one payload that
 * only grows. IndexedDB has no comparable ceiling. Progress stays in
 * localStorage, where at ~215 code units per entry the same quota is
 * reached around 12,000 words.
 *
 * Every method resolves; none rejects. A cache that cannot be read is "no
 * cache" (the app downloads words on boot, as a fresh device does), and one
 * that cannot be written costs one download next boot. The network copy is
 * authoritative, so neither is an error worth surfacing.
 */
export interface WordsCache {
  /** Whatever was stored, unvalidated; the caller runs isWord over it (read side lenient). null when empty. */
  read(): Promise<unknown>
  /** Resolves false when the browser refused the write; the caller treats that as "no cache", never as an error. */
  write(words: Word[]): Promise<boolean>
  clear(): Promise<void>
}

/** In-memory implementation: the test seed, and the fallback when IndexedDB is unavailable. */
export function createMemoryWordsCache(initial: unknown = null): WordsCache {
  let value: unknown = initial
  return {
    async read() { return value },
    async write(words) { value = words; return true },
    async clear() { value = null },
  }
}

/**
 * IndexedDB-backed: one object store, one key. Falls back to a fresh memory
 * cache when `indexedDB` is undefined (happy-dom, some embedded browsers),
 * when open() throws (a private mode that refuses storage), or when the open
 * request fails or is blocked. The fallback is decided once per factory call
 * and kept for the session, so a device without IndexedDB simply downloads
 * words on every boot -- the lenient reading of "no cache".
 *
 * Not idb-keyval: 600 bytes, but a fourth runtime dependency for a
 * sixty-line wrapper (spec §1b).
 */
export function createIndexedDbWordsCache(dbName = 'volcab', storeName = 'kv', key = 'words'): WordsCache {
  const fallback = createMemoryWordsCache()
  let opening: Promise<IDBDatabase | null> | null = null

  const open = (): Promise<IDBDatabase | null> => {
    if (opening) return opening
    opening = new Promise<IDBDatabase | null>(resolve => {
      try {
        if (typeof indexedDB === 'undefined') { resolve(null); return }
        const req = indexedDB.open(dbName, 1)
        req.onupgradeneeded = () => { req.result.createObjectStore(storeName) }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(null)
        req.onblocked = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
    return opening
  }

  /**
   * One request in one transaction, as a promise. A write over the quota
   * aborts the transaction rather than erroring the request, so both are
   * watched; the second settle of an already-settled promise is a no-op.
   */
  const request = <T>(
    db: IDBDatabase, mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      try {
        const tx = db.transaction(storeName, mode)
        const req = op(tx.objectStore(storeName))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        tx.onabort = () => reject(tx.error)
      } catch (e) {
        reject(e)
      }
    })

  return {
    async read() {
      const db = await open()
      if (!db) return fallback.read()
      try {
        const value: unknown = await request(db, 'readonly', s => s.get(key))
        return value ?? null
      } catch {
        return null
      }
    },
    async write(words) {
      const db = await open()
      if (!db) return fallback.write(words)
      try {
        await request(db, 'readwrite', s => s.put(words, key))
        return true
      } catch {
        return false
      }
    },
    async clear() {
      const db = await open()
      if (!db) return fallback.clear()
      try {
        await request(db, 'readwrite', s => s.delete(key))
      } catch {
        // Nothing to clear, or nothing that can be done about it: the next login overwrites the key anyway
      }
    },
  }
}

/** The app's cache. AppProvider takes it as a prop so store.test.tsx can seed a memory cache the way it seeds the fake remote. */
export const wordsCache: WordsCache = createIndexedDbWordsCache()
