import { describe, expect, it } from 'vitest'
import type { Progress, ProgressEntry } from '../types'
import type { SynonymGroup } from './synonymGroups'
import { BOOST_CAP, VISIT_SIZE, groupLastSeen, pickVisit, resolveVisit, upcoming } from './synonymVisit'

/** A group titled `key` with one term, whose members are `ids`. */
const g = (key: string, ids: string[] = [`${key}-1`, `${key}-2`]): SynonymGroup => ({
  key, terms: [key], members: ids.map((id) => ({ id, carrying: [0], firstMeaning: true })),
})

/** Minute `n` of 2026-10-01, UTC, as the ISO string toISOString writes. */
const T = (n: number) => new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString()

/** A progress entry whose forget log holds a record at each of `ats`. */
const entry = (ats: string[] = []): ProgressEntry => ({
  state: 'review', ease: 2.5, intervalDays: 10, due: '2026-10-30', stepIndex: 0, reps: 3, lapses: ats.length,
  lastReviewedAt: T(0),
  forgot: ats.map((at) => ({ at, kind: 'blank', prevInterval: 10, prevReviewedAt: T(0) })),
})

const keys = (gs: SynonymGroup[]) => gs.map((x) => x.key)
const stamp = (seen: Record<string, string>, picked: SynonymGroup[], at: string) => {
  for (const x of picked) for (const t of x.terms) seen[t] = at
}

describe('pickVisit', () => {
  it('shows never-seen groups first, then the oldest seen', () => {
    const groups = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((k) => g(k))
    const seen = { a: T(3), b: T(1), c: T(2) }
    const visit = keys(pickVisit(groups, seen, {}))
    expect(visit).toHaveLength(VISIT_SIZE)
    expect(new Set(visit.slice(0, 4))).toEqual(new Set(['d', 'e', 'f', 'g']))
    expect(visit[4]).toBe('b')
  })

  it('sees every group once before any group twice', () => {
    const groups = Array.from({ length: 23 }, (_, i) => g(`k${i}`))
    const seen: Record<string, string> = {}
    const count = new Map(groups.map((x) => [x.key, 0]))
    for (let v = 1; v <= 14; v++) {
      const picked = pickVisit(groups, seen, {})
      picked.forEach((x, i) => { count.set(x.key, (count.get(x.key) ?? 0) + 1); stamp(seen, [x], T(v * 10 + i)) })
      const n = [...count.values()]
      expect(Math.max(...n) - Math.min(...n)).toBeLessThanOrEqual(1)
    }
  })

  it('boosts groups whose member was forgotten after they were last seen, at most 2 a visit', () => {
    const groups = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8'].map((k) => g(k))
    const seen = Object.fromEntries(groups.map((x) => [x.key, T(0)]))
    const words: Progress['words'] = {
      'g1-1': entry([T(1)]), 'g2-1': entry([T(2)]), 'g3-1': entry([T(3)]), 'g4-1': entry([T(4)]),
    }
    const visit = keys(pickVisit(groups, seen, words))
    expect(BOOST_CAP).toBe(2)
    expect(visit.slice(0, 2)).toEqual(['g4', 'g3'])
    expect(visit).toHaveLength(5)
  })

  it('sends a boosted group back to the rotation once it is seen after the record', () => {
    const groups = [g('a'), g('b')]
    const words: Progress['words'] = { 'a-1': entry([T(1)]) }
    expect(keys(pickVisit(groups, { a: T(2), b: T(0) }, words, 1))).toEqual(['b'])
    expect(keys(pickVisit(groups, { a: T(0), b: T(0) }, words, 1))).toEqual(['a'])
  })

  it('keeps the rotation fair while boosts arrive every visit', () => {
    // 23 groups with one forgettable member each; every visit, three members
    // picked by a fixed LCG are forgotten. With 3 rotation slots a visit, no
    // group can wait more than 8 visits: at most 22 groups are ever ahead of
    // it, and each visit takes at least 3 of them.
    const groups = Array.from({ length: 23 }, (_, i) => g(`k${i}`, [`m${i}`, `x${i}`]))
    const seen: Record<string, string> = {}
    const words: Progress['words'] = {}
    const lastVisit = new Map(groups.map((x) => [x.key, 0]))
    let lcg = 7
    let boostedPicks = 0
    for (let v = 1; v <= 40; v++) {
      for (let j = 0; j < 3; j++) {
        lcg = (lcg * 48271) % 2147483647
        const id = `m${lcg % 23}`
        const prev = words[id]?.forgot?.map((r) => r.at) ?? []
        words[id] = entry([...prev, T(v * 10)].slice(-10))
      }
      const picked = pickVisit(groups, seen, words)
      expect(picked).toHaveLength(5)
      picked.forEach((x, i) => {
        const last = groupLastSeen(x, seen)
        const forgot = words[x.members[0].id]?.forgot ?? []
        if (i < 2 && forgot.some((r) => last === undefined || r.at > last)) boostedPicks++
        stamp(seen, [x], T(v * 10 + 1 + i))
        lastVisit.set(x.key, v)
      })
      for (const [, at] of lastVisit) expect(v - at).toBeLessThanOrEqual(8)
    }
    expect(boostedPicks).toBeGreaterThan(0)
  })

  it('breaks ties the same way on every call', () => {
    const groups = Array.from({ length: 12 }, (_, i) => g(`t${i}`))
    expect(keys(pickVisit(groups, {}, {}))).toEqual(keys(pickVisit([...groups].reverse(), {}, {})))
  })

  it('returns every group when there are fewer than the visit size', () => {
    expect(pickVisit([g('a'), g('b'), g('c')], {}, {})).toHaveLength(3)
  })

  it('skips non-string stamps and a forget log that is not an array', () => {
    const groups = [g('a'), g('b')]
    const seen = { a: 5, b: T(1) } as unknown as Progress['synonymSeen']
    const words = { 'a-1': { ...entry(), forgot: 7 } } as unknown as Progress['words']
    expect(() => pickVisit(groups, seen, words)).not.toThrow()
    expect(keys(pickVisit(groups, seen, words, 1))).toEqual(['a'])
  })
})

describe('groupLastSeen', () => {
  it("reads a group's last-seen as the latest of its terms' stamps", () => {
    const group: SynonymGroup = { key: '抱怨、牢骚', terms: ['抱怨', '牢骚'], members: [] }
    expect(groupLastSeen(group, { 抱怨: T(1), 牢骚: T(2) })).toBe(T(2))
    expect(groupLastSeen(group, {})).toBeUndefined()
    expect(groupLastSeen(group, undefined)).toBeUndefined()
  })
})

describe('upcoming', () => {
  it('lists upcoming groups starting with the next visit, each once', () => {
    const groups = Array.from({ length: 9 }, (_, i) => g(`u${i}`))
    const seen = { u0: T(1), u1: T(2) }
    const words: Progress['words'] = { 'u1-1': entry([T(3)]) }
    const next = upcoming(groups, seen, words, 7)
    expect(next).toHaveLength(7)
    expect(keys(next.slice(0, 5))).toEqual(keys(pickVisit(groups, seen, words)))
    expect(new Set(keys(upcoming(groups, seen, words, 50))).size).toBe(9)
  })
})

describe('resolveVisit', () => {
  it('resolves held keys to current groups and skips one that vanished', () => {
    expect(keys(resolveVisit(['a', 'gone', 'c'], [g('c'), g('a'), g('b')]))).toEqual(['a', 'c'])
  })
})
