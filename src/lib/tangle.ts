import type { Progress, TangleStat, Word } from '../types'
import type { ContrastPair } from './contrast'
import { contrastNoteKey } from './contrastNotes'
import { headwordPattern } from './headword'
import { clozeExample, shuffle } from './quiz'
import type { SenseGroup } from './senseGroup'
import { addDays, todayStr } from './srs'

/**
 * The most words one tangle holds. The tangle is the confused pair plus the
 * studied words that are partners of both, so it is small by construction: the
 * forget-moment spec measured median 4, p90 6, max 10 over the 1184 studied
 * pairs on live progress on 2026-10-20. Five is the spec's own call; it leaves
 * the typical tangle whole and trims only the tail.
 */
export const TANGLE_MEMBER_CAP = 5

/**
 * How many due tangles count as a day's work on 今日, oldest first. A default,
 * not a wall: a done row stays a link while more are due (`PlanItem.reopenable`).
 * It sits beside TANGLE_MEMBER_CAP so the two limits the spec sets are read in
 * one place.
 */
export const TANGLE_DAILY_CAP = 3

const byString = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0)

/**
 * The words a tangle opened by confusing `a` with `b` holds: the pair itself,
 * then the studied words that are confusable partners of **both**, closest
 * first, up to TANGLE_MEMBER_CAP.
 *
 * **Partners of both, never a connected component.** Walk outwards from the
 * pair and the tangle is the contrast graph's component: 346 words for the
 * largest one among studied words (spec, same measurement). Requiring a partner
 * of both is what keeps `corroborate` + `vindicate` at `substantiate`.
 *
 * "Closest" is the sum of the two pair scores, so a word near both outranks
 * one very near a single side. Ties go by id, which makes the result a
 * function of the data alone. Unstudied partners are skipped, since the user
 * cannot have confused a word they have not met. The pair keeps the order it
 * is given in, which is the order the callers want to show it.
 */
export function tangleMembers(a: string, b: string, studied: Set<string>, pairs: ContrastPair[]): string[] {
  const partnersOf = (id: string): Map<string, number> => {
    const out = new Map<string, number>()
    for (const p of pairs) {
      if (p.a === id) out.set(p.b, p.score)
      else if (p.b === id) out.set(p.a, p.score)
    }
    return out
  }
  const withB = partnersOf(b)
  const common: { id: string; score: number }[] = []
  for (const [id, score] of partnersOf(a)) {
    const other = withB.get(id)
    if (other !== undefined && id !== a && id !== b && studied.has(id)) common.push({ id, score: score + other })
  }
  common.sort((x, y) => y.score - x.score || byString(x.id, y.id))
  return [a, b, ...common.slice(0, TANGLE_MEMBER_CAP - 2).map((c) => c.id)]
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

/**
 * Whether `raw` is a tangle stat the runtime can read. The same fields
 * mergeTangles' readTangle requires, so a stat that survives a merge is
 * readable here and the other way round.
 *
 * **Every reader below goes through this**, and so does the store's
 * recordTangle, the one writer that reads a stat it was handed a key for.
 * Login and a cached boot hand the store its progress without going through
 * mergeProgress, so a hand-edited `"members": "a,b"` can arrive here, and
 * these run on every render of 今日 and every grade. A key does not mean the
 * stat behind it is readable: buildTangleSession reads a bad `members` as
 * empty and builds a harmless session, so a page can reach the write with a key
 * dueTangles never vetted. Returns the stat itself, not a rebuilt copy, so a
 * field a newer build added rides through a spread untouched.
 */
export function isReadable(raw: unknown): raw is TangleStat {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false
  const s = raw as Record<string, unknown>
  return typeof s.lastAt === 'string' && typeof s.bornOn === 'string' && typeof s.dueOn === 'string'
    && isStringArray(s.pairs) && isStringArray(s.members) && isStringArray(s.settled)
}

/** A `doneOn` that is present but not a string reads as not done, as readTangle does: it only shows the tangle once more. */
const isDone = (stat: TangleStat): boolean => typeof stat.doneOn === 'string'

/**
 * Whether a tangle has nothing left to ask: it is done (`doneOn` is set), or
 * every member still in the library is settled. **The one definition**, read
 * by dueTangles to leave it off 今日 and by applyTangleResults to decide when
 * to write `doneOn`, so the two cannot drift. The 60-day evaluation's "whose
 * tangle has since been done" should call it too, not read `doneOn` alone.
 *
 * **A tangle can be finished without a `doneOn`.** Only a session writes
 * `doneOn`, and a member deleted after the others settled leaves the tangle
 * with no unsettled word to ask about: `[a, b, c]` with `a` and `b` settled,
 * `c` missed, then `c` deleted. Nothing then calls applyTangleResults, and
 * were it listed as due it would sit on 今日 as owed work whose session asks
 * nothing, the phantom backlog the spec's anti-goals rule out. A deleted
 * member cannot be answered, so it is not waited on.
 *
 * A `doneOn` that is present counts whatever the settled list says: a word
 * deleted and added again under the same id is a live member that was never
 * settled, and the finished tangle stays finished.
 */
export function isFinished(stat: TangleStat, live: Set<string>): boolean {
  if (isDone(stat)) return true
  const settled = new Set(stat.settled)
  return stat.members.every((id) => !live.has(id) || settled.has(id))
}

const isTangleMap = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * `tangles` after the user confused `a` with `b`: a new tangle, a refreshed
 * open one, or a reopened done one. A new record, and the input is untouched.
 *
 * - **Refreshed**: some open tangle holds both words. The pair's key joins
 *   its `pairs` (once, however often it is confused), the two words become
 *   unsettled, and `dueOn` is **not** pushed back: a word confused again
 *   today is still owed the session it was already due for. `bornOn` stays,
 *   so "born today" keeps meaning the tangle's first day; the day-1 section
 *   reads today's confused records (todaysConfusedPairs) instead. Members are
 *   not recomputed, which is the point of stamping them.
 * - **Reopened**: only a done tangle holds both. It starts again from day 1:
 *   born today, due tomorrow, nothing settled, `doneOn` gone, members
 *   recomputed, and the key appended to `pairs` when it is new there.
 * - **New**: neither. Keyed by the sorted pair.
 *
 * Open before done, then the latest `lastAt`, then the key: tangles overlap
 * (`a|b` and `a|d` open two that can both hold `c`), so a pair can sit inside
 * several, and an open tangle is work still owed where a done one is history.
 * `members` is a callback so the graph is ranked only when a tangle is born or
 * reopened.
 *
 * **A readable stat already at the pair's key is a host whatever its members
 * say.** A reopen recomputes members from the pair that reopened it, and
 * that pair has three slots beside itself: reopen done `a|c` (`[a, c, b, …]`)
 * by confusing `a|b`, and `c` can fall out once `(a, b)` has three closer
 * common partners. Confusing `a|c` next finds no tangle holding both, and
 * writing a new one at the key would replace the reopened tangle and wipe its
 * `pairs`, `settled` and `dueOn`. The key is taken; refreshing or reopening
 * what sits there is the only thing that does not lose a record.
 *
 * A stat that is not readable is never a candidate and is carried through
 * unchanged, so one bad record cannot stop a lapse from being recorded. One
 * at the pair's own key is the exception that cannot be carried: it is
 * replaced, which is how a hand-edited stat is repaired.
 */
export function applyConfusion(
  tangles: Progress['tangles'], a: string, b: string, members: () => string[], now: Date,
): Record<string, TangleStat> {
  const base: Record<string, unknown> = isTangleMap(tangles) ? tangles : {}
  const key = contrastNoteKey(a, b)
  const today = todayStr(now)
  const lastAt = now.toISOString()

  const holding: { key: string; stat: TangleStat }[] = []
  for (const [k, raw] of Object.entries(base)) {
    if (!isReadable(raw)) continue
    if (k === key || (raw.members.includes(a) && raw.members.includes(b))) holding.push({ key: k, stat: raw })
  }
  const latest = (xs: typeof holding) =>
    [...xs].sort((x, y) => byString(y.stat.lastAt, x.stat.lastAt) || byString(x.key, y.key))[0]
  const host = latest(holding.filter((h) => !isDone(h.stat))) ?? latest(holding.filter((h) => isDone(h.stat)))

  if (host === undefined) {
    const born: TangleStat = {
      pairs: [key], members: members(), settled: [], bornOn: today, dueOn: addDays(today, 1), lastAt,
    }
    return { ...base, [key]: born } as Record<string, TangleStat>
  }

  const pairs = host.stat.pairs.includes(key) ? host.stat.pairs : [...host.stat.pairs, key]
  if (!isDone(host.stat)) {
    const refreshed: TangleStat = {
      ...host.stat, pairs, settled: host.stat.settled.filter((id) => id !== a && id !== b), lastAt,
    }
    return { ...base, [host.key]: refreshed } as Record<string, TangleStat>
  }

  const reopened: TangleStat = {
    ...host.stat, pairs, members: members(), settled: [], bornOn: today, dueOn: addDays(today, 1), lastAt,
  }
  // Absent, not `undefined`: JSON drops an explicit undefined, so the same
  // state would read differently before and after a sync (Object.hasOwn, and
  // any structural-equality check, tell them apart).
  delete reopened.doneOn
  return { ...base, [host.key]: reopened } as Record<string, TangleStat>
}

/**
 * The keys of the tangles due on `today`: not finished (see isFinished),
 * `dueOn` today or earlier, and at least two members still in the library.
 * Oldest `dueOn` first, then `bornOn`, then key, so the order is a function of
 * the data alone. The caller applies TANGLE_DAILY_CAP.
 *
 * **Fewer than two live members is never due.** The user deletes words in the
 * app, and from another device; a tangle of one word has nothing to be
 * confused with, and a session over it would be a side by side of a single
 * headword. Counting `live` here rather than trusting `members` is also what
 * lets a stamped member list stay as it was born. A malformed stat is skipped.
 */
export function dueTangles(tangles: Progress['tangles'], today: string, live: Set<string>): string[] {
  if (!isTangleMap(tangles)) return []
  const due: { key: string; stat: TangleStat }[] = []
  for (const [key, raw] of Object.entries(tangles)) {
    if (!isReadable(raw) || raw.dueOn > today || isFinished(raw, live)) continue
    if (raw.members.filter((id) => live.has(id)).length < 2) continue
    due.push({ key, stat: raw })
  }
  due.sort((x, y) => byString(x.stat.dueOn, y.stat.dueOn) || byString(x.stat.bornOn, y.stat.bornOn) || byString(x.key, y.key))
  return due.map((d) => d.key)
}

/**
 * Which tangle /untangle runs, given its `?key=` and dueTangles' list: the
 * named one when it is due, otherwise the oldest due; null when none is.
 *
 * **Only a due tangle is run, whatever the URL says.** A key can name a
 * tangle that is gone, finished, down to one live member, or not due until
 * tomorrow, and each of those is a session with nothing owed: the first three
 * would ask nothing, and the last would hand day 2 over on day 1, which
 * 复习完成 already covers. Falling back rather than refusing keeps a stale
 * link useful.
 */
export function pickTangle(requested: string | null, due: string[]): string | null {
  if (requested !== null && due.includes(requested)) return requested
  return due[0] ?? null
}

/**
 * The pairs confused today: one entry per pair, from the forget records of
 * `kind: 'confused'` made on `today` that name a partner, with both words
 * still in the library. This is what 复习完成's 今天混过的词 section is built
 * from, rather than from tangles born today, because a refreshed or reopened
 * tangle was not born today and is owed the same day-1 look.
 *
 * `'self'` (the word's own other sense) and an answer naming no partner never
 * reach here: neither names a word to untangle it from. Earliest record first,
 * so the section reads in the order the user lapsed and does not depend on
 * where a word sits in the progress object; of a pair confused from both
 * sides, the earlier record gives `lapsed`.
 *
 * Lenient like latestForgetToday, and for the same reason: a non-array `forgot`,
 * a record with no string `at` or `with`, or a null entry is skipped. Only the
 * fields this reads are checked, the way forget.ts's isReadableRecord checks
 * the two it keys on.
 */
export function todaysConfusedPairs(
  progress: Progress, today: string, live: Set<string>,
): { lapsed: string; partner: string }[] {
  const found: { at: string; lapsed: string; partner: string }[] = []
  for (const [lapsed, entry] of Object.entries(progress.words)) {
    const log: unknown = (entry as { forgot?: unknown } | null | undefined)?.forgot
    if (!Array.isArray(log) || !live.has(lapsed)) continue
    for (const rec of log as unknown[]) {
      if (typeof rec !== 'object' || rec === null) continue
      const { at, kind, with: partner } = rec as { at?: unknown; kind?: unknown; with?: unknown }
      if (typeof at !== 'string' || kind !== 'confused' || typeof partner !== 'string') continue
      if (partner === 'self' || partner === lapsed || !live.has(partner)) continue
      if (todayStr(new Date(at)) === today) found.push({ at, lapsed, partner })
    }
  }
  found.sort((x, y) => byString(x.at, y.at) || byString(x.lapsed, y.lapsed) || byString(x.partner, y.partner))

  const seen = new Set<string>()
  const out: { lapsed: string; partner: string }[] = []
  for (const { lapsed, partner } of found) {
    const key = contrastNoteKey(lapsed, partner)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ lapsed, partner })
  }
  return out
}

/**
 * `stat` after a session: the members answered right, and the ones settled by
 * being shown (`autoSettled`, a member with no usable sentence), join
 * `settled`. A new stat, and the input is untouched.
 *
 * **Done is isFinished on the settled list this session leaves**, the same
 * test dueTangles lists by. When it holds, `doneOn` is today (a tangle that
 * already has one keeps it); otherwise it stays open and is due tomorrow, so a
 * miss costs a day and never a session of its own. `lastAt` moves to `now`
 * either way, which is what the merge picks a side by.
 *
 * Only members can be settled: an id the stat never held is dropped, so
 * `settled` stays a subset of `members`. This writes nothing a schedule reads,
 * and nothing in it reaches srs.ts.
 */
export function applyTangleResults(
  stat: TangleStat, correctIds: string[], autoSettled: string[], live: Set<string>, now: Date,
): TangleStat {
  const settled = [...new Set([...stat.settled, ...correctIds, ...autoSettled])].filter((id) => stat.members.includes(id))
  const next: TangleStat = { ...stat, settled, lastAt: now.toISOString() }
  if (!isFinished(next, live)) next.dueOn = addDays(todayStr(now), 1)
  else if (!isDone(next)) next.doneOn = todayStr(now)
  return next
}

export interface TangleQuestion {
  /** The member whose example is blanked. */
  answerId: string
  /** An example of the answer with its headword blanked, free of every other member's headword. */
  prompt: string
  /** Every live member's headword, shuffled, so the answer has no fixed place. */
  options: string[]
}

export interface TangleNote {
  /** contrastNoteKey of the two members the note is about. */
  key: string
  text: string
  /** The user confused this very pair: it is the reason the tangle exists, so it leads and is marked. */
  confused: boolean
}

export interface TangleSession {
  /** The members still in the library, in the order the tangle stamped them. */
  members: Word[]
  notes: TangleNote[]
  questions: TangleQuestion[]
  /** Unsettled members that got no question: settled by being shown (applyTangleResults' `autoSettled`). */
  autoSettled: string[]
}

/**
 * An example of `answer`, blanked, in which no member of `others` is left to
 * read: the sentence filter 辨析 applies to its one other word
 * (pairContrastQuestion), widened to every word on offer. Examples are tried in
 * shuffled order for the same reason pickCloze does it: taking the first would
 * make a word's question the same sentence every session.
 *
 * Tests the **blanked** prompt, as pairContrastQuestion does: blanking removes
 * the answer's own occurrences first, so a stem the answer shares with another
 * member cannot disqualify a sentence that is otherwise clean. headwordPattern
 * also catches inflected forms, which is the point: `vindicated` is as much
 * the second option as `vindicate`.
 */
function tangleCloze(answer: Word, others: Word[], rng: () => number): string | null {
  for (const example of shuffle(answer.examples, rng)) {
    const prompt = clozeExample(example, answer.headword)
    if (prompt === null) continue
    if (others.some((o) => headwordPattern(prompt, o.headword) !== null)) continue
    return prompt
  }
  return null
}

/**
 * What one tangle session shows and asks (spec §3, "Day 2, complete"): the
 * members side by side, the notes between them, and one cloze for each member
 * not yet settled. Pure; the page renders it and applyTangleResults records it.
 *
 * - **Members** are the stamped ones still in `byId`, in stamped order. A
 *   deleted member is skipped everywhere, never an error: the user deletes
 *   words in the app and from another device, and `members` is stamped once.
 * - **Notes** are the authored contrast notes between two live members, found
 *   by contrastNoteKey; a pair with none shows none. The pairs the user
 *   confused come first and carry `confused`. A key in `stat.pairs` counts
 *   only if both its words are live members: `pairs` can outlive a member, and
 *   a note is only ever built between members that are on the page.
 * - **Questions**: each unsettled member gets one cloze whose options are
 *   *every* live member's headword, the settled ones too. They are still on
 *   offer, so a sentence carrying any of them is no question at all (the
 *   anti-goal "a question offers two right answers"), which is why the filter
 *   looks at all of them and not just the unsettled.
 * - **A member with no usable sentence is settled by being shown**, listed in
 *   `autoSettled` rather than dropped: every example carrying another member,
 *   or none locating the headword. Left unsettled it would keep the tangle
 *   due every day with nothing to ask, the backlog the spec's anti-goals rule
 *   out, and the member is still on the side-by-side page, which is the whole
 *   of what can be done for it. Rare but real: a session built for each of the
 *   1333 pairs scoring CONTRAST_MIN_SCORE or more, on the repo's
 *   data/words.json with every word counted as studied (2026-10-21), left 6
 *   of the 5193 members across them with no usable sentence.
 * - **Fewer than two live members asks and settles nothing.** One headword is
 *   not a choice, and a tangle in that state is never due (dueTangles), so a
 *   session reaches here only if a word was deleted after the tangle was
 *   listed. Settling the lone member then would credit a showing that taught
 *   nothing.
 *
 * The read side is lenient: a `members`, `settled` or `pairs` that is not an
 * array of strings reads as empty, so a hand-edited record cannot break the
 * session. Both the order examples are tried in and the order of each
 * question's options draw on the injected `rng`.
 */
export function buildTangleSession(
  stat: TangleStat, byId: Map<string, Word>, notes: Record<string, string>, rng: () => number = Math.random,
): TangleSession {
  const ids = isStringArray(stat.members) ? stat.members : []
  const settled = new Set(isStringArray(stat.settled) ? stat.settled : [])
  const confusedKeys = new Set(isStringArray(stat.pairs) ? stat.pairs : [])

  const members: Word[] = []
  for (const id of ids) {
    const w = byId.get(id)
    if (w !== undefined) members.push(w)
  }
  if (members.length < 2) return { members, notes: [], questions: [], autoSettled: [] }

  const found: TangleNote[] = []
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const key = contrastNoteKey(members[i].id, members[j].id)
      const text = notes[key]
      if (typeof text !== 'string' || text.trim() === '') continue
      found.push({ key, text, confused: confusedKeys.has(key) })
    }
  }
  const ordered = [...found.filter((n) => n.confused), ...found.filter((n) => !n.confused)]

  const headwords = members.map((w) => w.headword)
  const questions: TangleQuestion[] = []
  const autoSettled: string[] = []
  for (const w of members) {
    if (settled.has(w.id)) continue
    const prompt = tangleCloze(w, members.filter((o) => o.id !== w.id), rng)
    if (prompt === null) autoSettled.push(w.id)
    else questions.push({ answerId: w.id, prompt, options: shuffle(headwords, rng) })
  }
  return { members, notes: ordered, questions, autoSettled }
}

/**
 * The sense groups a tangle session also asks (spec §3, "Day 2, complete"):
 * every group whose `order` lies inside `members`, in the order `groups`
 * gives them. The page asks each as 排序 when it can and 唤词 otherwise.
 *
 * **Every ranked word a member, and at least two of them.** A group reaching
 * one word outside the tangle (`[substantiate, corroborate, ratify]` against
 * corroborate + vindicate + substantiate) is a question about a word the user
 * did not confuse. A group of one is the same thing from the other side: the
 * real `[corroborate]` group offers it against `back up`, `bear out` and
 * `cross-verify`, so all the question tests is corroborate against words
 * outside the tangle, which the cloze already asked better.
 *
 * Measured on the same tangles buildTangleSession's note counts (the 1333
 * pairs scoring CONTRAST_MIN_SCORE or more, data/words.json, every word
 * studied, 2026-10-21): 623 hold no group, 513 one, 144 two, and 53 three to
 * five. A group of one would have joined a tangle 236 times.
 *
 * Extra practice only: nothing here settles a member or reaches
 * applyTangleResults.
 */
export function tangleGroups(members: string[], groups: SenseGroup[]): SenseGroup[] {
  const inside = new Set(members)
  return groups.filter((g) => g.order.length >= 2 && g.order.every((id) => inside.has(id)))
}
