import type { ProgressEntry, Word } from '../types'

/**
 * What "these two words are confusable" means, and the greedy pass that
 * keeps confusable words apart.
 *
 * Extracted from `freshOrder.ts` when the review schedule needed the same
 * two things (`2026-09-09-related-word-schedule-spacing-design.md`). The
 * intake side and the review side agree on the rules below and disagree on
 * one more: `freshOrder` also treats words within 3 positions of each other
 * in `words.json` as related, because its pool *is* a capture batch and
 * neighbours there really were tapped one after the other.
 *
 * **That third rule does not generalise to the review population.** Over
 * the 697 scheduled words it flags 80 same-day pairs, of which 64 are
 * capture-adjacency only — `angular | canonicalization`, `petulant |
 * rapturous`, `rhetoric | zenith`. So it stays in `freshOrder`, and callers
 * that want the narrow rule use `isRelated` here.
 */

/** Longest common prefix at which two ids count as the same word family, and how much may hang off the end of it. */
export const STEM_MIN = 5
export const STEM_MAX_TAIL = 4

/**
 * Whether two ids are built on the same stem — resent / resentful /
 * resentment, renown / renowned, deceive / deceit, advocate / advocacy.
 *
 * Fires on 75 pairs across the 717-word library, of which about 5 are false
 * positives (impasse / impassive, intrinsic / intrigue, interlude /
 * intercede, underhand / undermine). **Loose on purpose**: the cost of a
 * false positive is that two unrelated words end up a few queue positions
 * or one day apart, which costs nothing. This is the opposite of the
 * `etymology` rule, where a wrong guess plants a false memory anchor, and
 * the two must not be reasoned about the same way.
 */
export function sharesStem(a: string, b: string): boolean {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n >= STEM_MIN && a.length - n <= STEM_MAX_TAIL && b.length - n <= STEM_MAX_TAIL
}

/**
 * Symmetric synonym / antonym / related-form links **within the pool**.
 *
 * This is the rule that reaches across capture sessions, where the array
 * distance says nothing: a word added in July and its synonym added in
 * August sit hundreds of entries apart. Over the repo copy the library
 * carries 509 in-library synonym pointers, 202 antonym and 130 related-form,
 * with 413 of 717 words holding at least one.
 *
 * Built from the pool rather than the whole library because only relations
 * between two words being ordered can affect the ordering.
 */
export function declaredLinks(pool: readonly Word[]): Map<string, Set<string>> {
  const links = new Map<string, Set<string>>(pool.map(w => [w.id, new Set<string>()]))
  for (const w of pool) {
    for (const raw of [...w.synonyms, ...w.antonyms, ...w.relatedForms.map(r => r.form)]) {
      const id = raw.toLowerCase()
      const target = links.get(id)
      if (id === w.id || target === undefined) continue
      links.get(w.id)!.add(id)
      target.add(w.id)
    }
  }
  return links
}

/** Declared link or shared stem — the rule the review schedule uses, without `freshOrder`'s capture-order term. */
export function isRelated(a: string, b: string, links: ReadonlyMap<string, ReadonlySet<string>>): boolean {
  return links.get(a)?.has(b) === true || sharesStem(a, b)
}

/**
 * How far ahead the spacing pass may reach for a word that fits.
 *
 * Bounds the work, and bounds the damage: a word can jump ahead of at most
 * 20 better-scoring words, never the whole tail. Measured over the live
 * library, the largest usageScore actually crossed to defer a word is 1
 * point — on the new-word pool (intake spec) and on the next 30 review
 * sessions (this one) alike.
 */
export const LOOKAHEAD = 20

/**
 * How far apart the review session keeps two related words.
 *
 * Measured over the next 30 simulated sessions on the live schedule,
 * counting related pairs landing within 5 positions of each other:
 *
 * | gap | sessions with a close pair | pairs |
 * |---|---|---|
 * | 0 (before) | 6 | 7 |
 * | 3 | 6 | 7 |
 * | **5** | **2** | **2** |
 * | 8 | 2 | 2 |
 * | 10 | 2 | 2 |
 *
 * 5 is the smallest gap that helps, and 8 and 10 buy nothing further. The
 * two that survive are sessions too small to separate anything.
 */
export const SESSION_SPACING_GAP = 5

/**
 * Reorders `sorted` so that no item sits within `gap` positions of one it is
 * related to, disturbing the given order as little as it can.
 *
 * Greedy and single-pass: at each step take the first candidate within
 * `LOOKAHEAD` that is unrelated to the last `gap` picks.
 *
 * **Fails open.** When nothing in reach fits, it takes the head anyway. The
 * pass must never drop an item, never return fewer than asked and never
 * loop — a queue that silently shrinks is a far worse bug than two synonyms
 * landing together.
 *
 * `limit` stops the walk early. The pass is sequential, so a shortened run
 * is a **prefix** of the full one — which is what lets the new-word queue
 * order five words instead of the whole unlearned backlog on every Today
 * render. Left at its default the result is a permutation of the input.
 */
export function spaceApart<T>(
  sorted: readonly T[],
  related: (a: T, b: T) => boolean,
  gap: number,
  limit: number = sorted.length,
): T[] {
  const take = Math.min(Math.max(limit, 0), sorted.length)
  if (gap <= 0) return sorted.slice(0, take)
  const rest = [...sorted]
  const out: T[] = []
  while (out.length < take) {
    const recent = out.slice(-gap)
    let pick = 0
    const ceiling = Math.min(LOOKAHEAD, rest.length)
    for (let i = 0; i < ceiling; i++) {
      if (!recent.some(w => related(w, rest[i]))) { pick = i; break }
    }
    out.push(rest.splice(pick, 1)[0])
  }
  return out
}

/**
 * "Is a word related to `wordId` already due on this date?" — the predicate
 * `gradeWord`'s forward nudge consults.
 *
 * Built here rather than in `srs.ts` on purpose: the scheduler takes one
 * entry and a grade and knows nothing about the word list or about
 * `Progress`, and this keeps it that way. Passing a closure also means the
 * nudge is *off* wherever it is not supplied, which is what lets every
 * pre-existing scheduler test go on asserting exact dates.
 *
 * The word being graded is excluded — its own current due date is the one
 * it is moving away from, not a collision.
 */
export function relatedDueGuard(
  wordId: string,
  words: readonly Word[],
  progressWords: Readonly<Record<string, ProgressEntry>>,
): (due: string) => boolean {
  const links = declaredLinks(words)
  const taken = new Set<string>()
  for (const w of words) {
    if (w.id === wordId) continue
    const e = progressWords[w.id]
    // Unlearned words have no date to collide with, and a word in the
    // learning steps is due today whatever else happens — neither is a
    // reason to move a review date.
    if (e === undefined || e.state !== 'review') continue
    if (isRelated(wordId, w.id, links)) taken.add(e.due)
  }
  return d => taken.has(d)
}
