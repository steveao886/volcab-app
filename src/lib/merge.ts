import type { BestRecord, DailyStat, Progress, RecallRating, RecallStat } from '../types'

/**
 * Two devices' 回想 records for one word.
 *
 * Split by what each field *is*, rather than one rule for the whole record:
 *
 * - `streak` and `lastAt` are a **state** — where retrieval stands right
 *   now. The later session is the truer picture, and a streak cannot be
 *   maxed anyway: it is order-dependent, so `max(3, 1)` would claim three
 *   consecutive correct answers that never happened.
 * - `reps` and `correct` are a **ledger**. Higher wins, the same rule
 *   DailyStat's counters use, so practice already done can never be
 *   subtracted by a sync.
 *
 * Undefined on both sides stays undefined rather than becoming a zeroed
 * record — the same call maxOptional makes, and for the same reason:
 * "never practised" and "practised zero times" are different claims and
 * only one of them is supported.
 */
function mergeRecall(a: RecallStat | undefined, b: RecallStat | undefined): RecallStat | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  const latest = a.lastAt >= b.lastAt ? a : b
  return {
    reps: Math.max(a.reps, b.reps),
    correct: Math.max(a.correct, b.correct),
    streak: latest.streak,
    lastAt: latest.lastAt,
  }
}

/**
 * The user's manual 回想 rating for one word: later `at` wins, full stop.
 *
 * One rule covers setting, changing **and** clearing, because clearing
 * writes `'none'` rather than removing the field. Had it removed the field,
 * this would have had to pick between "the side holding a value wins" —
 * which resurrects a rating the user just cleared on the other device, the
 * mirror of what unionDismissed exists to prevent — and dropping a rating
 * the moment one side has not synced it yet.
 *
 * Unlike mergeRecall there is nothing to split by field: a rating is one
 * indivisible statement of intent, not a state plus a ledger.
 */
function mergeRating(a: RecallRating | undefined, b: RecallRating | undefined): RecallRating | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return a.at >= b.at ? a : b
}

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
 * Per-mode tallies, merged key by key with the higher count winning on each
 * side of each mode — the same "higher wins" rule the flat counters use,
 * applied one level down.
 *
 * Not `Math.max` over a whole entry, and not "the side with more modes":
 * two devices can each play a different mode between syncs (回想 on the
 * phone, 短文 on the laptop), and either of those rules would throw one
 * away. Omitted entirely when neither side recorded any, for the same
 * reason as maxOptional — writing `{}` would assert "no quizzes that day"
 * about a day a build recorded before this field existed.
 */
function mergeQuizModes(a: DailyStat, b: DailyStat): Partial<DailyStat> {
  if (a.quizModes === undefined && b.quizModes === undefined) return {}
  const out: NonNullable<DailyStat['quizModes']> = {}
  for (const src of [a.quizModes, b.quizModes]) {
    if (src === null || typeof src !== 'object') continue
    for (const [mode, v] of Object.entries(src)) {
      // Hand-edited or older-build junk is skipped rather than trusted:
      // isDailyStat deliberately doesn't gate this field, so anything can
      // arrive here. Same reasoning as unionDismissed below.
      if (v === null || typeof v !== 'object') continue
      const asked = typeof v.asked === 'number' ? v.asked : 0
      const correct = typeof v.correct === 'number' ? v.correct : 0
      const prev = out[mode]
      out[mode] = prev === undefined
        ? { asked, correct }
        : { asked: Math.max(prev.asked, asked), correct: Math.max(prev.correct, correct) }
    }
  }
  return { quizModes: out }
}

/**
 * The record with the higher score wins; **on a tie, the earlier date wins** — the
 * first time it was achieved is the record, and matching it later shouldn't overwrite the
 * date to today. If one side is missing (progress pushed up from an older App version
 * lacks this field), the other side wins; if both are missing, returns undefined.
 *
 * Used for both personal bests — the sprint's and 猜词's. They are the same
 * shape and want the same tie-break, so they share the rule rather than
 * growing a second copy of it that could drift.
 */
function pickBest(a: BestRecord | undefined, b: BestRecord | undefined): BestRecord | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  if (a.score !== b.score) return a.score > b.score ? a : b
  return a.date <= b.date ? a : b
}

/**
 * Dismissed suggestions merge as a **union**, not "the longer list" and not
 * "one side wins": two devices can reject different suggestions between two
 * syncs, and every rejection is a deliberate "no" from the user. Dropping
 * either side's would resurrect those words in the next batch, which is the
 * one thing dismissing is supposed to prevent.
 *
 * Sorted, so the result is a function of the *set* alone. Concatenating in
 * merge order instead would make a∪b and b∪a differ only in ordering, and
 * every merge that changed nothing would still write a reshuffled array and
 * push a diff for it.
 *
 * Non-array input and non-string members are skipped rather than trusted:
 * isProgress deliberately doesn't gate this field (see the comment there),
 * so a hand-edited `"dismissed": [1, null]` reaches here intact, and
 * spreading a hand-edited `"dismissed": 7` would throw inside the boot path.
 * Same reasoning as mergeStaging skipping the empty key.
 */
function unionDismissed(a: Progress['dismissed'], b: Progress['dismissed']): string[] | undefined {
  if (a === undefined && b === undefined) return undefined
  const ids = new Set<string>()
  for (const list of [a, b]) {
    if (!Array.isArray(list)) continue
    for (const id of list) if (typeof id === 'string') ids.add(id)
  }
  return [...ids].sort()
}

export function mergeProgress(local: Progress, remote: Progress): Progress {
  const words: Progress['words'] = { ...remote.words }
  for (const [id, le] of Object.entries(local.words)) {
    const re = words[id]
    if (!re || le.lastReviewedAt >= re.lastReviewedAt) words[id] = le
  }
  // **Neither of these can ride the wholesale pick above.** That pick
  // resolves an entry by `lastReviewedAt`, which only the scheduler stamps
  // — 回想 deliberately writes nothing the scheduler owns. So a phone that
  // practised 回想 and a laptop that graded the same word in /review would
  // resolve to the laptop's entry, and every rep of that practice, plus any
  // rating the user set, would vanish on the next sync, silently and for
  // good. Each is merged on its own timestamp instead.
  for (const id of new Set([...Object.keys(local.words), ...Object.keys(remote.words)])) {
    const entry = words[id]
    if (entry === undefined) continue
    const recall = mergeRecall(local.words[id]?.recall, remote.words[id]?.recall)
    const recallRating = mergeRating(local.words[id]?.recallRating, remote.words[id]?.recallRating)
    // Spread conditionally rather than assigning undefined: absent on both
    // sides has to stay absent. An explicit `undefined` key survives every
    // in-memory comparison the tests make, even though JSON.stringify would
    // later drop it.
    words[id] = {
      ...entry,
      ...(recall === undefined ? {} : { recall }),
      ...(recallRating === undefined ? {} : { recallRating }),
    }
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
      ...mergeQuizModes(a, b),
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

  const bestSprint = pickBest(local.bestSprint, remote.bestSprint)
  const bestGuess = pickBest(local.bestGuess, remote.bestGuess)
  const dismissed = unionDismissed(local.dismissed, remote.dismissed)

  // When neither side has one of these, **omit the key entirely** rather than writing
  // `bestSprint: undefined`: the latter would make `Object.hasOwn(p, 'bestSprint')` true,
  // and would also cause a structural-equality assertion to judge it unequal to a progress
  // object that genuinely lacks the key.
  // Like the dailyStats entry above, this result is rebuilt from named fields, so **every
  // optional top-level field has to be listed here** or it is silently dropped the first
  // time two devices sync.
  return {
    version: 1, settings, words, dailyStats,
    ...(bestSprint === undefined ? {} : { bestSprint }),
    ...(bestGuess === undefined ? {} : { bestGuess }),
    ...(dismissed === undefined ? {} : { dismissed }),
  }
}
