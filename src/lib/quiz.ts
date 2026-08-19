import { antonymAnswerIndex } from './antonym'
import { buildContrastPairs, confusableIndex } from './contrast'
import { headwordPattern } from './headword'
import { isShapeGiveaway } from './shapeGiveaway'
// MISS_RECENCY_DAYS is imported rather than restated: it is one fact — how
// long a practice miss stays relevant — and two copies would silently drift
// the day the drill's window changes.
import { MISS_RECENCY_DAYS } from './queue'
import { addDays, INITIAL_EASE } from './srs'
import type { Meaning, Progress, Word } from '../types'

export type QuizType =
  | 'word2meaning' | 'meaning2word' | 'spelling'
  | 'clozeExample' | 'clozeCollocation' | 'synonymHint' | 'antonymPick'
  | 'contrast' | 'audio2meaning' | 'audio2spelling'

/**
 * Every practice surface that has ever recorded into `DailyStat.quizModes`.
 *
 * A stable wire key per surface, deliberately **not** the Chinese label
 * (which can be reworded) and not the `?mode=` param (which `mixed` reaches
 * by being absent). Renaming one of these orphans that surface's history,
 * so treat them as append-only.
 *
 * **`guess` is retired, not deleted.** The 猜词 mode was removed from the app
 * on 2026-08-17 because it went unused next to 回想, but the days it was
 * played are real and still sit in `quizModes` on the server. Dropping the
 * key would strand those rows behind a label nothing can render — which is
 * exactly the orphaning the append-only rule above exists to prevent. A
 * retired key generates no new rows and the stats page already renders its
 * section conditionally, so it costs one line here and nothing on screen.
 */
export const QUIZ_METRIC_KEYS = [
  'mixed', 'recall', 'contrast', 'audio', 'sprint', 'passage', 'guess', 'antonym',
] as const
export type QuizMetricKey = (typeof QUIZ_METRIC_KEYS)[number]

/** The label each surface shows on the stats page. Kept beside the keys so a new mode can't be added to one and forgotten in the other. */
export const QUIZ_METRIC_LABELS: Record<QuizMetricKey, string> = {
  mixed: '综合', recall: '回想', contrast: '辨析', audio: '听音',
  sprint: '极速', passage: '短文', guess: '猜词', antonym: '反义',
}

/**
 * The rotating question types for "mixed" mode.
 *
 * **The newer contrast / audio2* are deliberately excluded here** — they each have their
 * own generator function and their own mode entry point. Mixing them into the mixed mode
 * would change the path users walk through every single day (and audio questions are a dead
 * end in a muted environment). This constant now serves double duty as generateQuiz's
 * default type set and its domain of valid values.
 */
export const QUIZ_TYPES: readonly QuizType[] = [
  'word2meaning', 'meaning2word', 'spelling',
  'clozeExample', 'clozeCollocation', 'synonymHint', 'antonymPick',
]

/** The two question types that rotate in listening mode: audio→meaning, audio→spelling. */
export const AUDIO_TYPES: readonly QuizType[] = ['audio2meaning', 'audio2spelling']

export interface QuizQuestion {
  type: QuizType
  wordId: string
  /**
   * The prompt text.
   *
   * **Exception for audio questions (audio2meaning / audio2spelling): this holds the
   * headword to be read aloud, and the rendering layer must never display it** — showing
   * it would print the answer directly in the prompt. When the rendering layer sees either
   * of these two types it must draw a play button instead of text.
   */
  prompt: string
  options: string[]   // [] for spelling / audio2spelling questions
  answer: string
  /** Carried by spelling and audio2spelling questions: the meaning and the phonetic
   *  transcription are two separate fields, no longer concatenated into the prompt string —
   *  the caller (rendering layer) shouldn't have to regex the phonetic transcription back
   *  out of prompt; that would mean maintaining an unwritten contract around a formatting
   *  detail nobody signed off on.
   *  audio2spelling **does not show the phonetic transcription while answering** (you just
   *  heard the pronunciation, so showing the IPA too leaves nothing left to test), only
   *  once the answer is revealed. */
  phonetic?: string
  /** Carried only by synonymHint questions: whether the hint word is a synonym or antonym,
   *  which the UI must indicate — otherwise the user has no way to know whether to pick the
   *  word with the same meaning or the opposite one. */
  hintKind?: 'synonym' | 'antonym'
  /** Carried only by contrast questions: the id of the contrasted word. The rendering layer
   *  uses this to show both words' meanings/examples/collocations side by side once the
   *  answer is revealed — that comparison card is the actual point of discrimination mode. */
  contrastId?: string
  /** Carried only by antonymPick questions: the id of the **answer** word, i.e. the opposite.
   *  `wordId` is the prompt word, so the reveal needs this to name the other half of the pair.
   *  Kept separate from contrastId rather than merged into one `partnerId`: that would rename a
   *  field discrimination mode already depends on, in exchange for one identifier.
   *  **Absent when the answer is a word the library has no entry for**, which since
   *  2026-08-19 is the common case — the reveal then shows the prompt's side alone. */
  antonymId?: string
  /**
   * Carried only by antonymPick questions: the part of speech the prompt is being asked
   * under, printed beside it.
   *
   * It exists because `antonyms` is a **word-level** array, not a per-meaning one, and
   * 22.8% of askable directions come from a polysemous word. `agnostic` alone on screen
   * with `platform-specific` as its opposite is unanswerable for a learner thinking about
   * 不可知论; naming the part of speech points at the right sense without handing over the
   * gloss, which the question type deliberately withholds.
   *
   * Always the *provable* one: the answer word's when the answer is in the library, the
   * prompt's own when it is not — and in that second case the question is skipped
   * altogether unless the prompt's meanings agree on one.
   */
  promptPos?: string
}

/**
 * Picks a meaning weighted by its share.
 *
 * This used to hardcode `w.meanings[0]`, with the consequence that **secondary meanings
 * would never come up in a quiz** — `rhetoric`'s "rhetoric [as a field]" or `mire`'s
 * "quagmire" sense would never be encountered again. Weighting by share means a 70% meaning
 * comes up 70% of the time and a 30% meaning 30% of the time, matching the proportions
 * you'd actually encounter them in real usage.
 *
 * When there's no share data (a single-meaning word, or a multi-meaning word pushed in from
 * an external device without annotation), it always falls back to the first meaning: when
 * the data is incomplete, don't randomize out of thin air — preserve the original behavior.
 * Partial share data (only some meanings have share) is likewise treated as incomplete —
 * drawing against a partial set of weights is worse than not weighting at all.
 */
export function pickMeaning(w: Word, rng: () => number): Meaning {
  const ms = w.meanings
  if (ms.length === 1 || ms.some(m => m.share === undefined)) return ms[0]

  const total = ms.reduce((s, m) => s + (m.share ?? 0), 0)
  let r = rng() * total
  for (const m of ms) {
    r -= m.share ?? 0
    if (r < 0) return m
  }
  return ms[ms.length - 1] // Floating-point-error fallback: when rng returns something extremely close to 1, none of the buckets might trigger
}

const meaningLabel = (m: Meaning) => `${m.pos} ${m.zh}`

const BLANK = '___'

/**
 * Blanks out the headword in an example sentence. Locating rules are in lib/headword.ts —
 * cloze blanking and the review card's highlighting are looking for the same thing and
 * share one implementation.
 *
 * **The base form and any inflected form in the same sentence must be blanked out
 * together**: leaving even one in place gives the answer away directly. This wasn't always
 * true — placate's example sentence "to placate passengers…, which placated almost no one"
 * used to blank out only the base form, leaving the answer sitting right there in plain
 * sight.
 *
 * Returns null when it can't be located — better to skip the sentence than to ship a cloze
 * question with no blank in it.
 */
export function clozeExample(sentence: string, headword: string): string | null {
  const re = headwordPattern(sentence, headword)
  return re === null ? null : sentence.replace(re, BLANK)
}

/** Blanks out a collocation. Same rules as clozeExample; kept as a separate function because a collocation is a phrase with a different meaning. */
export function clozeCollocation(collocation: string, headword: string): string | null {
  return clozeExample(collocation, headword)
}

/**
 * Picks a **random** sentence from a set of candidates that can be blanked out; returns
 * null if none can be.
 *
 * **Randomness isn't a nice-to-have here.** This used to just take the first sentence in
 * the array that could be blanked out, and for almost every word `examples[0]` happens to
 * locate the headword successfully — so the same word's cloze question **was always the
 * same sentence**. Measured across 400 runs against real progress data: of the 63 words
 * that ever produced a cloze question, **not one** ever showed a second sentence, even
 * though 297 of 471 words have 3 example sentences written — two-thirds of the sentences
 * written were never used at all.
 */
export function pickCloze(sources: string[], headword: string, rng: () => number): string | null {
  for (const s of shuffle(sources, rng)) {
    const prompt = clozeExample(s, headword)
    if (prompt !== null) return prompt
  }
  return null
}

/**
 * Synonyms/antonyms shared by more than one entry (all lowercased).
 *
 * Measured: 228 of 1597 synonyms show up under more than one entry (overbearing, decree,
 * flexibility, …). Using them as hints produces "both options are correct," and users will
 * conclude the quiz is broken — so these must be excluded when generating questions.
 */
export function sharedSynonyms(words: Word[]): Set<string> {
  const count = new Map<string, number>()
  for (const w of words) {
    for (const s of [...w.synonyms, ...w.antonyms]) {
      const k = s.trim().toLowerCase()
      count.set(k, (count.get(k) ?? 0) + 1)
    }
  }
  return new Set([...count.entries()].filter(([, c]) => c > 1).map(([k]) => k))
}

export function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Collects distractors deduped by the display text labelFn renders, excluding w itself and
// answerLabel. Looks in pool first, and if fewer than 3 are found falls back to the whole
// word library to fill the rest; if still fewer than 3 after deduping, returns null and the
// caller skips this candidate word — a question with duplicate options (or a duplicated
// correct answer) must never be output.
function pickDistractorLabels(
  w: Word,
  answerLabel: string,
  labelFn: (word: Word) => string,
  pool: Word[],
  fallback: Word[],
  rng: () => number,
): string[] | null {
  const seen = new Set<string>([answerLabel])
  const result: string[] = []

  const collect = (list: Word[]) => {
    for (const cand of shuffle(list.filter(x => x.id !== w.id), rng)) {
      if (result.length >= 3) break
      const label = labelFn(cand)
      if (seen.has(label)) continue
      seen.add(label)
      result.push(label)
    }
  }

  collect(pool)
  if (result.length < 3) collect(fallback)

  return result.length === 3 ? result : null
}

/** Lapses past this stop adding weight — beyond a few, a word is already at the top of the pile and further counts say nothing new. */
const LAPSE_WEIGHT_CAP = 3

/**
 * What a fresh miss is worth in the draw.
 *
 * 1 doubles a baseline word: weightedShuffle's stated semantics are that
 * "a weight of 2 makes an item behave like two entries", so a word you
 * just fumbled is worth exactly two untouched ones. Sized to sit alongside
 * the ease term rather than swamp it — the warning against cranking
 * multipliers below applies to this one too.
 */
const RECENT_MISS_WEIGHT = 1

/**
 * How much more often a word should be quizzed than an average one.
 *
 * Selection used to be a plain shuffle, so a word forgotten five times and
 * one never missed came up equally often. This tilts that, using the two
 * difficulty signals the data actually carries:
 *
 * - **Ease**, primarily. It is the scheduler's own running estimate, it is
 *   continuous, and it moves in both directions. Only distance *below* the
 *   starting value counts: a word that has climbed above it is not easier
 *   than average in a way worth acting on, and penalising it would just
 *   bury words the user knows for no gain.
 * - **Lapses**, as a supplement. It never decreases and is sparse — 11 of
 *   169 learned words carry any — so it cannot be the main signal, but a
 *   word that has genuinely been forgotten deserves the lift.
 * - **A recent miss**, added later. Every practice surface stamps
 *   `missedAt` and the stubborn-word drill was its only reader, so a word
 *   fumbled in a quiz an hour ago was no likelier to be asked again than
 *   one never missed — the two signals the app already collects were not
 *   speaking to each other. It carries no weight past
 *   MISS_RECENCY_DAYS, and answering the word correctly anywhere clears
 *   the stamp outright, so unlike `lapses` this term genuinely decays.
 *
 * Measured over the live library (311 learned words, 2026-08-08, 300
 * simulated ten-question quizzes). Words that have lapsed or lost ease are
 * 29.9% of the library and take 40.6% of quiz slots, so the ease/lapse tilt
 * is doing real work. Adding the miss term takes recently-missed words from
 * 2.4% of slots to 4.1% — a 1.7x lift on the handful of words it applies
 * to, while the struggling share as a whole barely moves (40.6% to 41.4%).
 * All 311 words are still drawn; nothing starves.
 *
 * **The heaviest word does not change: 3.47x an untouched one either way.**
 * The word at the top is there on ease and lapses, and a fresh miss adds a
 * flat 1 rather than multiplying, so this term cannot produce a new
 * runaway. That is the property that makes it safe to add.
 *
 * The aggregate numbers look small because only 6 words carried a miss
 * inside the window on the day this was measured — which is the point. The
 * term exists to matter for the few words you just fumbled, not to reshape
 * the draw.
 *
 * A deliberately modest shift. Most learned words sit at exactly the
 * starting ease because they have only ever been graded "good", so that
 * signal is thin; the way to sharpen it is to use "hard" during review,
 * not to crank the multipliers here and amplify noise.
 */
export function difficultyWeight(w: Word, progress: Progress, today: string): number {
  const e = progress.words[w.id]
  if (!e) return 1
  // `today` is threaded in rather than read from the clock here: every
  // date-dependent function in lib/ takes its date (see srs.ts, queue.ts),
  // and a hidden new Date() would make the weighting untestable at exactly
  // the boundary that matters.
  const missedRecently = e.missedAt !== undefined && e.missedAt >= addDays(today, -MISS_RECENCY_DAYS)
  return 1
    + 1.5 * Math.max(0, INITIAL_EASE - e.ease)
    + 0.5 * Math.min(e.lapses, LAPSE_WEIGHT_CAP)
    + (missedRecently ? RECENT_MISS_WEIGHT : 0)
}

/**
 * Shuffle where heavier items tend toward the front, without ever excluding
 * the light ones.
 *
 * Efraimidis-Spirakis: give each item the key `rng() ** (1 / weight)` and
 * sort descending. A weight of 2 makes an item behave like two entries in
 * the draw.
 *
 * **Weighted, not sorted, and that is the point.** Taking the N hardest
 * words outright would hand back the same quiz every time — the exact
 * complaint the stubborn-word drill produced when its list could not
 * change. Every word stays reachable; the odds just move.
 */
export function weightedShuffle<T>(items: T[], weight: (t: T) => number, rng: () => number): T[] {
  return items
    .map(item => ({ item, key: rng() ** (1 / Math.max(0.0001, weight(item))) }))
    .sort((a, b) => b.key - a.key)
    .map(x => x.item)
}

/** Candidate pool for question generation: learned words take priority, falling back to the whole word library if fewer than 4. Shared by three generator functions. */
function questionPool(words: Word[], progress: Progress): Word[] | null {
  const learned = words.filter(w => progress.words[w.id] && progress.words[w.id].state !== 'new')
  const pool = learned.length >= 4 ? learned : words
  return pool.length < 4 ? null : pool
}

/**
 * @param types The rotating question types, **must be a subset of `QUIZ_TYPES`** — the
 *   function body only handles those six; contrast and audio2* have their own generator
 *   functions. Sprint mode uses this parameter to narrow things down to two four-choice
 *   types (a spelling question would blow the 60-second pace).
 */
/**
 * The two graphs an antonymPick question has to consult, built once per quiz.
 *
 * Same reason `sharedSynonymsCache` is hoisted out of the candidate loop
 * below: `buildContrastPairs` walks the whole library, and rebuilding it per
 * question would make generation O(n²).
 */
export interface AntonymIndices {
  /** id → every string that is an opposite of it, normalized → authored spelling. Answers *and* exclusions. */
  answers: Map<string, Map<string, string>>
  /** id → every library word it is confusable with, read off the contrast graph */
  confusable: Map<string, Set<string>>
  /**
   * Part of speech → every antonym string authored under a word of that
   * part of speech, paired with the id of the word that authored it.
   *
   * The distractor pool for an external answer. External strings carry no
   * part of speech of their own, so the source word's stands in: an
   * opposite of an adjective is an adjective. Grouped once per quiz for the
   * same reason `sharedSynonymsCache` is hoisted — walking the library per
   * question would make generation O(n²).
   */
  external: Map<string, { text: string; from: string }[]>
}

export function buildAntonymIndices(words: Word[]): AntonymIndices {
  const external = new Map<string, { text: string; from: string }[]>()
  for (const w of words) {
    const pos = w.meanings[0]?.pos
    if (pos === undefined) continue
    for (const raw of w.antonyms) {
      const text = raw.trim()
      if (text === '') continue
      const list = external.get(pos)
      if (list) list.push({ text, from: w.id })
      else external.set(pos, [{ text, from: w.id }])
    }
  }
  return { answers: antonymAnswerIndex(words), confusable: confusableIndex(words), external }
}

/**
 * One "pick the opposite" question, or null when it can't be built cleanly.
 *
 * Exported so the full-library regression can force a direction and assert
 * that every one of the 1116 askable directions survives the exclusions.
 *
 * ## What the options may not contain
 *
 * Four things are kept out of the distractors, and all four are the same
 * failure wearing different clothes — **a four-choice question with two
 * correct answers**, which is what `sharedSynonyms` was introduced to stop
 * (see its comment above):
 *
 * 1. *Every* opposite of the prompt word, not just the one drawn as the
 *    answer. 38 of the library's 135 antonym-paired words carry more than
 *    one; antagonize and agreeable carry four. Polysemy makes this sharper
 *    than it looks — `antonyms` is a word-level array, so `agnostic` lists
 *    `believer` for its 不可知论者 sense and `platform-specific` for its
 *    技术中立 sense, and each is correct under a prompt that names neither.
 * 2. Anything confusable with the answer. A word sharing a synonym with the
 *    answer is very likely an opposite of the prompt as well — nobody wrote
 *    it into the `antonyms` array, which is precisely why absence there
 *    can't be trusted.
 * 3. A different part of speech from the answer. The other question types
 *    don't filter on POS and don't need to; here, three verbs standing
 *    beside one adjective hand the answer over without the learner reading
 *    a single word.
 * 4. **A different population from the answer.** An external answer takes
 *    external distractors and a library answer takes library headwords,
 *    because otherwise "the one I have never studied" answers every
 *    question. That is rule 3's defect again — an option dimension that
 *    correlates perfectly with correctness — except a learner can exploit
 *    this one without knowing any English at all.
 *
 * Rules 3 and 4 are hard requirements rather than preferences. Falling back
 * to mixed distractors when the matching pool runs dry would quietly turn
 * the thin cases — the ones most likely to hit it — into free questions;
 * returning null instead lets the caller move to the next candidate word,
 * which is how every other branch in generateQuiz handles a dead end.
 *
 * ## What may not be the answer
 *
 * Anything `isShapeGiveaway` accepts. `fallible` → `infallible` is answered
 * by spelling, not by meaning.
 *
 * **The filter narrows the answer candidates and nothing else.** Pushing it
 * down into `antonym.ts` would look like one filter in one place and would
 * re-open rule 1: with prompt `conspicuous` and answer `unobtrusive`, a
 * deleted `conspicuous — inconspicuous` edge makes `inconspicuous` an
 * eligible distractor while it is still a correct answer.
 */
export function generateAntonymQuestion(
  w: Word,
  words: Word[],
  pool: Word[],
  indices: AntonymIndices,
  rng: () => number,
  forcedAnswer?: string,
): QuizQuestion | null {
  const norm = (s: string) => s.trim().toLowerCase()
  // Answers *and* exclusions. Read the two uses below as one set that is
  // narrowed for the first purpose only.
  const opposites = indices.answers.get(w.id)
  if (opposites === undefined || opposites.size === 0) return null

  const askable = [...opposites.keys()].filter(k => !isShapeGiveaway(w.headword, k))
  if (askable.length === 0) return null

  const answerKey = forcedAnswer === undefined
    ? askable[Math.floor(rng() * askable.length)]
    : norm(forcedAnswer)
  if (!askable.includes(answerKey)) return null
  const answerText = opposites.get(answerKey)
  if (answerText === undefined) return null

  const byHeadword = new Map(words.map(x => [norm(x.headword), x]))
  const answerWord = byHeadword.get(answerKey)

  /**
   * The part of speech the prompt is being asked under, and it has to be
   * one we can prove. A library answer states its own; an external answer
   * states nothing, so the prompt's own stands in — which is only honest
   * while the prompt has a single one.
   *
   * The 33 words whose meanings span parts of speech are therefore skipped
   * for external answers (71 directions). Tagging `underhand (adj.)` when
   * the answer is `overhand`, which opposes the 下手投球 sense, would print
   * a fabricated label on a study surface; that is worse than a hard
   * question, and worse than no question.
   */
  const promptPos = answerWord === undefined
    ? (new Set(w.meanings.map(m => m.pos)).size > 1 ? undefined : w.meanings[0]?.pos)
    : answerWord.meanings[0]?.pos
  if (promptPos === undefined) return null

  const distractors = answerWord === undefined
    ? externalDistractors(w, answerKey, promptPos, words, byHeadword, opposites, indices, rng)
    : libraryDistractors(w, answerWord, promptPos, words, pool, opposites, indices, rng)
  if (distractors === null) return null

  return {
    type: 'antonymPick',
    // The prompt word, not the answer. Every branch below records the
    // candidate the difficulty weighting drew; recording the answer instead
    // would let a miss demote a word the scheduler never selected.
    wordId: w.id,
    prompt: w.headword,
    promptPos,
    options: shuffle([answerText, ...distractors], rng),
    answer: answerText,
    // Absent for an external answer: there is no entry to open, so the
    // reveal card shows the prompt's side alone. Optional from the day it
    // was added, which is what makes that possible without a migration.
    antonymId: answerWord?.id,
  }
}

/** Rules 1–3 with the answer inside the library — the original path, now reading its exclusion set off strings. */
function libraryDistractors(
  w: Word,
  answer: Word,
  answerPos: string,
  words: Word[],
  pool: Word[],
  opposites: Map<string, string>,
  indices: AntonymIndices,
  rng: () => number,
): string[] | null {
  const norm = (s: string) => s.trim().toLowerCase()
  const nearAnswer = indices.confusable.get(answer.id)

  const eligible = (x: Word) =>
    x.id !== w.id
    && x.id !== answer.id
    && !opposites.has(norm(x.headword))
    && !(nearAnswer?.has(x.id) ?? false)
    && x.meanings[0]?.pos === answerPos

  const seen = new Set<string>([answer.headword, w.headword])
  const picked: string[] = []
  const collect = (list: Word[]) => {
    for (const cand of shuffle(list.filter(eligible), rng)) {
      if (picked.length >= 3) break
      if (seen.has(cand.headword)) continue
      seen.add(cand.headword)
      picked.push(cand.headword)
    }
  }
  // Pool first, then the whole library — the same fallback order
  // pickDistractorLabels uses. A word the learner hasn't met yet is still a
  // perfectly good wrong option.
  collect(pool)
  if (picked.length < 3) collect(words)
  return picked.length < 3 ? null : picked
}

/**
 * Rules 1–4 with the answer outside the library, where the contrast graph
 * has no node for the answer and the three original exclusions have to be
 * re-derived around the *prompt* instead.
 *
 * The middle exclusion is the one that earns its place. Prompt
 * `garrulous`, answer `taciturn`: a distractor lifted from `loquacious` —
 * a confusable partner — would be `reticent` or `quiet`, and both are also
 * correct. A confusable partner's opposites are the prompt's opposites,
 * and nobody wrote them into the prompt's own array, which is exactly why
 * absence there can't be trusted. Same inference `contrast.ts` makes,
 * pointed the other way.
 *
 * `sharedSynonyms` is deliberately **not** consulted. It exists because a
 * string naming two entries makes two options correct when the string is
 * the *prompt*; when it is the *answer* that inference doesn't run, and
 * `praise` opposing both `disparage` and `belittle` costs nothing here.
 */
function externalDistractors(
  w: Word,
  answerKey: string,
  promptPos: string,
  words: Word[],
  byHeadword: Map<string, Word>,
  opposites: Map<string, string>,
  indices: AntonymIndices,
  rng: () => number,
): string[] | null {
  const norm = (s: string) => s.trim().toLowerCase()
  const byId = new Map(words.map(x => [x.id, x]))

  // Every opposite of the prompt, its own synonyms, and itself.
  const banned = new Set<string>([...opposites.keys(), norm(w.headword), answerKey])
  for (const s of w.synonyms) banned.add(norm(s))
  // A confusable partner's opposites are the prompt's opposites.
  for (const id of indices.confusable.get(w.id) ?? []) {
    for (const s of byId.get(id)?.antonyms ?? []) banned.add(norm(s))
  }
  // A synonym of the prompt's opposite is an opposite of the prompt. No
  // library counterpart — the library path gets this from the contrast
  // graph around the answer, which an external answer isn't in.
  for (const k of opposites.keys()) {
    for (const s of byHeadword.get(k)?.synonyms ?? []) banned.add(norm(s))
  }

  const seen = new Set<string>()
  const picked: string[] = []
  for (const cand of shuffle(indices.external.get(promptPos) ?? [], rng)) {
    if (picked.length >= 3) break
    const k = norm(cand.text)
    if (cand.from === w.id || banned.has(k) || seen.has(k)) continue
    // Rule 4: a library headword among external options would put the
    // answer alone on the wrong side of the membership line.
    if (byHeadword.has(k)) continue
    if (isShapeGiveaway(w.headword, k)) continue
    seen.add(k)
    picked.push(cand.text)
  }
  return picked.length < 3 ? null : picked
}

export function generateQuiz(
  words: Word[],
  progress: Progress,
  today: string,
  count: number,
  rng: () => number = Math.random,
  types: readonly QuizType[] = QUIZ_TYPES,
): QuizQuestion[] {
  const pool = questionPool(words, progress)
  if (pool === null) return []
  // An empty type list has to be blocked here: otherwise `types[questions.length %
  // types.length]` below would evaluate to undefined, and every candidate word would fall
  // through to the last branch, producing a pile of questions with type undefined.
  if (types.length === 0) return []

  // The shared-word set is computed once for the whole word library — putting it inside the loop would make it O(n²)
  const sharedSynonymsCache = sharedSynonyms(words)
  // Same reason, and only paid when the rotation actually contains the type:
  // buildAntonymIndices walks the contrast graph over the whole library.
  const antonymIndices = types.includes('antonymPick') ? buildAntonymIndices(words) : null

  const candidates = weightedShuffle(pool, w => difficultyWeight(w, progress, today), rng)
  const questions: QuizQuestion[] = []

  for (let ci = 0; ci < candidates.length && questions.length < count; ci++) {
    const w = candidates[ci]
    const type = types[questions.length % types.length]

    if (type === 'spelling') {
      questions.push({
        type, wordId: w.id,
        prompt: meaningLabel(pickMeaning(w, rng)),
        options: [], answer: w.headword,
        phonetic: w.phonetic,
      })
      continue
    }

    if (type === 'antonymPick') {
      // 475 of 599 words can be asked now that the answer no longer has to
      // be a library headword — up from 135, which is why this branch used
      // to fall through far more often than it does. It can still fall
      // through, and that is fine: the slot index doesn't advance on a
      // `continue`, so the next candidate is tried for the same type
      // rather than the type being skipped.
      const q = antonymIndices === null ? null : generateAntonymQuestion(w, words, pool, antonymIndices, rng)
      if (q === null) continue
      questions.push(q)
      continue
    }

    const headwordLabel = (x: Word) => x.headword

    if (type === 'clozeExample' || type === 'clozeCollocation') {
      const sources = type === 'clozeExample' ? w.examples : w.collocations
      const prompt = pickCloze(sources, w.headword, rng)
      if (prompt === null) continue // None of this word's examples/collocations could locate the headword — move to the next candidate word
      const distractors = pickDistractorLabels(w, w.headword, headwordLabel, pool, words, rng)
      if (!distractors) continue
      questions.push({
        type, wordId: w.id, prompt,
        options: shuffle([w.headword, ...distractors], rng),
        answer: w.headword,
      })
      continue
    }

    if (type === 'synonymHint') {
      const shared = sharedSynonymsCache
      const notShared = (s: string) => !shared.has(s.trim().toLowerCase())
      // Drawn across every non-shared hint, not `.find()`'s first one. The
      // find version pinned each word to a single hint forever: measured
      // over the library (2026-08-07 repetition audit), 1,765 non-shared
      // hints exist but only 481 could ever be shown — 1,284 strings were
      // unreachable, and the same word always asked with the same hint.
      // The shared-synonym exclusion stays: a hint shared by two entries
      // makes two options correct.
      //
      // The shape exclusion is the other half, added 2026-08-19: a hint the
      // answer can be spelled out of tests nothing. 28 of this type's 1964
      // reachable hints were flips of their own headword — `infallible` for
      // `fallible`, `unsociable` for `sociable` — and five more on the
      // synonym side contained the answer outright (`topple over` for
      // `topple`, `quagmire` for `mire`).
      const usable = (s: string) => notShared(s) && !isShapeGiveaway(w.headword, s)
      const syns = w.synonyms.filter(usable)
      const hints = [...syns, ...w.antonyms.filter(usable)]
      if (hints.length === 0) continue // This word's synonyms and antonyms are all shared with other entries or all spell out the answer — move to the next candidate word
      const hint = hints[Math.floor(rng() * hints.length)]
      const distractors = pickDistractorLabels(w, w.headword, headwordLabel, pool, words, rng)
      if (!distractors) continue
      questions.push({
        type, wordId: w.id, prompt: hint,
        options: shuffle([w.headword, ...distractors], rng),
        answer: w.headword,
        // Labeled by which list the drawn hint came from — the UI must say
        // whether to pick the matching or the opposite meaning.
        hintKind: syns.includes(hint) ? 'synonym' : 'antonym',
      })
      continue
    }

    // Which meaning this word uses this time around: drawn by share, no longer hardcoded to meanings[0].
    const ownMeaning = meaningLabel(pickMeaning(w, rng))
    // Distractor meanings are likewise drawn by share — don't let three of the four options
    // be some other word's dominant meaning while the correct answer alone is an obscure
    // sense; that would itself become an extraneous clue.
    // pickDistractorLabels already excludes w itself (see the filter inside its collect),
    // **and this must not change**: a word2meaning prompt shows only the headword, so
    // putting both of mire's meanings into the options would make both correct — the same
    // class of defect sharedSynonyms guards against.
    const meaningOf = (x: Word) => meaningLabel(pickMeaning(x, rng))
    const labelFn = type === 'word2meaning' ? meaningOf : (x: Word) => x.headword
    const answer = type === 'word2meaning' ? ownMeaning : w.headword
    const distractors = pickDistractorLabels(w, answer, labelFn, pool, words, rng)
    if (!distractors) continue // Still fewer than 3 distractors after deduping — skip this word, next candidate takes its place

    questions.push({
      type, wordId: w.id,
      prompt: type === 'word2meaning' ? w.headword : ownMeaning,
      options: shuffle([answer, ...distractors], rng),
      answer,
    })
  }

  return questions
}

/**
 * The closeness threshold for discrimination questions.
 *
 * Below 2 points, it's all noise — "shares one synonym, otherwise unrelated": `promulgate`
 * and `metastasize` share `disseminate`, but one means enacting a law and the other means
 * cancer cells spreading, so pairing them up is a free point. Measured: among 476 words,
 * 140 pairs score 3 or above — enough to generate questions from.
 */
export const CONTRAST_MIN_SCORE = 3

/**
 * A single discrimination question: blanks out the headword in `answer`'s example
 * sentence, having the user choose between answer and other. Returns null if it can't be
 * built, and the caller swaps sides or tries a different pair.
 */
function contrastQuestion(answer: Word, other: Word, rng: () => number): QuizQuestion | null {
  // Shuffles first, same as pickCloze — taking the first candidate in order would make the
  // same pair's question always the same sentence. pickCloze isn't used directly here
  // because there's an extra filter: "the other word's headword must not remain in the
  // sentence."
  for (const s of shuffle(answer.examples, rng)) {
    const prompt = clozeExample(s, answer.headword)
    if (prompt === null) continue
    // **The other word's headword must not remain in the sentence**: if both candidate
    // words appear in the prompt at once, there's no real choice left ("We alpha and bravo
    // together" — blank out alpha, and bravo is still sitting right there, giving the
    // answer away). Uses the same locating rules as cloze blanking, catching inflected
    // forms too — better to skip this sentence.
    if (headwordPattern(prompt, other.headword) !== null) continue
    return {
      type: 'contrast',
      wordId: answer.id,
      prompt,
      options: shuffle([answer.headword, other.headword], rng),
      answer: answer.headword,
      contrastId: other.id,
    }
  }
  return null
}

/**
 * Question generation for discrimination mode: draws from confusable-word pairs, **two
 * options**, judged by collocation and context.
 *
 * The real difficulty with advanced vocabulary isn't "recognizing" a word, it's "knowing
 * which one to use" — a gap the existing six question types don't cover at all, even though
 * the data (synonym overlap) has been sitting in the word library the whole time.
 */
/** The canonical recency key for a contrast pair: both ids, sorted — the same unordered-pair shape contrastNoteKey uses. */
export const contrastPairKey = (a: string, b: string): string => [a, b].sort().join('|')

export function generateContrastQuiz(
  words: Word[],
  progress: Progress,
  count: number,
  rng: () => number = Math.random,
  recentPairs: readonly string[] = [],
): QuizQuestion[] {
  const all = buildContrastPairs(words)
  if (all.length === 0) return []

  const isLearned = (id: string) => {
    const e = progress.words[id]
    return e !== undefined && e.state !== 'new'
  }

  // **A question is only generated when both words are learned** — the same rule enforced
  // by questionPool's hard filter for mixed/listening mode.
  //
  // This used to just sort "both learned" pairs to the front — **sorting isn't a
  // guarantee**: measured, a user with 63 learned words in the 471-word library could only
  // form 7 pairs from them, so sorting still fell through into unlearned words, and 53.7%
  // of questions tested words the user had never seen (mixed and listening mode were both
  // 0% under the same progress data). Discrimination questions test "which one to use," and
  // asking that about two words you've never learned is meaningless.
  //
  // **There is deliberately no fallback of "retreat to the whole library if learned words
  // can't form enough pairs."** An earlier version had exactly that, and it reproduced the
  // exact bug users reported: after learning 20 words, if they happened to form zero pairs,
  // the entire round of questions was on words never seen before. An empty mode isn't a
  // malfunction — it comes with a line of copy explaining why (see EMPTY_HINT.contrast in
  // Quiz.tsx) — whereas out-of-scope questions silently waste time and erode trust in the
  // whole quiz.
  const base = all.filter(p => isLearned(p.a) && isLearned(p.b))
  const tight = base.filter(p => p.score >= CONTRAST_MIN_SCORE)
  // When there aren't enough tight pairs for a full round, fall back to every pair within
  // this set of words — a looser pair of **learned** words beats a tight pair that hasn't
  // been learned.
  const pool = tight.length >= count ? tight : base

  const byId = new Map(words.map(w => [w.id, w]))

  // Recently asked pairs go behind unseen ones — a stable partition after
  // the shuffle, not an exclusion, so a pool smaller than the window still
  // fills the round. The repetition audit put contrast as the surface that
  // goes stale first: 142 usable pairs at the all-learned bound, and with
  // no cross-session memory the first repeat lands within ~1.5 days at 10
  // questions a day.
  //
  // The window is two thirds of the pool, capped at pool−1 — the same
  // fraction recentWindow in passage.ts measured its way to (a fixed window
  // left the same eleven passages cycling forever). Restated here rather
  // than imported because passage.ts already imports from this module, and
  // a cycle is worse than three lines of arithmetic.
  const window = Math.max(0, Math.min(pool.length - 1, Math.floor((pool.length * 2) / 3)))
  const seen = new Set(recentPairs.slice(0, window))
  const drawn = shuffle(pool, rng)
  const ordered = [
    ...drawn.filter(p => !seen.has(contrastPairKey(p.a, p.b))),
    ...drawn.filter(p => seen.has(contrastPairKey(p.a, p.b))),
  ]

  const questions: QuizQuestion[] = []
  for (const pair of ordered) {
    if (questions.length >= count) break
    const wa = byId.get(pair.a)
    const wb = byId.get(pair.b)
    if (wa === undefined || wb === undefined) continue
    // Which word becomes the answer is randomized, otherwise the alphabetically earlier one would always be the answer — users would learn to exploit that pattern
    const [first, second] = rng() < 0.5 ? [wa, wb] : [wb, wa]
    const q = contrastQuestion(first, second, rng) ?? contrastQuestion(second, first, rng)
    if (q !== null) questions.push(q)
  }
  return questions
}

/**
 * Question generation for listening mode: audio→meaning and audio→spelling rotate.
 *
 * `prompt` holds **the headword to be read aloud**, not a prompt meant for display — see the comment on QuizQuestion.prompt.
 */
export function generateAudioQuiz(
  words: Word[],
  progress: Progress,
  today: string,
  count: number,
  rng: () => number = Math.random,
): QuizQuestion[] {
  const pool = questionPool(words, progress)
  if (pool === null) return []

  const candidates = weightedShuffle(pool, w => difficultyWeight(w, progress, today), rng)
  const questions: QuizQuestion[] = []

  for (let ci = 0; ci < candidates.length && questions.length < count; ci++) {
    const w = candidates[ci]
    const type = AUDIO_TYPES[questions.length % AUDIO_TYPES.length]

    if (type === 'audio2spelling') {
      questions.push({
        type, wordId: w.id,
        prompt: w.headword,
        options: [], answer: w.headword,
        phonetic: w.phonetic,
      })
      continue
    }

    const answer = meaningLabel(pickMeaning(w, rng))
    const distractors = pickDistractorLabels(w, answer, x => meaningLabel(pickMeaning(x, rng)), pool, words, rng)
    if (!distractors) continue
    questions.push({
      type, wordId: w.id,
      prompt: w.headword,
      options: shuffle([answer, ...distractors], rng),
      answer,
    })
  }

  return questions
}
