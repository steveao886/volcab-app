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

/** Longest common prefix at which two ids count as the same word family, and how much may hang off the end of it. */
const STEM_MIN = 5
const STEM_MAX_TAIL = 4

/**
 * How far ahead the spacing pass may reach for a word that fits.
 *
 * Bounds the work, and bounds the damage: a word can jump ahead of at most
 * 20 better-scoring words, never the whole tail. Measured over the live
 * library, the largest usageScore actually crossed to defer a word is 1
 * point on a 120- or 240-word unlearned pool (3 on a 60-word one, where the
 * pass has fewer legal moves).
 */
const LOOKAHEAD = 20

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
 * Whether two ids are built on the same stem — resent / resentful /
 * resentment, renown / renowned, deceive / deceit, advocate / advocacy.
 *
 * Fires on 75 pairs across the 717-word library, of which about 5 are false
 * positives (impasse / impassive, intrinsic / intrigue, interlude /
 * intercede, underhand / undermine). **Loose on purpose**: the cost of a
 * false positive is that two unrelated words end up a few queue positions
 * apart, which costs nothing. This is the opposite of the `etymology` rule,
 * where a wrong guess plants a false memory anchor, and the two must not be
 * reasoned about the same way.
 */
function sharesStem(a: string, b: string): boolean {
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
function declaredLinks(pool: readonly Word[]): Map<string, Set<string>> {
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
  const take = Math.min(Math.max(limit, 0), sorted.length)
  if (gap <= 0) return sorted.slice(0, take)

  const links = declaredLinks(pool)
  const related = (a: Word, b: Word): boolean => {
    const ia = index.get(a.id)
    const ib = index.get(b.id)
    if (ia !== undefined && ib !== undefined && Math.abs(ia - ib) <= CAPTURE_WINDOW) return true
    if (links.get(a.id)?.has(b.id) === true) return true
    return sharesStem(a.id, b.id)
  }

  const out: Word[] = []
  while (out.length < take) {
    const recent = out.slice(-gap)
    // Fail open: when nothing in reach fits, take the head. The pass must
    // never drop a word, never return fewer than asked and never loop —
    // a queue that silently shrinks is a far worse bug than two synonyms
    // landing on one day.
    let pick = 0
    const ceiling = Math.min(LOOKAHEAD, sorted.length)
    for (let i = 0; i < ceiling; i++) {
      if (!recent.some(w => related(w, sorted[i]))) { pick = i; break }
    }
    out.push(sorted.splice(pick, 1)[0])
  }
  return out
}
