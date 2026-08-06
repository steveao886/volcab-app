import { isInflectionOf, splitByHeadword } from './headword'
import { difficultyWeight, weightedShuffle } from './quiz'
import type { Progress, Word } from '../types'

/**
 * 猜词 — the only mode that asks for the word rather than offering it.
 *
 * The other five are recognition: four options, or a candidate list. This
 * one shows a Chinese gloss and an empty box, which is a far harder and far
 * more useful retrieval direction — and the reason it needs a clue economy
 * at all. See docs/superpowers/specs/2026-08-06-guess-mode-design.md.
 *
 * Everything here is pure. The page paints what these functions decide.
 */

/** What a blanked-out headword looks like inside a clue. */
const BLANK = '____'

/**
 * Whether a typed answer counts.
 *
 * Deliberately lenient: case, surrounding whitespace and inflection are all
 * forgiven, because the question is whether the word is in your head, not
 * whether you conjugated it under time pressure. `isInflectionOf` is the
 * same matcher the passage validator uses, so "counts as the word" means
 * one thing across the app.
 */
export function checkGuess(input: string, headword: string): boolean {
  return isInflectionOf(input, headword)
}

/**
 * Hides the headword inside a clue drawn from example text.
 *
 * Not optional politeness — measured over the 498-word library, the
 * headword appears verbatim in 498/498 collocations, 495/498 examples and
 * 254/300 word notes. Unmasked, those three clues are the answer.
 *
 * Returns **null when the word cannot be located**, and the caller must
 * then withhold that clue rather than fall back to the raw text. One clue
 * fewer costs the learner a couple of points; one leaked answer costs the
 * question. splitByHeadword reports a failed locate as "no segment hit",
 * which is exactly the signal needed here — the same locate that
 * ExampleSentence uses to decide whether it can highlight.
 */
export function maskHeadword(text: string, headword: string): string | null {
  if (text.trim() === '') return null
  const segments = splitByHeadword(text, headword)
  if (!segments.some(s => s.hit)) return null
  return segments.map(s => (s.hit ? BLANK : s.text)).join('')
}

export type ClueKind = 'pos' | 'note' | 'collocation' | 'etymology' | 'example' | 'initial'

/**
 * What each clue costs, out of the 10 points a word starts at.
 *
 * The two that can be measured were measured, over the 498-word library:
 * **词性** partitions it into 5 classes and leaves 174 candidates standing
 * (35%); **首字母** leaves 38 (7.6%). That gap is the spread the rest of the
 * table is hung on.
 *
 * The other four can't be partitioned that way and are ranked by how much of
 * the answer they hand over: a masked collocation leaves a grammatical frame
 * and one co-occurring word; a masked example leaves a whole context; an
 * etymology hands over the root, which often points straight at the spelling
 * (and covers 97% of the library, so it is rarely the one missing).
 *
 * These four are a claim, not a measurement. If play shows one mispriced,
 * re-measure and update both this table and the spec.
 */
export const CLUE_PRICES: Record<ClueKind, number> = {
  pos: 1,
  note: 2,
  collocation: 2,
  etymology: 3,
  example: 3,
  initial: 4,
}

export interface Clue { kind: ClueKind; price: number; text: string }

export interface GuessQuestion {
  id: string
  headword: string
  /** The Chinese gloss of the dominant sense — the whole question. */
  prompt: string
  /** Cheapest first, so the shop reads as a ladder even though it is not one. */
  clues: Clue[]
  /**
   * The word's own synonyms and antonyms, lowercased. Not shown anywhere —
   * they exist so a near-miss can tell "you mistyped it" apart from "you
   * reached for a different word". See classifyGuess.
   */
  related: string[]
}

/** First maskable entry, or none. A word can carry a collocation the masker can't locate. */
const firstMaskable = (texts: string[], headword: string): string | null => {
  for (const t of texts) {
    const masked = maskHeadword(t, headword)
    if (masked !== null) return masked
  }
  return null
}

/**
 * One question, or null when the word can't carry one.
 *
 * `note` is the word's 要点 from src/data/wordNotes.json, which only 60% of
 * words have; passing undefined is the normal case, not an error.
 *
 * Clues that have no data behind them are simply absent — the same
 * treatment Word.etymology already gets on the review card. So are clues
 * whose text couldn't be masked: leaking the answer is worse than being one
 * clue poorer.
 */
export function buildGuessQuestion(w: Word, note: string | undefined): GuessQuestion | null {
  const meaning = w.meanings[0]
  const prompt = meaning?.zh.trim() ?? ''
  const headword = w.headword.trim()
  // No gloss means no question: the prompt *is* the gloss. Failing closed
  // here rather than showing an empty card, per the codebase rule.
  if (prompt === '' || headword === '') return null

  const clues: Clue[] = []
  const add = (kind: ClueKind, text: string | null) => {
    if (text !== null && text.trim() !== '') clues.push({ kind, price: CLUE_PRICES[kind], text })
  }

  add('pos', meaning.pos.trim() === '' ? null : meaning.pos)
  add('note', note === undefined ? null : maskHeadword(note, headword))
  add('collocation', firstMaskable(w.collocations, headword))
  // Etymology inverts the masking rule. Measured: only 3 of 481 name the
  // word, because they end on the Chinese sense rather than the lemma — so
  // "cannot locate" is the *good* case here and must not withhold the clue.
  // The rare one that does name it gets blanked like the others.
  if (w.etymology !== undefined && w.etymology.trim() !== '') {
    add('etymology', maskHeadword(w.etymology, headword) ?? w.etymology)
  }
  add('example', firstMaskable(w.examples, headword))
  add('initial', headword[0])

  return {
    id: w.id,
    headword,
    prompt,
    clues: clues.sort((a, b) => a.price - b.price || a.kind.localeCompare(b.kind)),
    related: [...w.synonyms, ...w.antonyms].map(s => s.trim().toLowerCase()).filter(s => s !== ''),
  }
}

/** Levenshtein distance. Two rows rather than a full matrix; the strings here are single words. */
export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/**
 * How much of a word may be wrong before "you mistyped it" stops being true.
 *
 * A quarter of the longer string, floored, minimum one edit: raze allows one,
 * abrogate two, circumlocution three. Measured over the 498 headwords, this
 * threshold puts **21 pairs of genuinely distinct words** inside each other's
 * allowance out of 117,855 pairs (0.018%) — at 0.34 it is 97 pairs and
 * includes arduous/garrulous, which is plainly a different word rather than a
 * slip. Those 21 are why classifyGuess has the two guards below rather than
 * trusting the distance alone.
 */
const NEAR_RATIO = 0.25

const nearBudget = (a: string, b: string): number =>
  Math.max(1, Math.floor(Math.max(a.length, b.length) * NEAR_RATIO))

export type GuessVerdict = 'correct' | 'near' | 'wrong'

/**
 * What a typed answer actually was: right, a slip of the fingers, or a
 * different word.
 *
 * "Near" exists so the app can say *which kind* of miss it was — being one
 * letter out and being wrong are different problems, and lumping them
 * together makes the feedback useless. It costs nothing, and it does not end
 * the question: you are told, you fix it.
 *
 * Two things are **never** near, however close they measure:
 *
 * - **Another word in the library.** 21 pairs of distinct headwords sit
 *   inside the allowance (imperious/impetuous, contentious/conscientious,
 *   gratify/ratify, disparate/disparage). Reaching for the wrong word is a
 *   different failure from mistyping the right one, and telling someone
 *   their spelling was close would hide it.
 * - **This word's own synonyms and antonyms.** raze's gloss warns "注意与
 *   raise 反义", and raise is one edit away. Answering with the antonym is
 *   the exact mistake the entry is trying to prevent.
 */
export function classifyGuess(
  input: string,
  q: GuessQuestion,
  libraryWords: ReadonlySet<string>,
): GuessVerdict {
  const typed = input.trim().toLowerCase()
  if (typed === '') return 'wrong'
  if (checkGuess(typed, q.headword)) return 'correct'
  if (q.related.includes(typed)) return 'wrong'
  if (libraryWords.has(typed)) return 'wrong'

  const d = editDistance(typed, q.headword.trim().toLowerCase())
  return d <= nearBudget(typed, q.headword) ? 'near' : 'wrong'
}

/**
 * One session's worth of questions.
 *
 * **Learned words only.** Asking someone to produce a word they have never
 * met is not retrieval practice, it is a guessing game with no floor.
 *
 * Selection reuses quiz.ts's difficultyWeight + weightedShuffle, the same
 * pair the other modes draw with, so "the words giving you trouble come up
 * more often" means one thing across the app — and the easy ones are never
 * excluded outright, just made less likely.
 *
 * `rng` is injected and defaults nowhere: the caller passes Math.random.
 * Never call Math.random in here — the tests depend on it.
 */
export function generateGuessSession(
  words: Word[],
  progress: Progress,
  notes: Record<string, string>,
  count: number,
  rng: () => number,
): GuessQuestion[] {
  const pool = words.filter(w => {
    const e = progress.words[w.id]
    return e !== undefined && e.state !== 'new'
  })

  const out: GuessQuestion[] = []
  for (const w of weightedShuffle(pool, x => difficultyWeight(x, progress), rng)) {
    if (out.length >= count) break
    // A word with no gloss can't carry a question; skip it rather than emit
    // a blank card. Read the note leniently — 40% of words have none.
    const q = buildGuessQuestion(w, notes[w.id])
    if (q !== null) out.push(q)
  }
  return out
}

/** What a word is worth before any clue is bought. */
export const WORD_START_SCORE = 10

export type GuessOutcome = 'solved' | 'revealed'

/**
 * What one word ended up worth.
 *
 * Solving floors at 1 rather than 0 even when every clue was bought — the
 * full shop costs 15 against a 10-point word, and if buying out could reach
 * zero then giving up would be free by comparison and the shop would turn
 * into a trap. Working it out has to stay strictly better than being told.
 *
 * Wrong guesses cost nothing: the score measures how much help was needed,
 * not how many attempts were made.
 */
export function scoreWord(cluesUsed: ClueKind[], outcome: GuessOutcome): number {
  if (outcome === 'revealed') return 0
  const spent = cluesUsed.reduce((n, k) => n + CLUE_PRICES[k], 0)
  return Math.max(1, WORD_START_SCORE - spent)
}
