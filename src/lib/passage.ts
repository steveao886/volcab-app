/**
 * Question-generation logic for the passage word-choice cloze mode. All pure functions —
 * the rendering layer just draws whatever gets computed here.
 *
 * Design doc: docs/superpowers/specs/2026-07-28-passage-cloze-design.md
 */

import type { Progress, Word } from '../types'
import { buildContrastPairs } from './contrast'
import type { ContrastPair } from './contrast'
import { shuffle } from './quiz'

/**
 * Deliberately not placed in src/types.ts: that file is the "synced" data model — it pulls
 * and pushes against the volcab-data repo and goes through the whole merge/conflict-handling
 * setup. Passages are read-only content shipped bundled with the App, never participate in
 * sync, and don't belong under that schema's jurisdiction. Don't "relocate" this there later.
 */
export interface Passage {
  id: string
  title: string
  /** English, one sentence per entry. Target words are marked as {{wordId|surface form}}, shortened to {{concoct}} when the form matches the headword */
  en: string[]
  /** Chinese translation, one sentence per entry, aligned 1:1 with en */
  zh: string[]
  /**
   * Word ids that must never be used as distractors for this passage.
   *
   * Distractors come from the confusable-word map, and that map is built **from shared
   * synonyms** — so it naturally surfaces words that "would also fit if filled in." The
   * direct filter blocks dictionary-level synonymy (substantiate vs. corroborate), but
   * doesn't catch the kind that merely shares a synonym while still fitting the meaning
   * (antipathy vs. animosity, slacken vs. abate — measured: without calling them out
   * explicitly they show up in 84.9% and 18.8% of questions respectively, and the sentence
   * reads perfectly fine either way).
   *
   * This small handful can only be caught by a human: whether a word can be filled into a
   * given blank in this passage is something you have to read, not compute. Fortunately the
   * candidate pool is **essentially enumerable** — the vast majority of distractors come
   * from a marked word's non-direct neighbors on the confusable-word map, measured at 2 and
   * 10 words for the two current passages. The validation script prints this pool out for
   * the author to review.
   *
   * **Note the pool isn't airtight**: when the tier-1 candidates run dry it falls back to
   * "learned words with the same part of speech" and then "any learned word," both of which
   * draw from the entire word library. Measured: committee-report has at least one option
   * from the fallback tiers in 24.1% of its questions (its tier-1 pool only has 2 words left,
   * and any change in the answer combination isn't enough to cover it). Fallback picks are
   * semantically unrelated and don't create ambiguity, but when the author reviews the
   * validation script's printed list, they should know: that list is "must be read one by
   * one," not "these are the only words that can possibly appear."
   */
  exclude?: string[]
}

export interface PassagesFile { version: 1; passages: Passage[] }

export type Token =
  | { kind: 'text'; text: string }
  | { kind: 'word'; wordId: string; surface: string }

/**
 * `{{wordId}}` or `{{wordId|surface form}}`.
 *
 * Neither the id nor the form may contain `{}|`, so a malformed marker like `{{a|b|c}}`
 * **fails to match** and is left as-is in the text segment — the leftover-brace check below
 * then fails the whole sentence.
 *
 * **Exported for scripts/validate-passages.ts to use.** That script used to have its own
 * copy of the exact same literal, and the behavior of "failing to match means malformed"
 * depends entirely on this pattern's exact wording — keeping two copies means the gate and
 * the read side each interpret "what counts as a marker" separately, and fixing one while
 * missing the other lets an entire class of bad data through. Cross-referencing between
 * src/ and scripts/ is already established practice (that script already imports
 * isInflectionOf).
 */
export const MARKER = /\{\{([^{}|]+)(?:\|([^{}|]+))?\}\}/g

/**
 * Parses one sentence. Returns null for a malformed marker.
 *
 * **Better to skip the whole passage than to compromise**: a broken marker doesn't just
 * mean one fewer blank — it means blanking the wrong thing, or printing a half-string like
 * `{{refute` straight into the question. This follows the same rule as words.json's
 * "strict on write, lenient on read": the validation script is the gate, and this is the
 * fallback that keeps things from going blank-screen.
 */
export function parseSentence(s: string): Token[] | null {
  const out: Token[] = []
  let last = 0
  for (const m of s.matchAll(MARKER)) {
    const wordId = m[1].trim()
    const surface = (m[2] ?? m[1]).trim()
    if (wordId === '' || surface === '') return null
    // {{refute refuted}} is the classic typo of forgetting the pipe — without this check
    // it would be waved through as an id that happens to contain a space. validate-words.ts
    // has long required every Word.id to be lowercase with no whitespace, so any wordId
    // that fails that would be doomed to match no word anyway — better to flag it as a
    // malformed marker here than let it end up in a question referencing a nonexistent word.
    if (wordId !== wordId.toLowerCase() || /\s/.test(wordId)) return null
    if (m.index > last) out.push({ kind: 'text', text: s.slice(last, m.index) })
    out.push({ kind: 'word', wordId, surface })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ kind: 'text', text: s.slice(last) })
  if (out.some(t => t.kind === 'text' && /[{}]/.test(t.text))) return null
  return out
}

/** Parses the whole passage, sentence by sentence. Returns null for the whole passage if any sentence is malformed, or if the Chinese and English sentence counts don't match. */
export function parsePassage(p: Passage): Token[][] | null {
  if (p.en.length === 0 || p.en.length !== p.zh.length) return null
  const out: Token[][] = []
  for (const s of p.en) {
    const tokens = parseSentence(s)
    if (tokens === null) return null
    out.push(tokens)
  }
  return out
}

/** A passage needs at least 3 blanks. With only two blanks, the "clues cross-reference each other" reasoning breaks down and it degenerates into two separate single-sentence cloze questions. */
export const MIN_BLANKS = 3
/** At most 7 blanks per screen — any more and it's too much to finish. */
export const MAX_BLANKS = 7

export interface Blank {
  /** Sentence index */
  si: number
  /** Token index within that sentence */
  ti: number
  wordId: string
  /** The in-sentence surface form, filled in once answered correctly */
  surface: string
}

/**
 * Selects which blanks to create.
 *
 * **Only blanks out learned words** (`state !== 'new'`); words not yet learned, and words
 * not found in the library, are printed as-is. This follows the same lesson as the
 * discrimination mode (see generateContrastQuiz in quiz.ts): don't test you on a word you've
 * never seen. Unlike discrimination mode, though, unlearned words can stay in the
 * surrounding context — they're not being tested, just read.
 *
 * **When over `MAX_BLANKS`, shuffles within each group before truncating.** This used to be
 * a straight `[...due, ...notDue]` followed by slice — a hard cut at a fixed position that
 * always drops the same handful of words. Measured across 200 seeds each for two passages:
 * committee-report only ever produced 7 distinct answer words, and `ratify` was **never
 * blanked out even once**; sweltering-commute likewise never blanked out `abate` — words
 * marked in the source text and passing validation were nonetheless never testable. This is
 * the same class of defect as pickCloze in quiz.ts (the same word's cloze question is always
 * the same sentence — measured at 0 second sentences out of 63 words), namely: taking
 * elements in array order always returns the same subset.
 *
 * The shuffle only happens **within each group**: due words as a group still come before
 * not-yet-due words as a group, so review priority is unaffected. Truncation is followed by
 * restoring the original passage order anyway, so rendering order is also unaffected.
 */
export function selectBlanks(
  sentences: Token[][],
  words: Map<string, Word>,
  progress: Progress,
  today: string,
  rng: () => number,
): Blank[] {
  const seen = new Set<string>()
  const eligible: Blank[] = []

  sentences.forEach((tokens, si) => {
    tokens.forEach((t, ti) => {
      if (t.kind !== 'word') return
      // At most one blank per word per passage — otherwise the choice pool would show two
      // identical words, and the "used means crossed off" rule would immediately
      // contradict itself.
      if (seen.has(t.wordId)) return
      if (!words.has(t.wordId)) return
      const e = progress.words[t.wordId]
      if (e === undefined || e.state === 'new') return
      seen.add(t.wordId)
      eligible.push({ si, ti, wordId: t.wordId, surface: t.surface })
    })
  })

  const isDue = (b: Blank) => progress.words[b.wordId].due <= today
  const dueCount = eligible.filter(isDue).length

  // The cap sits one below the eligible count, not at MAX_BLANKS alone. The
  // spec bet on "which blanks are available changes as you learn" for
  // repeat variety — but once the library is fully learned that premise
  // dies: measured (2026-08-07 repetition audit), 32 of 34 passages mark
  // ≤MAX_BLANKS words, so every one of them blanked the identical set on
  // every repeat. Rotating one word out per assembly is the cheapest fix,
  // and it costs nothing that matters:
  //
  // - **Never below MIN_BLANKS** — the mutual-clue inference is the mode's
  //   whole point, and buildPassageQuestion rejects anything under it.
  // - **Never at a due word's expense** (the Math.max(dueCount, ...)): the
  //   passage is a review tool first. When everything is due, review wins
  //   and nothing rotates; when nothing is due — the replay-for-fun case
  //   the "眼熟" complaint actually came from — rotation is maximal.
  // - The rotated-out word is printed as-is and buildPassageQuestion's
  //   exclude set already bars every marked word from distractor duty, so
  //   it cannot leak back in as a give-away option.
  const cap = Math.max(MIN_BLANKS, Math.min(MAX_BLANKS, Math.max(dueCount, eligible.length - 1)))
  if (eligible.length <= cap) return eligible

  // Due words claim slots first, then the original passage order is restored — rendering
  // must follow appearance order; what gets cut is "which words," not "what order"
  const picked = new Set([
    ...shuffle(eligible.filter(isDue), rng),
    ...shuffle(eligible.filter(b => !isDue(b)), rng),
  ].slice(0, cap))
  return eligible.filter(b => picked.has(b))
}

/** How many more candidate words than blanks. Real word-choice cloze exams always give you extras, forcing you to eliminate wrong ones. */
export const DISTRACTOR_COUNT = 2

/**
 * Picks distractors. Three fallback tiers, and if it can't fill the quota it simply gives
 * fewer — one fewer distractor just makes the passage slightly easier, whereas offering an
 * option that duplicates the answer is a real defect (the same category of problem
 * sharedSynonyms in quiz.ts guards against).
 *
 * 1. Learned words that are confusable with some answer, from `buildContrastPairs` — the
 *    confusable-word map already built for this
 * 2. Learned words sharing a part of speech with some answer's primary meaning (words with
 *    different parts of speech never compete within a sentence)
 * 3. Any learned word
 *
 * @param excludeIds Word ids that must be excluded besides the answers themselves. **This
 *   isn't an optional nicety**: if a passage marks 8 words but `MAX_BLANKS` only blanks out
 *   7, that 8th word is **printed as-is in the passage** — using it as a distractor means the
 *   user crosses it off with a single glance at the text, wasting one of only two
 *   distractors and looking like a bug besides. Measured: committee-report's `ratify` is
 *   exactly this case — with N=471 learned words it was a distractor in 24.5% of questions,
 *   50.7% at N=200, and 100% at N=100. The same applies to marked-but-unlearned words (not
 *   eligible to be blanked out, yet still printed in the passage as-is).
 * @param byId An id index over `words`, passed in by the caller. `buildPassageQuestion`
 *   already builds one over the same word list, so building another here would be wasted
 *   work.
 */
export function pickDistractors(
  answerIds: Set<string>,
  excludeIds: Set<string>,
  words: Word[],
  byId: Map<string, Word>,
  progress: Progress,
  pairs: ContrastPair[],
  count: number,
  rng: () => number,
): Word[] {
  const learned = (id: string): boolean => {
    const e = progress.words[id]
    return e !== undefined && e.state !== 'new'
  }

  const out: Word[] = []
  const taken = new Set([...answerIds, ...excludeIds])

  const add = (id: string) => {
    if (out.length >= count || taken.has(id) || !learned(id)) return
    const w = byId.get(id)
    if (w === undefined) return
    taken.add(id)
    out.push(w)
  }

  for (const p of shuffle(pairs, rng)) {
    if (out.length >= count) break
    // **Any `direct` pair is always excluded.** `direct` means one side wrote the other's
    // headword directly into its own synonyms — that's a dictionary-level "these two mean
    // the same thing," exactly the kind of thing that must never be offered as a wrong
    // answer. Measured: committee-report's corroborate/substantiate is exactly such a
    // pair — "no independent team could substantiate" is both grammatical English and
    // entirely correct in meaning, and it was a distractor in 26.6% of questions, with
    // users concluding both options were valid answers.
    //
    // This is only a **partial fix, and using it alone would make things worse**: direct
    // only covers dictionary-hardcoded synonymy, and doesn't catch the kind that merely
    // shares a synonym while still fitting the meaning (animosity/antipathy share
    // hostility, abate/slacken share ease). Worse still, direct's neighbors include some
    // that are **safe** (acrimonious / disputatious / disreputable relative to contentious
    // and dubious) — excluding all of them at once leaves animosity with only grievance and
    // antipathy as neighbors. Measured across 2000 seeds: antipathy's appearance rate
    // **rose from 23.2% before the fix to 84.9%**. Ambiguous words can only be handled by
    // manually calling them out via `Passage.exclude`; once called out, both passages drop
    // to 0.0%.
    //
    // Don't bother trying to use the score as a cutoff either: disputatious at 4 points is
    // safe, antipathy at 2 points is ambiguous, and most things at 2 points are safe — no
    // threshold can separate them.
    if (p.direct) continue
    if (answerIds.has(p.a)) add(p.b)
    else if (answerIds.has(p.b)) add(p.a)
  }

  // **Check whether more are still needed before falling back.** Each of these two tiers
  // does a `shuffle` over the entire word library, and `shuffle` is Fisher-Yates: 471 words
  // means 470 rng calls. This originally ran unconditionally — measured, a single question
  // consumed 1268 rng calls total, with 940 of them (74%) coming from these two shuffles —
  // yet the tier-1 candidates fill the quota the vast majority of the time, so none of those
  // 940 draws ever got used. After adding the early exit, measured: 387.5 calls/question at
  // N=471 learned words, 586.5 at N=100, 798 at N=50 — the more learned words there are, the
  // easier it is for tier 1 to fill the quota, and the less these two fallback tiers get
  // used.
  if (out.length < count) {
    const poses = new Set<string>()
    for (const id of answerIds) {
      const pos = byId.get(id)?.meanings[0]?.pos
      if (pos !== undefined) poses.add(pos)
    }
    for (const w of shuffle(words, rng)) {
      if (out.length >= count) break
      if (poses.has(w.meanings[0]?.pos)) add(w.id)
    }
  }

  if (out.length < count) {
    for (const w of shuffle(words, rng)) {
      if (out.length >= count) break
      add(w.id)
    }
  }

  return out
}

/** A candidate choice. `wordId` is used for grading, `headword` for display — the two aren't necessarily the same. */
export interface Choice { wordId: string; headword: string }

export interface PassageQuestion {
  passage: Passage
  sentences: Token[][]
  /** In original passage order */
  blanks: Blank[]
  /** Already shuffled */
  choices: Choice[]
}

/**
 * Assembles a passage into a question. Returns null if it can't be built (parse failure /
 * not enough eligible blanks), and the caller moves on to the next passage.
 */
export function buildPassageQuestion(
  passage: Passage,
  words: Word[],
  progress: Progress,
  today: string,
  pairs: ContrastPair[],
  rng: () => number,
): PassageQuestion | null {
  const sentences = parsePassage(passage)
  if (sentences === null) return null

  const byId = new Map(words.map(w => [w.id, w]))
  const blanks = selectBlanks(sentences, byId, progress, today, rng)
  if (blanks.length < MIN_BLANKS) return null

  const answerIds = new Set(blanks.map(b => b.wordId))
  // Every marked word that appears in the passage text is barred from being a distractor —
  // not just the ones that got blanked out. Marked words that didn't get blanked out
  // (beyond MAX_BLANKS, or not yet learned) are **printed as-is in the passage text**.
  // Then union in the author's manually called-out exclude (see Passage.exclude): the small
  // handful of ambiguous words that can't be computed.
  const excluded = new Set<string>(passage.exclude)
  for (const tokens of sentences) {
    for (const t of tokens) if (t.kind === 'word') excluded.add(t.wordId)
  }
  const distractors = pickDistractors(answerIds, excluded, words, byId, progress, pairs, DISTRACTOR_COUNT, rng)

  const choices = shuffle<Choice>(
    [
      ...blanks.map(b => ({ wordId: b.wordId, headword: byId.get(b.wordId)!.headword })),
      ...distractors.map(w => ({ wordId: w.id, headword: w.headword })),
    ],
    rng,
  )

  return { passage, sentences, blanks, choices }
}

/** Due words are weighted higher than learned-but-not-due — this feature is a review tool first, reading material second. */
export const DUE_WEIGHT = 3
export const LEARNED_WEIGHT = 1
/** How many ids the "recently done" list keeps. Just a storage cap now — the window that actually matters is derived per corpus by recentWindow. Stored in localStorage, not in progress.json. */
export const RECENT_LIMIT = 60

/**
 * How many of the most recent passages to rule out, given the corpus size.
 *
 * Two thirds, and the fraction is what makes it work. A fixed window fails
 * whenever the corpus has more high-scoring passages than the window has
 * slots: with 26 passages, 11 of which score far above the rest, a window of
 * 10 always left exactly one high scorer free to win, so those eleven cycled
 * forever and eleven usable passages were never drawn once in 40 sessions.
 * Off by one, and permanently.
 *
 * Scaling with the corpus keeps the guarantee as it grows. Two thirds rather
 * than everything, because the remaining third is where the score still gets
 * to choose the most useful of the eligible passages — a full round-robin
 * would rotate mechanically and stop favouring due words at all.
 */
export function recentWindow(corpusSize: number): number {
  return Math.max(0, Math.min(corpusSize - 1, Math.floor((corpusSize * 2) / 3)))
}

/**
 * How much this passage is worth doing today, counting only what it would
 * actually make you recall.
 *
 * Recency is **not** part of the score. It used to be, as a flat penalty,
 * and it could not do the job — see pickPassage for why and for the
 * measurement. It is a filter there instead.
 */
export function scoreQuestion(
  q: PassageQuestion,
  progress: Progress,
  today: string,
): number {
  let s = 0
  for (const b of q.blanks) {
    s += progress.words[b.wordId].due <= today ? DUE_WEIGHT : LEARNED_WEIGHT
  }
  return s
}

/**
 * Picks the passage most worth doing today. Returns null if none can be built (the caller
 * supplies the empty-state copy).
 *
 * `buildContrastPairs` is computed only once for the whole word library — putting it inside
 * the loop would mean recomputing the inverted index once per passage.
 *
 * **Every passage is fully assembled and then scored — this is deliberate**: scoring needs
 * to count due words, and due words are a product of `selectBlanks`, so scoring before
 * assembling would mean duplicating the blank-selection logic. Measured on this machine: 3.7
 * ms for 30 passages, 18.0 ms for 200 passages (30 is roughly the current corpus size, 200
 * the planned size) — both well within the noise of a single click. If the corpus grows
 * past 200 passages, this should switch to "compute a lightweight score first, then only
 * fully assemble the top-scoring few" — but that's a change for when it's needed; doing it
 * now would trade readability for an invisible gain.
 */
export function pickPassage(
  passages: Passage[],
  words: Word[],
  progress: Progress,
  today: string,
  recentIds: string[],
  rng: () => number = Math.random,
): PassageQuestion | null {
  const pairs = buildContrastPairs(words)

  const bestOf = (candidates: Passage[]): PassageQuestion | null => {
    let best: PassageQuestion | null = null
    let bestScore = -Infinity
    // Shuffle first: on a tie, whichever is encountered first wins; without shuffling it
    // would always be one of the same few passages near the front of the array
    for (const p of shuffle(candidates, rng)) {
      const q = buildPassageQuestion(p, words, progress, today, pairs, rng)
      if (q === null) continue
      const s = scoreQuestion(q, progress, today)
      if (s > bestScore) {
        bestScore = s
        best = q
      }
    }
    return best
  }

  // Recently-done passages are **excluded, not penalised**. They used to cost
  // a flat RECENT_PENALTY, which could never bridge the gap the score itself
  // opens up: a passage with seven due blanks scores 21, one with three
  // learned blanks scores 3, and no constant of 5 closes that. Measured over
  // the live library, 22 of 26 passages were buildable and 40 consecutive
  // sessions drew only 11 of them — the same eleven, in the same order,
  // forever, while eleven perfectly usable passages never appeared once.
  //
  // Falling back to the full set matters for two cases: fewer passages exist
  // than the recent list remembers, and every fresh passage turns out not to
  // be buildable. Either way, repeating a passage beats the empty state.
  //
  // recentWindow caps at one short of the corpus, so something is always left
  // to choose from; without that, a small corpus would exclude everything and
  // the fallback would go back to picking purely on score.
  const window = recentIds.slice(0, recentWindow(passages.length))
  const fresh = passages.filter(p => !window.includes(p.id))
  return bestOf(fresh) ?? bestOf(passages)
}

/** Pushes an id to the front of "recently done," dropping the oldest once past the limit. */
export function pushRecent(recent: string[], id: string, limit = RECENT_LIMIT): string[] {
  return [id, ...recent.filter(x => x !== id)].slice(0, limit)
}
