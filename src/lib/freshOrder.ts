import { declaredLinks, isRelated, spaceApart } from './related'
import type { Word } from '../types'

/** Encounter likelihood, defaulting to 0 — the same rule and the same reasoning as `score` in queue.ts. */
const score = (w: Word): number => w.usageScore ?? 0

/**
 * How far apart two words must sit in `words.json` to count as separately
 * captured.
 *
 * The capture flow is a synonym walk — a word is added by tapping a related
 * word on the detail page, then another from there — so neighbours in the
 * array are related by construction, whether or not any field says so.
 * Measured over 13 semantically related pairs drawn from the reported
 * clusters, 11 sit within 3 positions of each other: compassionate /
 * empathetic 1, amiable / disagreeable 1, resentful / resentment 1,
 * celebrated / illustrious 1, quarrel / grudge 3.
 *
 * The index is stable enough to lean on: applyWordOps appends a new id and
 * replaces an existing one in place, so a word only moves when an earlier
 * word is deleted.
 */
const CAPTURE_WINDOW = 3

/**
 * The ceiling on the spacing gap, in words.
 *
 * A larger gap is **not** monotonically better. Once the constraint stops
 * being satisfiable the fail-open branch below fires on nearly every pick,
 * and the result lands worse than a smaller gap would: over the library's
 * last 60 words at newPerDay 5, a gap of 14 leaves 4 days holding a related
 * pair where a gap of 5 leaves 1.
 */
export const MAX_SPACING_GAP = 10

/**
 * FNV-1a over the word id, used as the tiebreak between words of equal
 * usageScore.
 *
 * **A hash, not a random number, and deliberately no injected `rng`.** The
 * CLAUDE.md rule about injecting `rng` exists to make randomness testable;
 * the requirement here is the opposite one. `fresh` is recomputed on every
 * render of the Today page and again when Review mounts, so a re-rolled
 * order would hand you a different five words for backing out of the review
 * page and re-entering it, and would change the word shown as next up. Two
 * devices would also disagree about what today's new words are.
 */
function hash(id: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

/**
 * Today's new words, ordered so that related ones don't arrive together.
 *
 * `usageScore` still decides who gets learned — only `newPerDay` words are
 * learned each day and that budget should buy the words most likely to be
 * encountered. What changed is the tiebreak and a spacing pass over it.
 *
 * The old tiebreak was the word's position in `words.json`, which is
 * capture order, which is a synonym walk — so the queue reproduced the
 * clusters exactly. Simulated over the library's last 60 words at
 * newPerDay 5, **11 of 12 days held at least one related pair**
 * (`compassionate empathetic sympathize` on one day, `deceive resentful
 * resentment` on another). The hash tiebreak alone takes that to 4; the
 * spacing pass takes it to 1, and to 0 on the 120- and 240-word pools.
 *
 * `index` maps a word id to its position in the full word list — the pool
 * is already filtered, so it cannot supply this itself.
 *
 * `limit` stops the walk once today's budget is filled. The pass is
 * sequential, so a shortened run is a prefix of the full one; without it
 * this would order the entire unlearned backlog on every Today render.
 */
export function orderFreshWords(
  pool: readonly Word[],
  index: ReadonlyMap<string, number>,
  gap: number,
  limit: number,
): Word[] {
  const sorted = [...pool].sort((a, b) => score(b) - score(a) || hash(a.id) - hash(b.id))

  const links = declaredLinks(pool)
  // The intake rule is the review rule (isRelated) **plus** capture
  // proximity, which is only meaningful here: this pool is a capture batch,
  // so neighbours in the array really were tapped one after the other. See
  // the note at the top of related.ts for why it does not generalise.
  const related = (a: Word, b: Word): boolean => {
    const ia = index.get(a.id)
    const ib = index.get(b.id)
    if (ia !== undefined && ib !== undefined && Math.abs(ia - ib) <= CAPTURE_WINDOW) return true
    return isRelated(a.id, b.id, links)
  }

  return spaceApart(sorted, related, gap, limit)
}
