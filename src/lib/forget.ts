import type { ForgetRecord, Grade, ProgressEntry, Word } from '../types'
import type { ContrastPair } from './contrast'
import { headwordPattern } from './headword'
import { todayStr } from './srs'

/**
 * How many forget records a word keeps (`ProgressEntry.forgot`), newest last.
 *
 * It lives here and not in merge.ts because the writer that appends a record
 * and the merge that unions two devices' logs must cap at the same number, or
 * one of them would quietly keep what the other had just cut.
 */
export const FORGET_LOG_LIMIT = 10

/** The most meanings 想成了别的 offers. One screen at 375px, and past the closest few the partners are noise. */
export const FORGET_OPTION_LIMIT = 6

/** What the forget question writes; `at` is stamped when it is written. */
export type ForgetInput = Omit<ForgetRecord, 'at'>

/** One answer to 想成了别的: a meaning the word might have been taken for, and the partner it came from. */
export interface ForgetOption { partnerId: string; text: string }

/**
 * A step in a blank word's second showing: one of its own sentences, then the
 * part of its etymology that is not the answer. See hintRungs.
 */
export type HintRung = { kind: 'example'; sentence: string } | { kind: 'etymology'; text: string }

/**
 * Whether grading `prev` with `g` is a lapse, the one event that asks how the
 * word was forgotten: a 重来 on a card that was in the review phase.
 *
 * **`prev` is the entry before the grade, never after.** gradeWord sends every
 * lapse to a learning step, so read afterwards `state` is `'learning'` for the
 * very 重来 being asked about — and the relearning showings that follow it
 * would read as lapses of their own and put the question up a second time for
 * one forgetting. A card that was never graded has nothing to forget.
 */
export function isLapse(prev: ProgressEntry | undefined, g: Grade): boolean {
  return prev?.state === 'review' && g === 'again'
}

/**
 * The separate glosses inside one `meanings[].zh`, as comparable terms.
 *
 * Split on ; ； , ， 、 after the parenthesized qualifiers are cut out, because
 * a qualifier carries its own 、 (`缓解(痛苦、问题)` is one gloss, not three).
 * Both `()` and `（）` occur in the library: of 1905 meanings, 60 use the
 * full-width pair, and 36 have a 、 outside the half-width one, 30 of them
 * inside a （）. Cut only `()` and those 30 would split a qualifier into
 * glosses. Measured on 2026-10-20. A trailing 的/地 goes too, so 炫耀的 and
 * 炫耀 are the same gloss — it is the adjective or adverb marker, and which one
 * the author reached for is not a difference in meaning. An inner … stays:
 * `证明…正确` is one term.
 */
export function glossTerms(zh: string): string[] {
  return zh
    .replace(/\([^)]*\)|（[^）]*）/g, '')
    .split(/[;；,，、]/)
    .map((t) => t.trim().replace(/[的地]$/, '').trim())
    .filter((t) => t !== '')
}

/**
 * What a lapsed `word` might have been taken for: each studied confusable
 * partner's first meaning, minus whatever the word's own glosses already say.
 *
 * **The own-gloss filter is what makes the list worth asking.** Unfiltered,
 * 230 of 833 options (28%) shared a gloss with the answer — measured on the
 * live progress on 2026-10-20 and recorded in the forget-moment spec — and
 * the six closest pairs share one outright. Offering `vindicate`'s 证明…正确;
 * 证实 for `corroborate` (证实;确证) asks the user to pick the answer's own
 * meaning as the thing they confused it with. A partner term is dropped when it
 * sits inside the word's joined `zh` text, so 证实 goes against 使…得以证实
 * though it is not a whole gloss there. That one test also covers a term that
 * equals one of the word's own gloss terms: those are cut out of the same text,
 * so an equality check beside it could never change a result. The text is every
 * meaning of the word, since the card might have been missed on any of them;
 * the partner contributes its first only, the sense the confusable pair is
 * about.
 *
 * Partners walk closest-first (pair `score` descending, then id, so the order
 * is a function of the data alone). Unstudied partners are skipped — the user
 * cannot have confused a word they have not met — and so is one whose word is
 * gone from `byId`, which the user can delete in-app. A partner with nothing
 * left offers nothing, and an option whose text repeats an earlier one is
 * skipped, so the closer partner keeps it.
 */
export function forgetOptions(
  word: Word,
  byId: Map<string, Word>,
  studied: Set<string>,
  pairs: ContrastPair[],
): ForgetOption[] {
  const ownText = word.meanings.map((m) => m.zh).join(';')

  const partners: { id: string; score: number }[] = []
  for (const p of pairs) {
    if (p.a !== word.id && p.b !== word.id) continue
    const id = p.a === word.id ? p.b : p.a
    if (id !== word.id && studied.has(id)) partners.push({ id, score: p.score })
  }
  partners.sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))

  const out: ForgetOption[] = []
  const seen = new Set<string>()
  for (const { id } of partners) {
    const zh = byId.get(id)?.meanings[0]?.zh
    if (typeof zh !== 'string') continue
    const left = glossTerms(zh).filter((t) => !ownText.includes(t))
    if (left.length === 0) continue
    const text = left.join(';')
    if (seen.has(text)) continue
    seen.add(text)
    out.push({ partnerId: id, text })
    if (out.length === FORGET_OPTION_LIMIT) break
  }
  return out
}

/**
 * `entry` with `rec` on the end of its forget log, the last FORGET_LOG_LIMIT
 * kept.
 *
 * Spreads and adds `forgot`, nothing else: the lapse has already been graded,
 * and `ease`, `intervalDays`, `due`, `lapses`, `state` and `lastReviewedAt`
 * are the scheduler's alone. A `forgot` that is not an array (a hand edit
 * reaches the store unmerged) starts a fresh log rather than throwing.
 */
export function appendForget(entry: ProgressEntry, rec: ForgetRecord): ProgressEntry {
  const log = Array.isArray(entry.forgot) ? entry.forgot : []
  return { ...entry, forgot: [...log, rec].slice(-FORGET_LOG_LIMIT) }
}

/**
 * Only `at` and `kind`, the two fields the readers below key on: what mergeForgot
 * checks, so a record that survives a merge survives here. Not imported from
 * merge.ts, which imports FORGET_LOG_LIMIT from this file.
 */
const isReadableRecord = (v: unknown): v is ForgetRecord =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
  && typeof (v as ForgetRecord).at === 'string'
  && ((v as ForgetRecord).kind === 'blank' || (v as ForgetRecord).kind === 'confused')

/**
 * The newest forget record whose lapse happened on `today` (local, as
 * `todayStr` reads it), or undefined.
 *
 * **Lenient on purpose.** Login and a cached boot hand the store its progress
 * without going through `mergeProgress`, so a hand-edited `forgot: 7`, a
 * record with no `at` or a `kind` this build has never heard of can all arrive
 * here. Each is skipped, because this runs on every card render and a throw is
 * a white screen. The log is oldest-first, so the scan runs from the end.
 */
export function latestForgetToday(entry: ProgressEntry | undefined, today: string): ForgetRecord | undefined {
  const log: unknown = entry?.forgot
  if (!Array.isArray(log)) return undefined
  for (let i = log.length - 1; i >= 0; i--) {
    const rec: unknown = log[i]
    if (isReadableRecord(rec) && todayStr(new Date(rec.at)) === today) return rec
  }
  return undefined
}

/**
 * Whether the card should open on the hint ladder instead of the plain front:
 * its latest forgetting today was 一片空白, or 想成了别的 where no partner was
 * named (the wrong meaning matched nothing offered). Either way the user did
 * not have the word's neighbour in mind, so a nudge toward the word itself is
 * what is missing. A partner, or the word's own other sense, says what it was
 * taken for and needs no ladder.
 */
export function needsHintLadder(entry: ProgressEntry | undefined, today: string): boolean {
  const rec = latestForgetToday(entry, today)
  if (rec === undefined) return false
  return rec.kind === 'blank' || typeof rec.with !== 'string'
}

/**
 * The rungs of a blank word's ladder, in order: the first example sentence the
 * headword can be located in, then the etymology up to its first `→`.
 *
 * **The etymology is cut at the arrow, and nothing after it is ever shown.**
 * Every one of the 1042 etymologies in the library ends in `→ <the Chinese
 * meaning>` (`cor-(加强) + robur(力量) → 加固 → 证实`), measured on 2026-10-20.
 * Shown whole, the second rung would hand over the answer the ladder exists to
 * make the user reach for — the reason the spec turned down 要点. What is left
 * before the arrow is the parts and their glosses, which is the memory anchor.
 * No arrow, or nothing before it, and there is no rung: failing closed beats
 * guessing where the answer starts.
 *
 * A sentence the headword cannot be located in is skipped, the same rule the
 * cloze and the highlighting follow, so the rung never shows an unmarked
 * sentence. A missing rung is simply absent; the ladder just has fewer steps.
 */
export function hintRungs(word: Word): HintRung[] {
  const rungs: HintRung[] = []

  const sentence = word.examples.find((s) => headwordPattern(s, word.headword) !== null)
  if (sentence !== undefined) rungs.push({ kind: 'example', sentence })

  const etymology = word.etymology
  if (typeof etymology === 'string') {
    const arrow = etymology.indexOf('→')
    const text = arrow < 0 ? '' : etymology.slice(0, arrow).trim()
    if (text !== '') rungs.push({ kind: 'etymology', text })
  }

  return rungs
}
