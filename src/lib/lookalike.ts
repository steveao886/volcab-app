import { confusableIndex } from './contrast'
import { isInflectionOf } from './headword'
import { difficultyWeight, meaningLabel, shuffle, weightedShuffle } from './quiz'
import type { QuizQuestion } from './quiz'
import type { Progress, Word } from '../types'

/**
 * Look-alike words: pairs spelled nearly the same and meaning different things —
 * `allude`/`elude`, `averse`/`adverse`, `ingenious`/`ingenuous`.
 *
 * 辨析 already pairs words that *mean* nearly the same (contrast.ts, built on
 * shared synonyms). This is the other confusion, the one a reader makes before
 * meaning is reached at all: the eye lands on `elude` and the head supplies
 * `allude`. Nothing in the synonym graph can see it, because the two words
 * share no synonyms — that is what makes them worth drilling.
 *
 * **Computed from spelling, not authored.** A pair that is only loosely alike
 * costs targeting, never correctness: the gloss rule below guarantees the
 * partner's meaning is a *wrong* answer, so the worst a weak pair produces is a
 * fair question about a confusion the user may never have had. An authored list
 * would cost a curation step on every new word for that.
 *
 * See docs/superpowers/specs/2026-10-29-lookalike-quiz-design.md.
 */

export interface LookalikePair {
  /** Word id, the alphabetically earlier one */
  a: string
  /** Word id, the alphabetically later one */
  b: string
  /** Edits between the two headwords, swaps counted as one */
  distance: number
  /** Share of the longer headword covered by the common opening plus the common ending */
  frame: number
}

/**
 * Edit distance with a swap of two adjacent letters counted as one edit
 * (optimal string alignment).
 *
 * The swap is the reason this isn't plain Levenshtein: `form`/`from` is the
 * look-alike there is, and plain Levenshtein calls it two edits — the same
 * score as `testy`/`petty`, which share almost nothing.
 */
export function osaDistance(a: string, b: string): number {
  return osaTable(a, b)[a.length][b.length]
}

function osaTable(a: string, b: string): number[][] {
  const d: number[][] = []
  for (let i = 0; i <= a.length; i++) d.push([i])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let best = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[i - 2][j - 2] + 1)
      }
      d[i][j] = best
    }
  }
  return d
}

/**
 * Which letters differ, on each side — for the reveal, which marks them.
 *
 * Read off one optimal alignment: a substitution or a swap marks the letters on
 * both sides, an insertion marks only the side that has the extra letter
 * (`averse`/`adverse` marks the `d` and nothing in `averse`).
 */
export function diffMarks(a: string, b: string): [boolean[], boolean[]] {
  const d = osaTable(a, b)
  const ma = a.split('').map(() => false)
  const mb = b.split('').map(() => false)
  let i = a.length
  let j = b.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1] && d[i][j] === d[i - 1][j - 1]) {
      i--; j--
    } else if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] && d[i][j] === d[i - 2][j - 2] + 1) {
      ma[i - 1] = ma[i - 2] = mb[j - 1] = mb[j - 2] = true
      i -= 2; j -= 2
    } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) {
      ma[i - 1] = mb[j - 1] = true
      i--; j--
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ma[i - 1] = true
      i--
    } else {
      mb[j - 1] = true
      j--
    }
  }
  return [ma, mb]
}

/** Single words only: a phrase's look-alike is a different preposition, which is a collocation problem, not a reading one. */
const SINGLE_WORD = /^[a-z]+$/

/**
 * Below this, a word has too few letters for a resemblance to mean anything:
 * at three letters one edit is a third of the word (`vex`/`hex`).
 */
const MIN_LENGTH = 4

/**
 * Two edits pass only when the common opening plus the common ending cover at
 * least this share of the longer word — when the difference sits *inside* a
 * frame that matches.
 *
 * That frame is what the eye reads; two edits alone is mostly rhymes. Measured
 * over the live library on 2026-10-29: `allude`/`elude` (4 of 6),
 * `imminent`/`eminent` (6 of 8) and `obscene`/`obscure` (5 of 7) pass;
 * `devious`/`tedious` (4 of 7), `elude`/`crude` (3 of 5) and `testy`/`petty`
 * (2 of 5) do not. Compared as integers so 4 of 6 is not lost to rounding.
 */
const FRAME_NUM = 2
const FRAME_DEN = 3

/** Five letters minimum for a two-edit pair: at four, two edits is half the word (`rash`/`mesh`). */
const MIN_LENGTH_TWO_EDITS = 5

/**
 * Prefixes that turn a word into its opposite. A word and its negation look
 * alike but are never confused — the prefix *is* the meaning, and reading it is
 * exactly what the learner already does (`resolute`/`irresolute`).
 */
const NEGATION_PREFIXES = ['un', 'in', 'im', 'il', 'ir', 'dis', 'non', 'a', 'an', 'mis']

/**
 * Endings that change a word's part of speech and little else.
 *
 * Used only to recognise two words built on one base. Bounded on purpose — it
 * has to recognise `eminence`/`eminent` and `captivate`/`captive`, not be a
 * morphology engine; a family it misses becomes one easy question, not a wrong one.
 */
const DERIVATION_SUFFIXES = [
  'ence', 'ency', 'ent', 'ance', 'ancy', 'ant', 'ation', 'ative', 'ate', 'ive', 'ion', 'ity', 'ty', 'y',
  'al', 'acy', 'en', 'able', 'ible', 'ous', 'ious', 'ness', 'ment', 'ize', 'ic', 'ical',
]

function bases(word: string): Set<string> {
  const out = new Set([word, word.replace(/e$/, '')])
  for (const s of DERIVATION_SUFFIXES) {
    if (word.endsWith(s) && word.length - s.length >= MIN_LENGTH) out.add(word.slice(0, -s.length))
  }
  return out
}

/**
 * One base in two parts of speech: `eminence`/`eminent`, `hasty`/`hasten`.
 *
 * Not a confusion — it is one idea in two grammatical roles, and the partner's
 * meaning differs from the answer's by its part-of-speech tag alone, so the
 * question is answered off the suffix. **The same base in the same part of
 * speech is kept**, because there the meanings have drifted apart and the trap
 * is real: `precedence` (优先权) / `precedent` (先例), `perceptible` (可察觉的) /
 * `perceptive` (敏锐的).
 */
function derivedSiblings(x: Word, y: Word, a: string, b: string): boolean {
  const ba = bases(a)
  const shareBase = [...bases(b)].some(s => s.length >= MIN_LENGTH && ba.has(s))
  if (!shareBase) return false
  const pos = new Set(x.meanings.map(m => m.pos))
  return !y.meanings.some(m => pos.has(m.pos))
}

/**
 * Every two-character run in a word's glosses, across all its meanings.
 *
 * Parentheticals are context, not meaning; 令人 and its kin open a phrase
 * without saying what it is about; and a run containing 的/地/得 is grammar —
 * 内在的 and 外在的 share 在的 and mean opposite things.
 */
function glossBigrams(w: Word): Set<string> {
  const out = new Set<string>()
  for (const m of w.meanings) {
    const zh = m.zh.replace(/[(（][^)）]*[)）]/g, '').replace(/令人|使人|让人|讨人/g, '|')
    for (const run of zh.match(/[一-鿿]+/g) ?? []) {
      for (let i = 0; i + 1 < run.length; i++) {
        const g = run.slice(i, i + 2)
        if (!/[的地得]/.test(g)) out.add(g)
      }
    }
  }
  return out
}

/**
 * Two glosses that share a term mean the same thing somewhere, and then the
 * partner's meaning is a second right answer — `amiable` and `affable` are
 * both 和蔼可亲的. Checked across every meaning, because the option shows only
 * the first and a learner who knows a secondary sense is right to pick it.
 *
 * This is also what removes most same-root families the rules above miss
 * (`complacency`/`complacent` share 自满) and most negations the prefix list
 * misses (`plausible`/`implausible` share 可信).
 */
function glossesOverlap(x: Set<string>, y: Set<string>): boolean {
  for (const g of x) if (y.has(g)) return true
  return false
}

/**
 * Every look-alike pair in the library.
 *
 * Measured on the live library, 2026-10-29 (1,549 words, 1,498 of them single
 * words): 128 pairs, 20 of them one edit apart. Of the candidates that passed
 * on spelling, the rules below dropped 58 as one word plus an ending, 9 as
 * inflections, 30 as negations, 48 as one base in two parts of speech, 21 on a
 * shared gloss term and 2 as near-synonyms. With the live progress (1,064
 * learned) 61 pairs are askable, over 106 words: 93 have one partner, and the
 * most-connected, `perceptive`, has four.
 */
export function buildLookalikePairs(words: Word[]): LookalikePair[] {
  const candidates = words
    .map(w => ({ w, h: w.headword.trim().toLowerCase() }))
    .filter(c => SINGLE_WORD.test(c.h) && c.h.length >= MIN_LENGTH)
  const confusable = confusableIndex(words)
  const bigrams = new Map<string, Set<string>>()
  const glossOf = (w: Word) => {
    let g = bigrams.get(w.id)
    if (g === undefined) { g = glossBigrams(w); bigrams.set(w.id, g) }
    return g
  }

  const pairs: LookalikePair[] = []
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const x = candidates[i]
      const y = candidates[j]
      const a = x.h
      const b = y.h
      if (a === b || Math.abs(a.length - b.length) > 2) continue
      const min = Math.min(a.length, b.length)
      const max = Math.max(a.length, b.length)

      let pre = 0
      while (pre < min && a[pre] === b[pre]) pre++
      let suf = 0
      while (suf < min - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
      // The frame decides most pairs before any distance is computed. One
      // edit leaves all but two letters framed (a swap touches two), and two
      // edits must frame two thirds to pass; a pair failing both cannot be
      // kept. Without this the full table ran for ~600,000 pairs and a round
      // took 1,150 ms to build in Node — several seconds on a phone.
      const framed = pre + suf
      const twoEditsFramed = min >= MIN_LENGTH_TWO_EDITS && framed * FRAME_DEN >= max * FRAME_NUM
      if (framed < max - 2 && !twoEditsFramed) continue

      const distance = osaDistance(a, b)
      if (distance > 2 || (distance === 2 && !twoEditsFramed)) continue

      // One is the other plus an ending: `haste`/`hasten`, `trivia`/`trivial`.
      if (a.startsWith(b) || b.startsWith(a)) continue
      if (isInflectionOf(a, b) || isInflectionOf(b, a)) continue
      if (NEGATION_PREFIXES.some(p => a === p + b || b === p + a)) continue
      if (derivedSiblings(x.w, y.w, a, b)) continue
      if (glossesOverlap(glossOf(x.w), glossOf(y.w))) continue
      // Near-synonyms are 辨析's (contrast.ts), and there a sentence decides — a
      // gloss beside a gloss cannot.
      if (confusable.get(x.w.id)?.has(y.w.id)) continue

      const [first, second] = x.w.id < y.w.id ? [x.w.id, y.w.id] : [y.w.id, x.w.id]
      pairs.push({ a: first, b: second, distance, frame: (pre + suf) / max })
    }
  }
  return pairs.sort((p, q) => p.a.localeCompare(q.a) || p.b.localeCompare(q.b))
}

/** id → every look-alike partner, closest first: fewer edits, then more of the word framed, then id. */
export function lookalikeIndex(pairs: LookalikePair[]): Map<string, string[]> {
  const near = new Map<string, LookalikePair[]>()
  const link = (id: string, p: LookalikePair) => {
    const list = near.get(id)
    if (list) list.push(p)
    else near.set(id, [p])
  }
  for (const p of pairs) {
    link(p.a, p)
    link(p.b, p)
  }
  const out = new Map<string, string[]>()
  for (const [id, list] of near) {
    const other = (p: LookalikePair) => (p.a === id ? p.b : p.a)
    out.set(id, list
      .sort((p, q) => p.distance - q.distance || q.frame - p.frame || other(p).localeCompare(other(q)))
      .map(other))
  }
  return out
}

/** Four options, as everywhere else a meaning is picked. At most three of them are traps. */
const OPTION_COUNT = 4

/**
 * One 形近 round: a headword, its meaning among four, with every look-alike
 * partner's meaning (up to three) among the wrong ones.
 *
 * **The prompt is one word, never the pair.** The confusion happens while
 * reading, one word at a time — `elude` on the page, `allude`'s meaning in the
 * head. Showing both would turn it into a matching puzzle solvable by
 * elimination. The pair is laid out side by side on the reveal instead.
 *
 * **`meanings[0]` on both sides**, not `pickMeaning`'s draw: the confusion is
 * between the two words' core senses, and a secondary sense would test
 * polysemy instead. The gloss rule checks every meaning, so no sense of the
 * answer can hide behind a partner's option.
 *
 * Both words learned, as in 辨析 and for its reason: telling apart two words
 * you have never met is not a skill. **Each pair at most once per round** —
 * after one side's reveal has printed both meanings, the other side is answered
 * from the screen a minute ago, not from memory. The other side comes next
 * round, because the recency list holds prompt ids.
 */
export function generateLookalikeQuiz(
  words: Word[],
  progress: Progress,
  today: string,
  count: number,
  rng: () => number = Math.random,
  recent: readonly string[] = [],
): QuizQuestion[] {
  const learned = (id: string) => {
    const e = progress.words[id]
    return e !== undefined && e.state !== 'new'
  }
  const partners = lookalikeIndex(buildLookalikePairs(words).filter(p => learned(p.a) && learned(p.b)))
  const askable = words.filter(w => partners.has(w.id))
  if (askable.length === 0) return []

  const byId = new Map(words.map(w => [w.id, w]))
  const confusable = confusableIndex(words)
  const pool = words.filter(w => learned(w.id))

  // Same recency contract as 辨析 (generateContrastQuiz): two thirds of the
  // pool, capped at pool−1, so a pool smaller than the window still fills.
  // A stable partition after the weighted draw, so a word you keep missing
  // still comes first among the ones not asked lately.
  const window = Math.max(0, Math.min(askable.length - 1, Math.floor((askable.length * 2) / 3)))
  const seen = new Set(recent.slice(0, window))
  const drawn = weightedShuffle(askable, w => difficultyWeight(w, progress, today), rng)
  const ordered = [...drawn.filter(w => !seen.has(w.id)), ...drawn.filter(w => seen.has(w.id))]

  const used = new Set<string>()
  const questions: QuizQuestion[] = []
  for (const w of ordered) {
    if (questions.length >= count) break
    const near = partners.get(w.id) ?? []
    if (used.has(w.id) || near.some(id => used.has(id))) continue
    const m = w.meanings[0]
    if (m === undefined) continue
    const answer = meaningLabel(m)

    const labels = new Set([answer])
    // Every option's gloss terms so far. The pair rule keeps each partner
    // apart from the prompt, not partners apart from each other.
    const taken = [glossBigrams(w)]
    const traps: { id: string; label: string }[] = []
    for (const id of near) {
      if (traps.length >= OPTION_COUNT - 1) break
      const partner = byId.get(id)
      const pm = partner?.meanings[0]
      if (partner === undefined || pm === undefined) continue
      const label = meaningLabel(pm)
      const gloss = glossBigrams(partner)
      if (labels.has(label) || taken.some(t => glossesOverlap(t, gloss))) continue
      labels.add(label)
      taken.push(gloss)
      traps.push({ id, label })
    }
    if (traps.length === 0) continue

    const fill = fillers(w, near, OPTION_COUNT - 1 - traps.length, labels, taken, pool, words, confusable, rng)
    if (fill === null) continue

    for (const id of [w.id, ...near]) used.add(id)
    questions.push({
      type: 'lookalike',
      wordId: w.id,
      prompt: w.headword,
      options: shuffle([answer, ...traps.map(t => t.label), ...fill], rng),
      answer,
      lookalikes: traps,
    })
  }
  return questions
}

/**
 * The options that are neither the answer nor a trap, learned words first.
 *
 * `pickDistractorLabels`' rules, plus one it does not need: no gloss term in
 * common with any option already on the card (`taken`, which grows as fillers
 * are picked). Against the answer, a filler sharing 暗指 with `allude` would be
 * a second right answer by a route the synonym graph never sees. Against a
 * trap, it is a giveaway: `preside` drew presage's 预示;预兆 as its trap and
 * another word's 预示,预兆 as a filler — found by playing — and two options
 * meaning one thing rule each other out, leaving a two-way guess.
 */
function fillers(
  w: Word,
  partners: string[],
  need: number,
  labels: Set<string>,
  taken: Set<string>[],
  pool: Word[],
  library: Word[],
  confusable: Map<string, Set<string>>,
  rng: () => number,
): string[] | null {
  const near = confusable.get(w.id)
  const excluded = new Set([w.id, ...partners])
  const picked: string[] = []
  const collect = (list: Word[]) => {
    for (const x of shuffle(list, rng)) {
      if (picked.length >= need) return
      if (excluded.has(x.id) || (near?.has(x.id) ?? false)) continue
      const m = x.meanings[0]
      if (m === undefined) continue
      const label = meaningLabel(m)
      if (labels.has(label)) continue
      const gloss = glossBigrams(x)
      if (taken.some(t => glossesOverlap(t, gloss))) continue
      labels.add(label)
      taken.push(gloss)
      picked.push(label)
    }
  }
  collect(pool)
  if (picked.length < need) collect(library)
  return picked.length < need ? null : picked
}

/**
 * The words a wrong pick marks missed.
 *
 * A partner's meaning marks **both** — the 辨析 rule (Quiz.tsx): the confusion
 * lives in the pair, and the word whose meaning was taken is as much a part of
 * it as the one asked. Any other wrong pick is a plain miss on the asked word;
 * it says nothing about the partner.
 */
export function lookalikeMissIds(q: QuizQuestion, chosen: string): string[] {
  if (chosen === q.answer) return []
  const trap = q.lookalikes?.find(t => t.label === chosen)
  return trap === undefined ? [q.wordId] : [q.wordId, trap.id]
}
