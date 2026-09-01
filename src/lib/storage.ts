// `volcab.words` used to live here too. The words cache moved to IndexedDB on
// 2026-09-01 (src/lib/wordsCache.ts): at 840,626 UTF-16 code units it was
// 86% of a footprint heading for WebKit's 5 MiB quota, and the one payload
// that only grows. boot() removes the leftover key once so the space is
// actually reclaimed. Do not reuse the name.
const KEYS = {
  token: 'volcab.token',
  owner: 'volcab.owner',
  wordsSha: 'volcab.wordsSha',
  progress: 'volcab.progress',
  progressSha: 'volcab.progressSha',
  dirty: 'volcab.dirty',
  wordOps: 'volcab.wordOps',   // Word-list additions/deletions not yet confirmed pushed to the remote; must be replayed after a process restart
  staging: 'volcab.staging',       // Local copy of the staging area for new words (staging.json)
  stagingSha: 'volcab.stagingSha',
  stagingOps: 'volcab.stagingOps', // Word collections not yet confirmed pushed to the remote, same mechanism as wordOps
  // How many times each passage has been served, by id. The passage picker
  // hands the next turn to whichever passage has the lowest count, which is
  // what levels them out; see pickPassage for why a count replaced the old
  // score-and-recency-window pair. Superseded 'volcab.recentPassages', whose
  // leftovers are harmless and simply stop being read.
  //
  // Local, not synced, for the same reason the recency lists below are: a
  // second device keeping its own tally costs one early repeat, while a new
  // field in progress.json costs a migration on a file three devices write.
  passagePlays: 'volcab.passagePlays',
  recentRecall: 'volcab.recentRecall',     // Prompts (zh) of recently answered 回想 questions, same contract and same reasoning as recentPassages
  // Prompts the user pressed 巩固 on: they jump the queue next 回想 session
  // and are cleared once answered right. Local, like the two above — but
  // note this one is *not* interchangeable with pulling the word's due date
  // forward. That sends the word to /review, which tests headword→meaning;
  // a 回想 failure is meaning→headword and has to come back in that
  // direction to have been practised at all.
  recallDebt: 'volcab.recallDebt',
  recentCompose: 'volcab.recentCompose', // Chinese prompts of recently answered 组句 questions, windowed the same way
  recentContrast: 'volcab.recentContrast', // Pair keys (id|id, sorted) of recently answered 辨析 questions — the surface the repetition audit found going stale first

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
  /**
   * Returns false instead of throwing when the browser refuses the write.
   * localStorage is the nearest hard ceiling this app has: measured
   * 2026-09-01, the words + progress caches sit at 977,624 UTF-16 code
   * units, about 37% of WebKit's 5 MiB quota, and grow ~1,400 per word. The
   * old `void` signature let a QuotaExceededError escape from inside a click
   * handler, so at the limit every grade was lost before setState ran.
   *
   * Most callers ignore the result on purpose: recency lists, drill markers
   * and the pending-op queues are conveniences whose loss costs a repeat.
   * The store checks it for `progress`, the one write that is data.
   */
  set(key: StorageKey, value: unknown): boolean {
    try {
      localStorage.setItem(KEYS[key], JSON.stringify(value))
      return true
    } catch {
      return false
    }
  },
  remove(key: StorageKey): void {
    localStorage.removeItem(KEYS[key])
  },
  clearAll(): void {
    for (const k of Object.values(KEYS)) localStorage.removeItem(k)
  },
}
