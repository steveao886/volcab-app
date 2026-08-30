import { difficultyWeight, shuffle, weightedShuffle } from './quiz'
import type { SenseGroup } from './senseGroup'
import type { RecallSentence } from './recallSentence'
import type { Progress, RecallRating, Word } from '../types'

/**
 * 组句 — assemble a sentence from meaning chunks, with the target word
 * withheld.
 *
 * **Why chunks and not words.** Measured over the 1215 sentences that carry a
 * Chinese rendering, the English runs 19 tokens at the median (p90 22, and
 * only 5 of 1215 under 12). A Duolingo-style word bank runs 4–8 tokens, so it
 * does not fit the 375px design width, and typing 19 words on a phone is the
 * friction that retired 猜词. That same length is right one level up: 19
 * tokens over 5 chunks is ~4 tokens a chunk, one or two chunks to a row.
 *
 * **Why the boundaries are authored.** A splitter cutting only at punctuation
 * and the coordinators/subordinators — never at bare prepositions, which is
 * where `over a` / `single Slack message` comes from — lands 1.0% of the 1215
 * in the 5–6 chunk range, at median block length 8 tokens and p90 13.
 * Reaching 5 chunks means cutting inside a clause, and a heuristic that does
 * that is the 90%-correct derivation CLAUDE.md forbids.
 *
 * **Why the word is withheld.** Ordering alone tests no vocabulary: English
 * word order is rigid enough that five chunks usually admit one or two
 * grammatical arrangements, and the target word would sit in a chunk without
 * ever passing through the learner's head. Withholding it leaves typing or
 * options, and options are 回想's — four visible choices turn production back
 * into recognition.
 *
 * See docs/superpowers/specs/2026-08-30-sentence-compose-design.md.
 */

/**
 * Which file the English lives in.
 *
 * - `ex` — `words.get(id).examples[i]`, with the Chinese coming from the
 *   matching `RecallSentence`.
 * - `sg` — `groups[i].en`, with the Chinese coming from the same group.
 */
export type ChunkSource = 'ex' | 'sg'

export interface ChunkAnnotation {
  src: ChunkSource
  /**
   * The word being produced. For `sg` this is the group's `order[0]` — the
   * other members are the ranked alternatives, so blanking and demanding one
   * of them would be wrong. Stored rather than looked up so eligibility can
   * be filtered without resolving the group.
   */
  id: string
  /** `ex`: index into the word's `examples`. `sg`: index into `groups`. */
  i: number
  /**
   * Token indices where a new chunk starts, over `en.split(/\s+/)`. Three
   * cuts make four chunks.
   *
   * **Indices, not chunk text.** The English already exists in exactly one
   * place, and a copy stored beside the annotation is a copy that can drift —
   * the same call `RecallQuestion.en` makes by reading straight off the word
   * entry. It is also ~30 bytes a sentence instead of ~150.
   */
  cuts: number[]
  /** Token index of the word to withhold. */
  blank: number
  /**
   * `tokens[blank]`, normalised. Both the answer to type **and a drift
   * checksum**: words are editable in-app and the repo copy of `words.json`
   * has diverged from the live library before (CLAUDE.md, `f53adb9`). If the
   * token at `blank` no longer normalises to this, the sentence is skipped
   * entirely rather than served with its chunks cut mid-phrase.
   */
  answer: string
}

export interface SentenceChunksFile { version: 1; chunks: ChunkAnnotation[] }

/**
 * The floor on chunk count, per pool.
 *
 * 5 for `ex`; 4 for `sg`, whose sentences run 12 tokens at the median. The
 * floor was 5 everywhere while ordering was the only test — with a blank and
 * a distractor, four chunks is P(5,4) = 120 arrangements *plus* a word to
 * produce. Relaxing it for `sg` is what takes coverage from 243 words to 501.
 */
const MIN_CHUNKS: Record<ChunkSource, number> = { ex: 5, sg: 4 }

/** At most this many questions about one word in a session — see generateComposeSession. */
const MAX_PER_WORD = 3

export const annotationKey = (a: ChunkAnnotation): string => `${a.src}:${a.id}:${a.i}`

/**
 * Lowercase, and drop anything that is not a letter or digit from either end.
 * Internal hyphens and apostrophes survive, so `remote-work` and `didn't`
 * compare as themselves.
 */
export function normalizeToken(s: string): string {
  return s.trim().toLowerCase().replace(/^[^a-z0-9]+/, '').replace(/[^a-z0-9]+$/, '')
}

const normalizeChunk = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** Sentence-final punctuation, plus any closing quote or bracket after it. */
const TAIL = /[.!?]["'’”)\]]*$/

export interface ResolvedSentence {
  a: ChunkAnnotation
  /** The English exactly as authored, revealed after the answer is submitted. */
  en: string
  /** Display chunks in reference order: opener lowercased, blank rendered, tail removed. */
  chunks: string[]
  /**
   * The same chunks with the word left in — what a distractor is drawn from.
   *
   * **Display-normalised, not raw.** Drawing from the untouched sentence
   * shipped a distractor that announced itself: every real chunk has had the
   * sentence-final period lifted out and the opening capital dropped, so a
   * candidate carrying either was identifiable without reading it. Caught in
   * the browser on the first question ever rendered — `a rival skincare
   * brand.` sitting among five chunks that all ended bare.
   */
  plain: string[]
  /** Which chunk carries the blank. */
  blankChunk: number
  /** Sentence-final punctuation, shown after the last slot rather than inside a chunk. */
  tail: string
}

const BLANK = ' ______ '.trim()

/**
 * Replace a token's alphabetic core with the blank, keeping punctuation that
 * rides along with it — `abrogated,` becomes `______,`.
 */
const blankToken = (t: string): string => {
  const lead = t.match(/^[^A-Za-z0-9]*/)?.[0] ?? ''
  const trail = t.match(/[^A-Za-z0-9]*$/)?.[0] ?? ''
  return `${lead}${BLANK}${trail}`
}

/**
 * The annotation as something renderable, or `null` when anything about it no
 * longer holds.
 *
 * Every rejection is a silent skip, deliberately — the read side stays
 * lenient while `validate-sentence-chunks.ts` is strict, and a question with
 * chunks cut mid-phrase is worse than one fewer question.
 *
 * **The sentence-initial capital is dropped unconditionally.** It marks which
 * chunk goes first, which is a position given away for free. Measured over
 * the 1636 bundled sentences, 97 open with a token never seen lowercase
 * mid-corpus, and of those only about 7 are genuine proper nouns (`Bitcoin`,
 * `Tokyo's`, `Chernobyl`, `Parliament`, …) — 0.4%, where the cost is one
 * cosmetically lowercased word, not a wrong answer. Keeping the capital for
 * the other 90 would leak the first position on 5.9% of questions, which is
 * the worse trade.
 */
export function resolveSentence(
  a: ChunkAnnotation,
  words: Map<string, Word>,
  groups: SenseGroup[],
): ResolvedSentence | null {
  let en: string | undefined
  if (a.src === 'ex') {
    en = words.get(a.id)?.examples[a.i]
  } else {
    const g = groups[a.i]
    // The group must still be the one this was authored against: groups are
    // reordered and rewritten by content batches, and a shifted index would
    // silently blank the wrong word.
    if (g !== undefined && g.order[0] === a.id) en = g.en
  }
  if (en === undefined) return null

  const tokens = en.trim().split(/\s+/)
  if (tokens.length < 2) return null

  const cuts = a.cuts
  if (cuts.length + 1 < MIN_CHUNKS[a.src]) return null
  if (cuts[0] === undefined || cuts[0] < 1) return null
  for (let k = 1; k < cuts.length; k++) if (cuts[k] <= cuts[k - 1]) return null
  if (cuts[cuts.length - 1] >= tokens.length) return null

  if (a.blank < 0 || a.blank >= tokens.length) return null
  if (normalizeToken(tokens[a.blank]) !== a.answer) return null

  const shown = [...tokens]
  // Order matters only in that both edits can land on the same token: a
  // one-token sentence-initial blank gets lowercased (a no-op) and blanked.
  const first = shown[0]
  if (/^[A-Z][a-z]/.test(first)) shown[0] = first[0].toLowerCase() + first.slice(1)
  const lastIdx = shown.length - 1
  const tail = shown[lastIdx].match(TAIL)?.[0] ?? ''
  if (tail !== '') shown[lastIdx] = shown[lastIdx].slice(0, -tail.length)

  const bounds = [0, ...cuts, tokens.length]
  const plain: string[] = []
  const chunks: string[] = []
  let blankChunk = -1
  for (let k = 0; k + 1 < bounds.length; k++) {
    const from = bounds[k]
    const to = bounds[k + 1]
    plain.push(shown.slice(from, to).join(' '))
    const piece = shown.slice(from, to)
    if (a.blank >= from && a.blank < to) {
      blankChunk = k
      piece[a.blank - from] = blankToken(piece[a.blank - from])
    }
    chunks.push(piece.join(' '))
  }
  // A chunk that came out empty means the tail stripping ate a whole token —
  // the annotation cut after the final word. Skip rather than render a gap.
  if (chunks.some(c => c.trim() === '')) return null
  if (blankChunk === -1) return null

  return { a, en, chunks, plain, blankChunk, tail }
}

const isLearned = (id: string, progress: Progress): boolean => {
  const e = progress.words[id]
  return e !== undefined && e.state !== 'new'
}

/**
 * The annotations that can be asked right now: they resolve, and the word
 * being produced has been learned.
 *
 * Only the answer word has to be learned — the surrounding chunks are
 * scenery. Same rule, same reasoning, as `usableSentences`.
 */
export function usableChunks(
  annotations: ChunkAnnotation[],
  words: Map<string, Word>,
  groups: SenseGroup[],
  progress: Progress,
): ResolvedSentence[] {
  const out: ResolvedSentence[] = []
  for (const a of annotations) {
    if (!isLearned(a.id, progress)) continue
    const r = resolveSentence(a, words, groups)
    if (r !== null) out.push(r)
  }
  return out
}

const median = (ns: number[]): number => {
  const s = [...ns].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}

/**
 * One extra chunk for the pool, or `null` when nothing clean is available.
 *
 * Drawn from **another chunked sentence of the same word** where one exists,
 * because same-word sentences share register and subject matter — a chunk
 * lifted from a different word is usually discardable on sight. A cross-word
 * fallback is still offered: an obvious distractor means the question did not
 * get harder, not that it became ambiguous, and failing toward easy is
 * acceptable here while failing toward ambiguous is not.
 *
 * **Confusable-word chunks are not an option and never will be.**
 * `recallSentence.ts` documents why for its own distractors: these sentences
 * were written to show a word in use, not to make one of two near-synonyms
 * clearly better, so a near-synonym chunk produces "either one fits" and
 * marks a defensible answer wrong. Discrimination belongs to 辨析.
 */
export function pickDistractor(
  target: ResolvedSentence,
  pool: ResolvedSentence[],
  rng: () => number,
): string | null {
  const own = new Set(target.plain.map(normalizeChunk))
  const want = median(target.plain.map(c => c.split(/\s+/).length))
  const key = annotationKey(target.a)
  // Four characters is enough to catch the inflections that matter
  // (abrogate/abrogated/abrogating) and short enough not to need a stemmer.
  // A false hit costs a candidate, never a wrong question.
  const stem = target.a.answer.slice(0, Math.min(4, target.a.answer.length))

  const sameWord = pool.filter(r => r.a.id === target.a.id && annotationKey(r.a) !== key)
  const other = pool.filter(r => r.a.id !== target.a.id)

  for (const group of [sameWord, other]) {
    const candidates: string[] = []
    for (const r of shuffle(group, rng)) {
      for (let k = 0; k < r.plain.length; k++) {
        // The chunk holding that sentence's own blank contains this word by
        // construction — using it would print the answer on the screen.
        if (r.a.id === target.a.id && k === r.blankChunk) continue
        const text = r.plain[k]
        const norm = normalizeChunk(text)
        // Not just "identical to a real chunk" but "nested either way".
        // `in rents` offered beside the real `the rise in rents` reads as an
        // ambiguous question rather than a hard one — the learner is being
        // asked to guess which slice was meant, which is not what the mode
        // tests. Seen in the browser on inexorable, whose two sentences are
        // near-paraphrases.
        if ([...own].some(c => c === norm || c.includes(norm) || norm.includes(c))) continue
        const toks = text.split(/\s+/)
        if (Math.abs(toks.length - want) > 2) continue
        if (toks.some(t => normalizeToken(t).startsWith(stem))) continue
        candidates.push(text)
      }
      if (candidates.length > 0) break
    }
    if (candidates.length > 0) return shuffle(candidates, rng)[0]
  }
  return null
}

/**
 * The Chinese side of a question, and the chunk of it under an emphasis mark.
 *
 * A target that is blank, or that does not locate exactly once, is dropped
 * and the plain sentence shown — the same call `senseGroup.ts` and
 * `recallSentence.ts` both make. A highlight on the wrong place, or on two
 * places at once, is worse than none; the question is still answerable
 * without it.
 */
export interface ComposePrompt { zh: string; target?: string }

const usableTarget = (zh: string, target: string | undefined): string | undefined => {
  const t = target?.trim()
  if (t === undefined || t === '') return undefined
  return zh.split(t).length - 1 === 1 ? t : undefined
}

export function promptFor(
  a: ChunkAnnotation,
  groups: SenseGroup[],
  sentences: Map<string, RecallSentence>,
): ComposePrompt | null {
  if (a.src === 'sg') {
    const g = groups[a.i]
    if (g === undefined) return null
    return { zh: g.zh, target: usableTarget(g.zh, g.target) }
  }
  const s = sentences.get(`${a.id}:${a.i}`)
  if (s === undefined) return null
  return { zh: s.zh, target: usableTarget(s.zh, s.target) }
}

export interface ComposeQuestion {
  /** The word being produced. */
  id: string
  /** The Chinese scenario. Doubles as the recency key. */
  prompt: string
  /** The chunk of prompt under an emphasis mark, when it locates cleanly. */
  target?: string
  /** The chunks in reference order, as displayed. The answer key. */
  chunks: string[]
  /** Those chunks plus at most one distractor, shuffled. */
  pool: string[]
  /** Sentence-final punctuation, rendered after the last slot. */
  tail: string
  /** The word to type. */
  answer: string
  /** The English as authored, revealed once the answer is in. */
  en: string
  /** The word's headword and Chinese gloss, for the reveal. */
  headword: string
  gloss?: string
}

export function buildComposeQuestion(
  r: ResolvedSentence,
  prompt: ComposePrompt,
  word: Word,
  pool: ResolvedSentence[],
  rng: () => number,
): ComposeQuestion {
  const distractor = pickDistractor(r, pool, rng)
  const options = distractor === null ? [...r.chunks] : [...r.chunks, distractor]
  return {
    id: r.a.id,
    prompt: prompt.zh,
    target: prompt.target,
    chunks: r.chunks,
    pool: shuffle(options, rng),
    tail: r.tail,
    answer: r.a.answer,
    en: r.en,
    headword: word.headword,
    gloss: word.meanings[0]?.zh,
  }
}

/**
 * The manual 回想 rating, read at the **hard end only**.
 *
 * `RecallRating`'s own comment states the rule this follows: production and
 * recognition come apart, so a rating collected in one direction must not be
 * silently spent in the other. 组句 is the same direction as 回想 — Chinese
 * in, English out — which is what makes 要多考 transferable at full strength.
 *
 * 太简单 is **not** transferable, and that asymmetry is the point. It means
 * "I can retrieve this word", and 组句 asks for strictly more: the right
 * inflection, in the right collocation, inside a frame you have to build. The
 * 0.05 that 回想 spends on an easy word would all but remove it from a harder
 * task the user never said anything about. It weighs 1 here — the same as
 * never having been rated.
 */
export const composeRatingWeight = (r: RecallRating | undefined): number =>
  r?.level === 'hard' ? 6 : 1

/**
 * One round of 组句.
 *
 * **Difficulty is spent here, not in the content.** The user's ask was
 * "普通词1个，难词3题", and the allocation cannot live in the annotations:
 * difficulty sits in `progress.json`, which is synced and different every
 * day, while annotations are bundled and authored once. So every sentence is
 * annotated the same, and the weighted draw decides how many slots a word
 * takes — `difficultyWeight` (the scheduler's own estimate, which already
 * picks up a recent miss from any surface) times the hard end of the manual
 * rating.
 *
 * `MAX_PER_WORD` is what stops that from running away: a heavy word with
 * several annotated sentences would otherwise be able to take the whole
 * round. Unlike 回想, which caps at one per word, repeats are *wanted* here —
 * but only up to three, and only from distinct sentences, because the second
 * time through the same sentence you are remembering the sentence rather than
 * the word.
 *
 * `seen` demotes rather than excludes, so an exhausted pool degrades to
 * repeating recent prompts instead of returning an empty round.
 */
export function generateComposeSession(
  annotations: ChunkAnnotation[],
  words: Map<string, Word>,
  groups: SenseGroup[],
  sentences: RecallSentence[],
  progress: Progress,
  today: string,
  seen: ReadonlySet<string>,
  count: number,
  rng: () => number,
): ComposeQuestion[] {
  const usable = usableChunks(annotations, words, groups, progress)
  const byKey = new Map(sentences.map(s => [`${s.id}:${s.i}`, s]))

  const weight = (r: ResolvedSentence) => {
    const w = words.get(r.a.id)
    if (w === undefined) return 1
    return difficultyWeight(w, progress, today) * composeRatingWeight(progress.words[r.a.id]?.recallRating)
  }
  const drawn = weightedShuffle(usable, weight, rng)
  const ordered = [
    ...drawn.filter(r => !seen.has(r.a.src === 'sg' ? (groups[r.a.i]?.zh ?? '') : (byKey.get(`${r.a.id}:${r.a.i}`)?.zh ?? ''))),
    ...drawn.filter(r => seen.has(r.a.src === 'sg' ? (groups[r.a.i]?.zh ?? '') : (byKey.get(`${r.a.id}:${r.a.i}`)?.zh ?? ''))),
  ]

  const out: ComposeQuestion[] = []
  const perWord = new Map<string, number>()
  for (const r of ordered) {
    if (out.length >= count) break
    const taken = perWord.get(r.a.id) ?? 0
    if (taken >= MAX_PER_WORD) continue
    const prompt = promptFor(r.a, groups, byKey)
    if (prompt === null) continue
    const word = words.get(r.a.id)
    if (word === undefined) continue
    out.push(buildComposeQuestion(r, prompt, word, usable, rng))
    perWord.set(r.a.id, taken + 1)
  }
  return out
}

export type OrderVerdict = 'ok' | 'wrong'

/**
 * How the typed word came out.
 *
 * Three values rather than two because the three failures ask for different
 * remedies — the same reasoning as 回想's four miss kinds. `form` means the
 * word *is* in productive vocabulary and grammar is what slipped; `wrong` is
 * the finding this mode exists to produce, and the only one that reaches the
 * scheduler.
 */
export type WordVerdict = 'ok' | 'form' | 'wrong'

export function gradeOrder(placed: readonly string[], reference: readonly string[]): OrderVerdict {
  if (placed.length !== reference.length) return 'wrong'
  return placed.every((p, k) => normalizeChunk(p) === normalizeChunk(reference[k])) ? 'ok' : 'wrong'
}

/**
 * `form` is decided from authored data first — the headword and
 * `relatedForms`, both hand-written — and only then from a prefix rule, for
 * the inflections nobody wrote down (`abrogates` against `abrogated`).
 *
 * The prefix is `answer.length - 3`, floored at 4: `abrogated` needs six
 * shared characters, which `abrogates` clears and `abolished` does not. This
 * is a derivation, and it is allowed here for one reason — it only decides
 * *which kind of miss to report*, and its failure direction is to call a miss
 * `form` rather than `wrong`, i.e. to decline a demotion. That is the same
 * direction every other guard in this app fails.
 */
export function gradeWord(input: string, word: Word, answer: string): WordVerdict {
  const typed = normalizeToken(input)
  if (typed === '') return 'wrong'
  if (typed === answer) return 'ok'
  if (typed === normalizeToken(word.headword)) return 'form'
  if (word.relatedForms.some(f => normalizeToken(f.form) === typed)) return 'form'
  const n = Math.max(4, answer.length - 3)
  return typed.length >= n && answer.length >= n && typed.slice(0, n) === answer.slice(0, n)
    ? 'form'
    : 'wrong'
}

/**
 * Which ids the session reports as missed — and therefore which get
 * `missedAt` stamped and their interval halved.
 *
 * **A wrong order is not in here.** CLAUDE.md opens exactly one door from
 * practice into the scheduler, and a syntax slip says nothing about whether
 * the word is remembered; pushing it through `demoteWord` would move a word's
 * interval on a word-independent signal, which is the family of drift
 * `71fba29` removed. `form` is excluded for the same kind of reason — the
 * word came out, only inflected wrong.
 */
export function missedIds(results: readonly { id: string; word: WordVerdict }[]): string[] {
  return [...new Set(results.filter(r => r.word === 'wrong').map(r => r.id))]
}
