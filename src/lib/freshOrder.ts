import { confusableIndex } from './contrast'
import { declaredLinks, isRelated, sharesStem, spaceApart } from './related'
import type { Word } from '../types'

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
 * How many days before today a started word keeps its relatives out of the
 * new-word queue. Words started today count as well, so with 3 a relative
 * of something started on the 1st is held back through the 4th and may
 * start on the 5th.
 *
 * Replayed over the live library on 2026-10-01 (221 unlearned, newPerDay
 * 8), counting related pairs started 0 / 1 / 2 / 3 days apart:
 *
 * | lookback | pairs | largest usageScore crossed |
 * |---|---|---|
 * | none (before) | 0 / 13 / 14 / 8 | 1 |
 * | 2 days | 0 / 0 / 0 / 34 | 1 |
 * | **3 days** | **0 / 0 / 0 / 1** | **2** |
 *
 * Two days only moves the pile to day three. Three costs 30 of the 221
 * words a later start — median 2 days, worst 6. At newPerDay 5 it leaves no
 * pair within three days, at 10 one pair two days apart.
 */
export const LOOKBACK_DAYS = 3

/**
 * How many days before today a started word keeps its own **word family**
 * out of the new-word queue: a shared stem, or a `relatedForms` link —
 * `volatile` / `volatility`, `tempting` / `tempt`, `delight` / `delighted`.
 *
 * `LOOKBACK_DAYS` holds every relative back three days and was tuned on
 * synonyms; a family member released on the fourth day still reads as the
 * same word met twice in one week, and the user reported exactly that
 * (2026-11-02: `empowering` five days after `empower`, `delighted` after
 * `delight`, `bureaucrat` after `bureaucratic`). Replayed over the live
 * library from 2026-11-03 (1766 words, 654 unlearned, newPerDay 12, 46
 * days), counting family pairs started within 14 days of each other:
 *
 * | family lookback | pairs ≤ 14 days apart | words deferred | median / worst delay |
 * |---|---|---|---|
 * | 3 (before) | 47 | — | — |
 * | 7 | 15 at 8 days, 16 more by 14 | 51 | 2 / 8 days |
 * | **14** | **0** | **56** | **3 / 16 days** |
 * | 21 | 0 | 55 | 4 / 22 days |
 *
 * 21 buys nothing inside two weeks and costs a longer worst delay; past it
 * the pool cannot satisfy the rule and the fail-open branch starts landing
 * pairs (at 30, on the pre-batch library, pairs reappeared 11 and 13 days
 * apart). Synonyms and confusable pairs keep the 3-day window — the user
 * asked for families, and those were measured separately.
 */
export const FAMILY_LOOKBACK_DAYS = 14

/**
 * FNV-1a over the word id: the queue's order.
 *
 * **A hash, not a random number, and deliberately no injected `rng`.** The
 * CLAUDE.md rule about injecting `rng` exists to make randomness testable;
 * the requirement here is the opposite one. `fresh` is recomputed on every
 * render of the Today page and again when Review mounts, so a re-rolled
 * order would hand you a different five words for backing out of the review
 * page and re-entering it, and would change the word shown as next up. Two
 * devices would also disagree about what today's new words are. A hash is
 * a shuffle that holds still: a word added today lands at a random place in
 * the queue and stays there.
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
 * **The order is the hash alone.** It used to be `usageScore`, high to low,
 * on the reasoning that a day's budget should buy the words most likely to
 * be met. In practice that served the newest capture batch first: the user
 * captures the words they are reading now and the drafts score them high,
 * so on 2026-11-02 the last 114 words added (scored 6–9) were being started
 * ahead of a backlog that mostly scores 4–5, and the user reported the
 * queue as "in the order I added them". Replayed as in
 * `FAMILY_LOOKBACK_DAYS`, the first week's 84 new words held 41 from the
 * latest 114 under the score order and 24 under the hash, against a 17%
 * share of the pool.
 *
 * The tiebreak before the hash was the word's position in `words.json`, which is
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
 *
 * `recent` is the words started today or in the `LOOKBACK_DAYS` days
 * before it, and closes what the above left open: the spacing pass orders
 * one day, so tomorrow's ordering could not see today's words. Replayed
 * over the live library on 2026-10-01 (221 unlearned, newPerDay 8), the
 * same-day guarantee held — 0 pairs — but **13 related pairs started one
 * day apart and 14 two days apart** (`affable` / `amiable`, `profligacy` /
 * `profligate`, `abysmal` / `dreadful`). With the lookback and the
 * confusable pairs below: 0, 0 and 0, and one pair three days apart. See
 * docs/superpowers/specs/2026-10-01-new-word-day-spacing-design.md.
 *
 * `recentFamily` is the words started in the `FAMILY_LOOKBACK_DAYS`
 * window, the longer one that holds back a word's own family — see
 * `sameFamily` below.
 */
export function orderFreshWords(
  pool: readonly Word[],
  index: ReadonlyMap<string, number>,
  gap: number,
  limit: number,
  recent: readonly Word[] = [],
  recentFamily: readonly Word[] = [],
): Word[] {
  const sorted = [...pool].sort((a, b) => hash(a.id) - hash(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  // A word cannot be both waiting and started; if words and progress
  // disagree, the pool wins — a word blocked by itself (it shares its own
  // stem) would be deferred for nothing.
  const inPool = new Set(pool.map(w => w.id))
  const started = recent.filter(w => !inPool.has(w.id))
  const startedFamily = recentFamily.filter(w => !inPool.has(w.id))

  // A word family is held off the whole day, not just off the last `gap`
  // picks, and off the `FAMILY_LOOKBACK_DAYS` before it: `placed` below is
  // everything picked so far in this run.
  const forms = familyLinks([...pool, ...startedFamily])
  const sameFamily = (a: Word, b: Word): boolean =>
    sharesStem(a.id, b.id) || forms.get(a.id)?.has(b.id) === true

  const everyone = [...pool, ...started]
  const links = declaredLinks(everyone)
  // Two words that share a synonym without naming each other —
  // appalling / dreadful through "atrocious", trivial / negligible through
  // "insignificant". Among the unlearned words on 2026-10-01, 84 pairs were
  // related by a declared link or stem and 32 more only by this; without
  // it the 3-day lookback still left 10 pairs within three days.
  const confusable = confusableIndex(everyone)
  const near = (a: Word, b: Word): boolean =>
    isRelated(a.id, b.id, links) || confusable.get(a.id)?.has(b.id) === true

  // Inside one day the rule also takes capture proximity, which is only
  // meaningful here: this pool is a capture batch, so neighbours in the
  // array really were tapped one after the other. See the note at the top
  // of related.ts for why it does not generalise — and it does not reach
  // the lookback either: across the 2026-10-01 batch, 28 of 416 adjacent
  // unlearned pairs were related by anything else, and applied to started
  // words it left the pass nothing legal to pick, 18 to 47 times a run.
  const related = (a: Word, b: Word): boolean => {
    const ia = index.get(a.id)
    const ib = index.get(b.id)
    if (ia !== undefined && ib !== undefined && Math.abs(ia - ib) <= CAPTURE_WINDOW) return true
    return near(a, b)
  }
  const blocked = (w: Word, placed: readonly Word[]): boolean =>
    started.some(s => near(s, w)) ||
    startedFamily.some(s => sameFamily(s, w)) ||
    placed.some(p => sameFamily(p, w))

  return spaceApart(sorted, related, gap, limit, blocked)
}

/** `relatedForms` links within the pool, read from either side — `declaredLinks` without the synonyms and antonyms. */
function familyLinks(pool: readonly Word[]): Map<string, Set<string>> {
  const links = new Map<string, Set<string>>(pool.map(w => [w.id, new Set<string>()]))
  for (const w of pool) {
    for (const r of w.relatedForms) {
      const id = r.form.toLowerCase()
      const target = links.get(id)
      if (id === w.id || target === undefined) continue
      links.get(w.id)!.add(id)
      target.add(w.id)
    }
  }
  return links
}
