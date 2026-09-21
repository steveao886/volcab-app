import type { Word } from '../types'

/**
 * Library-internal opposites.
 *
 * `contrast.ts` builds its pair graph from synonyms and says so at length:
 * pairing on antonyms would be "opposites, not confusable", which is the
 * wrong question for 辨析. This file is that other question, kept separate
 * for exactly that reason — the two graphs must never be merged.
 *
 * The edge here is much narrower than contrast's: a pair exists only when
 * one word's `antonyms` array names the other's **headword**. Shared
 * antonyms are deliberately not an edge — two words listing `apathetic` as
 * their opposite are synonyms of each other, which contrast.ts already
 * covers.
 *
 * Re-measured 2026-09-21 over the 931-word library: 364 pairs across 394
 * words (242 adj., 75 n., 71 v., 6 adv.). Only 108 pairs are authored on both
 * sides; the other 256 name each other one-way. That asymmetry is authoring,
 * not meaning, so a one-sided pair counts and both directions are askable —
 * 728 questions. (At 599 words this read 94 pairs across 135 words: the graph
 * grew nearly four times as fast as the library, because every added word can
 * name any existing headword as its opposite.)
 *
 * **The pair graph is no longer the whole story.** Since 2026-08-19 the
 * quiz may also answer with a string naming a word *outside* the library —
 * 1705 of 2177 antonym strings do (2026-09-21; 1055 of 1172 when this was
 * written), and requiring both sides to be headwords was never a correctness
 * rule, only what `buildAntonymPairs` happened to produce.
 * `antonymAnswerIndex` below is that wider question; the pair graph stays
 * because 辨析-style reasoning about two library entries still needs it.
 */

const norm = (s: string) => s.trim().toLowerCase()

export interface AntonymPair {
  /** Word id, the alphabetically earlier one */
  a: string
  /** Word id, the alphabetically later one */
  b: string
}

export function buildAntonymPairs(words: Word[]): AntonymPair[] {
  const byHeadword = new Map(words.map(w => [norm(w.headword), w.id]))
  const seen = new Set<string>()
  const pairs: AntonymPair[] = []

  for (const w of words) {
    for (const raw of w.antonyms) {
      const k = norm(raw)
      // Blank entries must be blocked before the lookup, not after: an entry
      // written as [''] would otherwise resolve against any headword that
      // normalized to the empty string. Same trap contrast.ts guards.
      if (k === '') continue
      const other = byHeadword.get(k)
      // An antonym naming something outside the library is the common case
      // (1055 of 1172 antonym strings) and is simply not an edge *here*.
      // It is still a perfectly good answer — see antonymAnswerIndex.
      if (other === undefined || other === w.id) continue
      const [a, b] = w.id < other ? [w.id, other] : [other, w.id]
      // NUL as the separator, written as an escape rather than a raw byte, for
      // the reason contrast.ts gives: a literal 0x00 made git treat this whole
      // file as binary (no diff, no blame) from 2d0a1de until this line changed.
      const key = `${a}\u0000${b}`
      if (seen.has(key)) continue
      seen.add(key)
      pairs.push({ a, b })
    }
  }

  return pairs
}

/**
 * id → every library word that is an opposite of it, symmetric.
 *
 * Symmetric even where the authoring is one-sided, and a *set* rather than
 * a single id, because both properties are load-bearing for the quiz:
 * 38 of the 135 paired words carry more than one opposite (`antagonize`
 * and `agreeable` have four each). Offering one of a word's other
 * opposites as a distractor ships a question with two correct answers —
 * the failure `sharedSynonyms` exists to prevent, arriving by a new route.
 *
 * A word with no library opposite is absent from the map rather than
 * present with an empty set, so `has()` answers "can this word be asked".
 */
export function antonymIndex(words: Word[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()
  const add = (from: string, to: string) => {
    const set = index.get(from)
    if (set) set.add(to)
    else index.set(from, new Set([to]))
  }
  for (const { a, b } of buildAntonymPairs(words)) {
    add(a, b)
    add(b, a)
  }
  return index
}

/**
 * id → every **string** that is an opposite of it, library word or not.
 *
 * The wider question `antonymIndex` cannot answer. 1055 of the library's
 * 1172 antonym strings name a word that has no entry here, and those
 * strings are already trusted enough to render on the word card and to
 * prompt a `synonymHint` question. The only thing they were never allowed
 * to be is an *answer*, and that was an accident of what
 * `buildAntonymPairs` produced rather than a rule anyone chose.
 *
 * Keyed by normalized form with the authored spelling as the value,
 * because callers need both: comparison has to be case- and
 * whitespace-insensitive the way `contrast.ts` normalizes, but an option
 * on screen has to read the way it was written.
 *
 * **Symmetric, like `antonymIndex`, and for the same reason** — 71 of the
 * 94 library pairs are authored on one side only, so a word's opposites
 * include every library headword naming it as well as everything its own
 * `antonyms` names. Dropping the backfill would silently make one
 * direction of those pairs unaskable.
 *
 * This index serves **two** jobs in the quiz and they must not be
 * confused: it supplies the answer candidates, and it supplies the
 * exclusion set that keeps a second correct answer out of the options.
 * A filter that narrows the first must never narrow the second.
 */
export function antonymAnswerIndex(words: Word[]): Map<string, Map<string, string>> {
  const index = new Map<string, Map<string, string>>()
  const add = (id: string, raw: string) => {
    const k = norm(raw)
    // Same empty-entry trap `buildAntonymPairs` guards above: a blank would
    // key every word's exclusion set to the empty string, which every
    // normalized lookup for a blank distractor would then hit.
    if (k === '') return
    const set = index.get(id)
    if (set) { if (!set.has(k)) set.set(k, raw.trim()) }
    else index.set(id, new Map([[k, raw.trim()]]))
  }

  const byHeadword = new Map(words.map(w => [norm(w.headword), w.id]))
  for (const w of words) {
    for (const raw of w.antonyms) {
      add(w.id, raw)
      // The backfill. A library word naming w is an opposite of w even
      // when w's own array never says so.
      const other = byHeadword.get(norm(raw))
      if (other !== undefined && other !== w.id) add(other, w.headword)
    }
  }
  return index
}
