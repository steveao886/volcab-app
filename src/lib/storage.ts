const KEYS = {
  token: 'volcab.token',
  owner: 'volcab.owner',
  words: 'volcab.words',
  wordsSha: 'volcab.wordsSha',
  progress: 'volcab.progress',
  progressSha: 'volcab.progressSha',
  dirty: 'volcab.dirty',
  wordOps: 'volcab.wordOps',   // Word-list additions/deletions not yet confirmed pushed to the remote; must be replayed after a process restart
  staging: 'volcab.staging',       // Local copy of the staging area for new words (staging.json)
  stagingSha: 'volcab.stagingSha',
  stagingOps: 'volcab.stagingOps', // Word collections not yet confirmed pushed to the remote, same mechanism as wordOps
  recentPassages: 'volcab.recentPassages', // Ids of recently done passages. Only guards against repeats — not worth adding a sync field in progress.json for this
  // The day (YYYY-MM-DD) each practice drill was last completed, so it
  // isn't offered twice over. Same call as recentPassages: a second device
  // offering the session again is a much smaller cost than a new synced
  // field would be. They deliberately can't live in dailyStats either —
  // mergeProgress rebuilds those entries from four named fields, so a
  // fifth would be silently dropped on every merge.
  //
  // A local marker is also the *only* correct place for this. The obvious
  // alternative, stamping lastReviewedAt when a drill card is answered
  // correctly, would mean a word whose content didn't change carries the
  // newest timestamp — and mergeProgress takes the entry with the later
  // lastReviewedAt whole, so that stale copy would overwrite a real review
  // done on another device.
  consolidatedOn: 'volcab.consolidatedOn',
  lapseDrilledOn: 'volcab.lapseDrilledOn',
  // The day the interval modifier was last changed. Retention measured
  // before that describes the old setting, so the tuning advice reads only
  // the days after it — see retentionWindowDays. Local for the same reason
  // as the two above: a second device re-offering the advice costs far less
  // than a synced field, and being wrong here only delays a suggestion.
  intervalTunedOn: 'volcab.intervalTunedOn',
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
