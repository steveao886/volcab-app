const KEYS = {
  token: 'volcab.token',
  owner: 'volcab.owner',
  words: 'volcab.words',
  wordsSha: 'volcab.wordsSha',
  progress: 'volcab.progress',
  progressSha: 'volcab.progressSha',
  dirty: 'volcab.dirty',
} as const

export type StorageKey = keyof typeof KEYS

export const storage = {
  get<T>(key: StorageKey): T | null {
    const raw = localStorage.getItem(KEYS[key])
    if (raw == null) return null
    try { return JSON.parse(raw) as T } catch { return null }
  },
  set(key: StorageKey, value: unknown): void {
    localStorage.setItem(KEYS[key], JSON.stringify(value))
  },
  remove(key: StorageKey): void {
    localStorage.removeItem(KEYS[key])
  },
  clearAll(): void {
    for (const k of Object.values(KEYS)) localStorage.removeItem(k)
  },
}
