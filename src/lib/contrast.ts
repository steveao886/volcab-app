import type { Word } from '../types'

/**
 * Confusable-word pairings.
 *
 * The data source is already there for free: `quiz.ts`'s `sharedSynonyms()` has always
 * computed "synonyms shared by more than one entry", used to **exclude** them — a
 * four-choice question with two right answers means the user decides the quiz is broken.
 * Flip that around and it's exactly a map of confusable words. Measured: 476 words pair
 * up into 317 pairs, covering 293 words.
 *
 * **Only synonyms, never antonyms.** If one word treats X as a synonym and another treats
 * X as an antonym, that means the two words are opposites, not confusable — pairing them
 * up as a two-choice question tests antonyms, not discrimination.
 */

export interface ContrastPair {
  /** Word id, the alphabetically earlier one */
  a: string
  /** Word id, the alphabetically later one */
  b: string
  /** Shared synonyms (lowercased, sorted); empty array when paired solely via direct */
  shared: string[]
  /** One side lists the other's **headword** in its own synonyms */
  direct: boolean
  /** See the comment on scorePair below */
  score: number
}

/**
 * id → every word it is confusable with.
 *
 * The pair list turned into a lookup, because two callers now need to ask
 * "is X confusable with Y" per question rather than walk the list: the
 * antonym question keeps a confusable of its answer out of the options, and
 * the sentence-sourced recall question does the same. Building it once per
 * session is the same O(n²) argument `sharedSynonyms` is hoisted for.
 */
export function confusableIndex(words: Word[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()
  const link = (from: string, to: string) => {
    const set = index.get(from)
    if (set) set.add(to)
    else index.set(from, new Set([to]))
  }
  for (const p of buildContrastPairs(words)) {
    link(p.a, p.b)
    link(p.b, p.a)
  }
  return index
}

const norm = (s: string) => s.trim().toLowerCase()

/**
 * Closeness score. **Must be scored, not a blanket cutoff** — noise is real: `promulgate`
 * and `metastasize` share `disseminate`, but one means enacting a law and the other means
 * cancer cells spreading, so pairing them up is a free point.
 *
 * - +1 for each additional shared synonym: more overlap means harder to tell apart
 * - +2 for being direct synonyms of each other: a dictionary-level direct judgment, stronger
 *   than indirect overlap
 * - +1 for the primary meanings sharing a part of speech: two words with different parts of
 *   speech never actually compete within a sentence
 */
const scorePair = (sharedCount: number, direct: boolean, samePos: boolean): number =>
  sharedCount + (direct ? 2 : 0) + (samePos ? 1 : 0)

interface Acc {
  a: string
  b: string
  shared: Set<string>
  direct: boolean
}

export function buildContrastPairs(words: Word[]): ContrastPair[] {
  // Synonym → the ids of words that have it. **An inverted index instead of a 476² nested
  // loop**: pairing only happens within each bucket, cutting the actual number of
  // comparisons from a hundred thousand down to a few hundred. A test asserts this is
  // equivalent to the naive nested-loop result — the index is a performance optimization
  // and shouldn't change the semantics.
  const bySyn = new Map<string, string[]>()
  for (const w of words) {
    // Dedupe within a single word first: an entry that writes ['dup', 'DUP'] shouldn't
    // score an extra point against some other word
    for (const s of new Set(w.synonyms.map(norm))) {
      // Empty strings must be blocked, or every word with a blank entry would pair up
      // with every other one via "sharing an empty string"
      if (s === '') continue
      const list = bySyn.get(s)
      if (list) list.push(w.id)
      else bySyn.set(s, [w.id])
    }
  }

  const acc = new Map<string, Acc>()
  const touch = (x: string, y: string): Acc => {
    const [a, b] = x < y ? [x, y] : [y, x]
    // NUL as the separator, written as an escape rather than a raw byte: it is the one
    // character a word id can never contain, so ("ab","c") and ("a","bc") cannot collide
    // on the same key. Embedding the byte literally makes git treat this whole file as
    // binary -- no diff, no blame -- and leaves a reader seeing what looks like an
    // obviously-colliding `${a}${b}`.
    const k = `${a}\u0000${b}`
    let e = acc.get(k)
    if (e === undefined) {
      e = { a, b, shared: new Set(), direct: false }
      acc.set(k, e)
    }
    return e
  }

  for (const [s, ids] of bySyn) {
    if (ids.length < 2) continue
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) touch(ids[i], ids[j]).shared.add(s)
    }
  }

  // Direct mutual synonymy: one word writes the other's headword into its synonyms. The
  // inverted index can't catch this — the word being listed never writes itself into its
  // own synonyms (the validation script explicitly forbids that).
  const byHeadword = new Map(words.map(w => [norm(w.headword), w.id]))
  for (const w of words) {
    for (const s of w.synonyms) {
      const other = byHeadword.get(norm(s))
      // other === w.id is dirty data (an entry that listed itself as its own synonym).
      // The validation script blocks this, but the read side shouldn't produce an
      // a === b self-comparison question just because of one bad record.
      if (other !== undefined && other !== w.id) touch(w.id, other).direct = true
    }
  }

  const posOf = new Map(words.map(w => [w.id, w.meanings[0]?.pos ?? '']))

  return [...acc.values()]
    .map((e): ContrastPair => {
      const pa = posOf.get(e.a) ?? ''
      const samePos = pa !== '' && pa === posOf.get(e.b)
      return {
        a: e.a,
        b: e.b,
        shared: [...e.shared].sort(),
        direct: e.direct,
        score: scorePair(e.shared.size, e.direct, samePos),
      }
    })
    // Tie-break by id alphabetical order: a Map's insertion order depends on the word
    // list's order, and without a stable sort the same word list could produce a
    // different candidate pool across two runs — question generation needs to be
    // reproducible.
    .sort((x, y) => y.score - x.score || x.a.localeCompare(y.a) || x.b.localeCompare(y.b))
}
