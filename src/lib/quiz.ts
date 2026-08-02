import { buildContrastPairs } from './contrast'
import { headwordPattern } from './headword'
import { INITIAL_EASE } from './srs'
import type { Meaning, Progress, Word } from '../types'

export type QuizType =
  | 'word2meaning' | 'meaning2word' | 'spelling'
  | 'clozeExample' | 'clozeCollocation' | 'synonymHint'
  | 'contrast' | 'audio2meaning' | 'audio2spelling'

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
  'clozeExample', 'clozeCollocation', 'synonymHint',
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
 *
 * Measured over the live library (169 learned words): words that have
 * lapsed or lost ease go from 10.7% of quiz slots to 17.1%, and the
 * heaviest word is 2.5x an untouched one. Simulating 300 ten-question
 * quizzes gives 16.9%, and still draws all 169 words — nothing starves.
 *
 * A deliberately modest shift. 79% of learned words sit at exactly the
 * starting ease because they have only ever been graded "good", so the
 * signal is thin; the way to sharpen it is to use "hard" during review,
 * not to crank the multipliers here and amplify noise.
 */
export function difficultyWeight(w: Word, progress: Progress): number {
  const e = progress.words[w.id]
  if (!e) return 1
  return 1 + 1.5 * Math.max(0, INITIAL_EASE - e.ease) + 0.5 * Math.min(e.lapses, LAPSE_WEIGHT_CAP)
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
export function generateQuiz(
  words: Word[],
  progress: Progress,
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

  const candidates = weightedShuffle(pool, w => difficultyWeight(w, progress), rng)
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
      const syn = w.synonyms.find(s => !shared.has(s.trim().toLowerCase()))
      const ant = w.antonyms.find(s => !shared.has(s.trim().toLowerCase()))
      const hint = syn ?? ant
      if (hint === undefined) continue // This word's synonyms and antonyms are all shared with other entries — move to the next candidate word
      const distractors = pickDistractorLabels(w, w.headword, headwordLabel, pool, words, rng)
      if (!distractors) continue
      questions.push({
        type, wordId: w.id, prompt: hint,
        options: shuffle([w.headword, ...distractors], rng),
        answer: w.headword,
        hintKind: syn !== undefined ? 'synonym' : 'antonym',
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
export function generateContrastQuiz(
  words: Word[],
  progress: Progress,
  count: number,
  rng: () => number = Math.random,
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

  const questions: QuizQuestion[] = []
  for (const pair of shuffle(pool, rng)) {
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
  count: number,
  rng: () => number = Math.random,
): QuizQuestion[] {
  const pool = questionPool(words, progress)
  if (pool === null) return []

  const candidates = weightedShuffle(pool, w => difficultyWeight(w, progress), rng)
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
