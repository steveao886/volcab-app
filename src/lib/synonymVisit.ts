import type { Progress } from '../types'
import type { SynonymGroup } from './synonymGroups'

/**
 * Which groups a 近义词 visit shows (spec §5): the least recently seen, with
 * groups holding a word forgotten since they were last seen moved to the
 * front, at most BOOST_CAP of them.
 *
 * **Least recently seen, not random.** Drawing 5 at random from the 324 groups
 * of 2026-10-23, after the 65 visits it takes to see each once, leaves 36.3%
 * never seen while the luckiest group has been seen 4.8 times on average —
 * about 1/e unseen at any library size.
 *
 * **The boost is capped** because at the live library's 5.85 lapses a day,
 * with 625 of 996 studied words in some group (1.67 groups each), a day's
 * forgetting boosts about 6.1 groups. Uncapped, that fills every visit and
 * the rotation never moves; at 2 of 5, three slots always go to it.
 *
 * **Ties break by a stable hash, not an rng.** Only never-seen groups ever
 * tie (each group is stamped at its own moment), and at ship time that is all
 * of them. A hash looks arbitrary to the reader and lets `synonym-todo` list
 * exactly what the page will show next, so paragraphs written first are read
 * first.
 */

export const VISIT_SIZE = 5
export const BOOST_CAP = 2

/** The latest stamp among the group's terms. A value that is not a string (an older build, a hand edit) counts as none. */
export function groupLastSeen(group: SynonymGroup, seen: Progress['synonymSeen']): string | undefined {
  let latest: string | undefined
  for (const t of group.terms) {
    const at: unknown = seen?.[t]
    if (typeof at === 'string' && (latest === undefined || at > latest)) latest = at
  }
  return latest
}

export function pickVisit(
  groups: SynonymGroup[],
  seen: Progress['synonymSeen'],
  words: Progress['words'],
  size = VISIT_SIZE,
  boostCap = BOOST_CAP,
): SynonymGroup[] {
  const last = new Map(groups.map((g) => [g.key, groupLastSeen(g, seen)]))
  const boosted = groups
    .flatMap((g) => {
      const at = newestForgetSince(g, words, last.get(g.key))
      return at === undefined ? [] : [{ g, at }]
    })
    .sort((a, b) => (a.at !== b.at ? (a.at < b.at ? 1 : -1) : tieOrder(a.g, b.g)))
    .slice(0, Math.min(boostCap, size))
    .map((x) => x.g)
  const taken = new Set(boosted.map((g) => g.key))
  const rotation = groups
    .filter((g) => !taken.has(g.key))
    .sort((a, b) => {
      const la = last.get(a.key), lb = last.get(b.key)
      if (la !== lb) {
        if (la === undefined) return -1
        if (lb === undefined) return 1
        return la < lb ? -1 : 1
      }
      return tieOrder(a, b)
    })
  return [...boosted, ...rotation].slice(0, size)
}

/**
 * The groups the page will show over the coming visits, in order, each once,
 * assuming nothing new is forgotten: `synonym-todo`'s list. Simulates each
 * visit by stamping its groups after every real stamp and forget record, so a
 * boosted group drops back once "seen", as it would on the page.
 */
export function upcoming(
  groups: SynonymGroup[],
  seen: Progress['synonymSeen'],
  words: Progress['words'],
  count: number,
): SynonymGroup[] {
  const sim: Record<string, string> = {}
  let base = 0
  for (const [t, at] of Object.entries(seen ?? {})) {
    if (typeof at !== 'string') continue
    sim[t] = at
    base = Math.max(base, Date.parse(at) || 0)
  }
  for (const g of groups) for (const m of g.members) for (const at of forgetAts(words, m.id)) base = Math.max(base, Date.parse(at) || 0)

  const out: SynonymGroup[] = []
  const listed = new Set<string>()
  const limit = Math.min(count, groups.length)
  let tick = 0
  while (out.length < limit) {
    const visit = pickVisit(groups, sim, words).filter((g) => !listed.has(g.key))
    if (visit.length === 0) break
    for (const g of visit) {
      if (out.length >= limit) break
      out.push(g)
      listed.add(g.key)
      tick += 1
      const at = new Date(base + tick * 1000).toISOString()
      for (const t of g.terms) sim[t] = at
    }
  }
  return out
}

/** The held keys of a visit, mapped back to the current groups in order; a group that vanished (a word deleted elsewhere, a sync) is skipped. */
export function resolveVisit(keys: string[], groups: SynonymGroup[]): SynonymGroup[] {
  const byKey = new Map(groups.map((g) => [g.key, g]))
  return keys.flatMap((k) => {
    const g = byKey.get(k)
    return g === undefined ? [] : [g]
  })
}

/** Every readable `at` in a word's forget log. Lenient: progress reaches the store unmerged on login and cached boot. */
function forgetAts(words: Progress['words'], id: string): string[] {
  const log: unknown = words[id]?.forgot
  if (!Array.isArray(log)) return []
  return log.flatMap((r: unknown) => {
    const at = (r as { at?: unknown } | null)?.at
    return typeof at === 'string' ? [at] : []
  })
}

/** The newest forget record among the group's members later than `since` (any, when never seen). */
function newestForgetSince(group: SynonymGroup, words: Progress['words'], since: string | undefined): string | undefined {
  let newest: string | undefined
  for (const m of group.members) {
    for (const at of forgetAts(words, m.id)) {
      if ((since === undefined || at > since) && (newest === undefined || at > newest)) newest = at
    }
  }
  return newest
}

function tieOrder(a: SynonymGroup, b: SynonymGroup): number {
  const ha = stableHash(a.key), hb = stableHash(b.key)
  if (ha !== hb) return ha - hb
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

/** 32-bit FNV-1a over UTF-16 code units: the same order on every device and in the to-do script. */
function stableHash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}
