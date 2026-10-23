import type { BestRecord, DailyStat, DivergeStat, ForgetRecord, Progress, RecallRating, RecallStat, TangleStat } from '../types'
import { FORGET_LOG_LIMIT } from './forget'

/**
 * Local rather than imported from sync.ts: merge.ts is pure and must not pull
 * in the module that owns network I/O. Same predicate, three lines.
 */
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

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

/**
 * 发散 history, merged **per key** rather than by picking a side.
 *
 * Two devices play different concepts, so their records are largely disjoint;
 * a wholesale pick would throw one device's whole history away every time the
 * other synced. Within a key the two fields resolve differently on purpose:
 * `best` is a record and takes the maximum, like bestSprint, so it can only
 * ever go up; `size` and `lastAt` are a snapshot of one attempt and come from
 * whichever side attempted it later.
 *
 * Junk survives a hand-edited file the same way unionDismissed's does —
 * isProgress deliberately does not check this field, so anything can arrive
 * here, and a malformed entry is skipped rather than allowed to throw inside
 * the boot path.
 */
function mergeDiverge(a: Progress['diverge'], b: Progress['diverge']): Progress['diverge'] {
  if (a === undefined && b === undefined) return undefined
  const out: Record<string, DivergeStat> = {}
  for (const side of [a, b]) {
    if (!isRecord(side)) continue
    for (const [key, stat] of Object.entries(side)) {
      if (!isRecord(stat) || typeof stat.lastAt !== 'string') continue
      const best = typeof stat.best === 'number' ? stat.best : 0
      const size = typeof stat.size === 'number' ? stat.size : 0
      const cur = out[key]
      if (!cur) { out[key] = { best, size, lastAt: stat.lastAt }; continue }
      out[key] = stat.lastAt > cur.lastAt
        ? { best: Math.max(best, cur.best), size, lastAt: stat.lastAt }
        : { ...cur, best: Math.max(best, cur.best) }
    }
  }
  return out
}

// A build older than 'partial' skips it here; see ForgetRecord for why that heals.
const isForgetRecord = (v: unknown): v is ForgetRecord =>
  isRecord(v) && typeof v.at === 'string' && (v.kind === 'blank' || v.kind === 'confused' || v.kind === 'partial')

/**
 * Two devices' forget logs for one word: a **union keyed by `at`**, oldest
 * first, cut to the newest FORGET_LOG_LIMIT.
 *
 * A log, not a state, so neither "later side wins" (mergeRating) nor a
 * per-field split (mergeRecall) applies: every record is a lapse that really
 * happened, written once, and two devices lapse the same word on different
 * days between syncs. Picking a side would drop the other's lapses. The same
 * lapse seen from both sides carries the same `at` and collapses to one.
 *
 * The cap is applied to the union, after sorting, so what is cut is always
 * the oldest — and the result is a function of the two sets alone, which
 * lets both devices converge on the same ten instead of each keeping its own.
 *
 * Only `at` and `kind` are checked: they are what this function keys and
 * sorts on. A hand-edited `"forgot": 7` reaches here intact (isProgress does
 * not gate it), and anything unusable is skipped rather than allowed to throw
 * inside the boot path. When either side holds the field the result is an
 * array — an empty one if everything was junk — so that a malformed value on
 * the entry that won the whole-entry pick is overwritten, not carried through.
 */
export function mergeForgot(a: ForgetRecord[] | undefined, b: ForgetRecord[] | undefined): ForgetRecord[] | undefined {
  if (a === undefined && b === undefined) return undefined
  const byAt = new Map<string, ForgetRecord>()
  for (const log of [a, b]) {
    if (!Array.isArray(log)) continue
    for (const rec of log) if (isForgetRecord(rec) && !byAt.has(rec.at)) byAt.set(rec.at, rec)
  }
  return [...byAt.values()]
    .sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0))
    .slice(-FORGET_LOG_LIMIT)
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

/**
 * A tangle stat read leniently: rebuilt from its named fields, or undefined
 * when any field the runtime relies on is missing or the wrong shape.
 *
 * `doneOn` is the one field that may be absent, so a value that is present
 * but not a string is dropped instead of failing the stat — treated as
 * "not done", which only shows the tangle once more.
 */
function readTangle(v: unknown): TangleStat | undefined {
  if (!isRecord(v)) return undefined
  const { lastAt, bornOn, dueOn, doneOn, pairs, members, settled } = v
  if (typeof lastAt !== 'string' || typeof bornOn !== 'string' || typeof dueOn !== 'string') return undefined
  if (!isStringArray(pairs) || !isStringArray(members) || !isStringArray(settled)) return undefined
  return { pairs, members, settled, bornOn, dueOn, ...(typeof doneOn === 'string' ? { doneOn } : {}), lastAt }
}

/**
 * Tangles, merged **per key**, and within a key the later `lastAt` takes the
 * **whole stat** — the mergeDiverge pattern, minus a field to maximise.
 *
 * Not field by field: a stat is one state, and the later one is the truer
 * picture of it. A union of `settled` would carry members settled before a
 * reopen into the reopened tangle, and keeping a `doneOn` the later state no
 * longer has would close a tangle that is open again. Per key rather than a
 * pick of the whole map because two devices untangling different pairs have
 * disjoint keys, and every one of them has to survive.
 *
 * A tie keeps the first side seen, as diverge does. Skipping a malformed stat
 * lets the other side's copy of the same key stand, rather than throwing.
 *
 * **Every field of TangleStat has to be listed in readTangle**, for the same
 * reason as DailyStat's in mergeProgress: this rebuilds the stat, so a field
 * it does not name is dropped on the first sync.
 */
export function mergeTangles(a: Progress['tangles'], b: Progress['tangles']): Progress['tangles'] {
  if (a === undefined && b === undefined) return undefined
  const out: Record<string, TangleStat> = {}
  for (const side of [a, b]) {
    if (!isRecord(side)) continue
    for (const [key, raw] of Object.entries(side)) {
      const stat = readTangle(raw)
      if (stat === undefined) continue
      const cur = out[key]
      if (cur === undefined || stat.lastAt > cur.lastAt) out[key] = stat
    }
  }
  return out
}

/**
 * 近义词 last-seen stamps, merged **per term, the later stamp winning** — the
 * mergeTangles pattern on a plain string. Two devices reading different groups
 * stamp disjoint terms, and a pick of the whole map would rewind one device's
 * rotation. Both sides write toISOString, so a string compare orders them. A
 * value that is not a string is skipped, as isProgress does not gate this field.
 */
export function mergeSynonymSeen(a: Progress['synonymSeen'], b: Progress['synonymSeen']): Progress['synonymSeen'] {
  if (a === undefined && b === undefined) return undefined
  const out: Record<string, string> = {}
  for (const side of [a, b]) {
    if (!isRecord(side)) continue
    for (const [term, at] of Object.entries(side)) {
      if (typeof at !== 'string') continue
      const cur = out[term]
      if (cur === undefined || at > cur) out[term] = at
    }
  }
  return out
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
    // The forget log is the odd one out: it *is* written together with a
    // `lastReviewedAt` (on the entry the 重来 just graded), and still cannot
    // ride the pick. The stamp that wins is the other device's — a later
    // grade of the same word there carries no log, or an older one — and the
    // record of the lapse goes with the entry that lost.
    const forgot = mergeForgot(local.words[id]?.forgot, remote.words[id]?.forgot)
    // Spread conditionally rather than assigning undefined: absent on both
    // sides has to stay absent. An explicit `undefined` key survives every
    // in-memory comparison the tests make, even though JSON.stringify would
    // later drop it.
    words[id] = {
      ...entry,
      ...(recall === undefined ? {} : { recall }),
      ...(recallRating === undefined ? {} : { recallRating }),
      ...(forgot === undefined ? {} : { forgot }),
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
  const diverge = mergeDiverge(local.diverge, remote.diverge)
  const tangles = mergeTangles(local.tangles, remote.tangles)
  const synonymSeen = mergeSynonymSeen(local.synonymSeen, remote.synonymSeen)

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
    ...(diverge === undefined ? {} : { diverge }),
    ...(tangles === undefined ? {} : { tangles }),
    ...(synonymSeen === undefined ? {} : { synonymSeen }),
  }
}
