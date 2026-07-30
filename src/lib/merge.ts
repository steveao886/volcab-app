import type { DailyStat, Progress, SprintRecord } from '../types'

/**
 * Merges one optional counter the same way as the required ones (higher
 * wins), but **omits the key entirely when neither side has it**.
 *
 * Writing 0 instead would assert "no scheduled reviews happened that day"
 * about a day recorded by a build that couldn't measure it — a claim the
 * data doesn't support, and one the retention chart would then draw.
 */
function maxOptional(
  key: 'reviewPhase' | 'reviewPhaseCorrect',
  a: DailyStat,
  b: DailyStat,
): Partial<DailyStat> {
  if (a[key] === undefined && b[key] === undefined) return {}
  return { [key]: Math.max(a[key] ?? 0, b[key] ?? 0) }
}

/**
 * The sprint record with the higher score wins; **on a tie, the earlier date wins** — the
 * first time it was achieved is the record, and matching it later shouldn't overwrite the
 * date to today. If one side is missing (progress pushed up from an older App version
 * lacks this field), the other side wins; if both are missing, returns undefined.
 */
function pickBestSprint(a: SprintRecord | undefined, b: SprintRecord | undefined): SprintRecord | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  if (a.score !== b.score) return a.score > b.score ? a : b
  return a.date <= b.date ? a : b
}

export function mergeProgress(local: Progress, remote: Progress): Progress {
  const words: Progress['words'] = { ...remote.words }
  for (const [id, le] of Object.entries(local.words)) {
    const re = words[id]
    if (!re || le.lastReviewedAt >= re.lastReviewedAt) words[id] = le
  }

  const dailyStats: Progress['dailyStats'] = {}
  const days = new Set([...Object.keys(local.dailyStats), ...Object.keys(remote.dailyStats)])
  for (const day of days) {
    const a = local.dailyStats[day], b = remote.dailyStats[day]
    if (!a || !b) { dailyStats[day] = a ?? b; continue }
    dailyStats[day] = {
      reviewed: Math.max(a.reviewed, b.reviewed),
      newLearned: Math.max(a.newLearned, b.newLearned),
      correct: Math.max(a.correct, b.correct),
      quizTaken: Math.max(a.quizTaken, b.quizTaken),
      // **Every field of DailyStat has to be listed here.** This function
      // rebuilds the entry from named fields rather than spreading, so
      // anything it doesn't know about is silently dropped on every merge —
      // a field could be written correctly all day and then vanish the
      // first time two devices sync.
      ...maxOptional('reviewPhase', a, b),
      ...maxOptional('reviewPhaseCorrect', a, b),
    }
  }

  // settings wins by updatedAt, and is carried over wholesale.
  // This used to be "local always wins," which meant settings could never sync across
  // devices: device A changes a setting and pushes, device B merges with local winning and
  // pushes back, wiping out A's change. A missing timestamp is treated as the oldest —
  // so "a device that never touched settings" defers to "a device that did," instead of
  // pushing its own defaults back over the change.
  const lt = local.settings.updatedAt ?? ''
  const rt = remote.settings.updatedAt ?? ''
  const settings = rt > lt ? remote.settings : local.settings

  const bestSprint = pickBestSprint(local.bestSprint, remote.bestSprint)

  // When neither side has a record, **omit the key entirely** rather than writing
  // `bestSprint: undefined`: the latter would make `Object.hasOwn(p, 'bestSprint')` true,
  // and would also cause a structural-equality assertion to judge it unequal to a progress
  // object that genuinely lacks the key.
  return bestSprint === undefined
    ? { version: 1, settings, words, dailyStats }
    : { version: 1, settings, words, dailyStats, bestSprint }
}
