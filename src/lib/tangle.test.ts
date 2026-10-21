import { describe, expect, it } from 'vitest'
import type { ForgetRecord, Progress, ProgressEntry, TangleStat } from '../types'
import { emptyProgress } from '../types'
import type { ContrastPair } from './contrast'
import {
  TANGLE_DAILY_CAP, TANGLE_MEMBER_CAP, applyConfusion, applyTangleResults, dueTangles,
  tangleMembers, todaysConfusedPairs,
} from './tangle'

const pair = (a: string, b: string, score: number): ContrastPair => ({
  a: a < b ? a : b, b: a < b ? b : a, shared: [], direct: false, score,
})

/** Local noon, so todayStr(now) reads back the same calendar day in any timezone. */
const noon = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h)
const NOW = noon(2026, 10, 20)
const TODAY = '2026-10-20'
const TOMORROW = '2026-10-21'

const stat = (over: Partial<TangleStat> = {}): TangleStat => ({
  pairs: ['a|b'], members: ['a', 'b', 'c'], settled: [],
  bornOn: '2026-10-18', dueOn: '2026-10-19', lastAt: noon(2026, 10, 18).toISOString(), ...over,
})

/** Freezes the whole value so any mutation of an input throws (these modules are strict-mode ESM). */
const deepFreeze = <T>(v: T): T => {
  if (typeof v === 'object' && v !== null) {
    Object.freeze(v)
    for (const child of Object.values(v)) deepFreeze(child)
  }
  return v
}

describe('constants', () => {
  it('cap a tangle at 5 words and a day at 3 tangles', () => {
    expect(TANGLE_MEMBER_CAP).toBe(5)
    expect(TANGLE_DAILY_CAP).toBe(3)
  })
})

describe('tangleMembers', () => {
  const studied = new Set(['corroborate', 'vindicate', 'substantiate', 'ratify', 'justify'])
  const graph = [
    pair('corroborate', 'vindicate', 9),
    pair('corroborate', 'substantiate', 8),
    pair('vindicate', 'substantiate', 7),
    pair('corroborate', 'ratify', 6), // ratify is a partner of one side only
    pair('vindicate', 'justify', 6), // and so is justify
  ]

  it('is the pair, then the studied partners of both', () => {
    expect(tangleMembers('corroborate', 'vindicate', studied, graph)).toEqual(['corroborate', 'vindicate', 'substantiate'])
  })

  it('reads the graph from either side of a pair, and keeps the pair in the order given', () => {
    expect(tangleMembers('vindicate', 'corroborate', studied, graph)).toEqual(['vindicate', 'corroborate', 'substantiate'])
  })

  it('leaves out a common partner that has not been studied', () => {
    expect(tangleMembers('corroborate', 'vindicate', new Set(['corroborate', 'vindicate']), graph))
      .toEqual(['corroborate', 'vindicate'])
  })

  it('ranks common partners by the sum of their two scores, then by id, and caps at 5', () => {
    // Six common partners, p1 the farthest and p6 the nearest: sums 10, 12, 14, 16, 18, 20.
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']
    const pairs = [
      pair('x', 'y', 1),
      ...ids.flatMap((id, i) => [pair('x', id, 5 + i), pair('y', id, 5 + i)]),
    ]
    const got = tangleMembers('x', 'y', new Set(['x', 'y', ...ids]), pairs)
    expect(got).toHaveLength(TANGLE_MEMBER_CAP)
    expect(got).toEqual(['x', 'y', 'p6', 'p5', 'p4'])
  })

  it('breaks a tie on summed score by id, so the answer is a function of the data alone', () => {
    const pairs = [pair('x', 'q', 4), pair('y', 'q', 4), pair('x', 'm', 5), pair('y', 'm', 3)]
    expect(tangleMembers('x', 'y', new Set(['q', 'm']), pairs)).toEqual(['x', 'y', 'm', 'q'])
  })

  it('does not count the pair itself as its own common partner', () => {
    expect(tangleMembers('a', 'b', new Set(['a', 'b']), [pair('a', 'b', 9)])).toEqual(['a', 'b'])
  })
})

describe('applyConfusion', () => {
  const members = () => ['a', 'b', 'c']

  it('a new pair opens a tangle born today, due tomorrow', () => {
    const got = applyConfusion(undefined, 'b', 'a', members, NOW)
    expect(got).toEqual({
      'a|b': {
        pairs: ['a|b'], members: ['a', 'b', 'c'], settled: [],
        bornOn: TODAY, dueOn: TOMORROW, lastAt: NOW.toISOString(),
      },
    })
    expect(Object.hasOwn(got['a|b'], 'doneOn')).toBe(false)
  })

  it('keeps every other tangle as it was when it opens a new one', () => {
    const other = stat({ pairs: ['x|y'], members: ['x', 'y'] })
    const got = applyConfusion({ 'x|y': other }, 'a', 'b', members, NOW)
    expect(Object.keys(got).sort()).toEqual(['a|b', 'x|y'])
    expect(got['x|y']).toEqual(other)
  })

  it('a pair inside an open tangle refreshes it: appended once, both words unsettled, due date unchanged', () => {
    const open = stat({ pairs: ['a|b'], members: ['a', 'b', 'c', 'd'], settled: ['a', 'b', 'c'] })
    const once = applyConfusion({ 'a|b': open }, 'c', 'd', () => ['never', 'called'], NOW)
    // c|d is a new key inside an open tangle that holds both c and d.
    expect(Object.keys(once)).toEqual(['a|b'])
    expect(once['a|b'].pairs).toEqual(['a|b', 'c|d'])
    expect(once['a|b'].settled).toEqual(['a', 'b'])
    expect(once['a|b'].dueOn).toBe('2026-10-19')
    expect(once['a|b'].bornOn).toBe('2026-10-18')
    expect(once['a|b'].members).toEqual(['a', 'b', 'c', 'd'])
    expect(once['a|b'].lastAt).toBe(NOW.toISOString())

    const twice = applyConfusion(once, 'd', 'c', () => ['never', 'called'], noon(2026, 10, 20, 15))
    expect(twice['a|b'].pairs).toEqual(['a|b', 'c|d'])
  })

  it('does not recompute the members of a tangle it refreshes', () => {
    let calls = 0
    applyConfusion({ 'a|b': stat() }, 'a', 'b', () => (calls++, ['a', 'b']), NOW)
    expect(calls).toBe(0)
  })

  it('a pair inside a done tangle reopens it from day 1, with its members recomputed', () => {
    const done = stat({ settled: ['a', 'b', 'c'], doneOn: '2026-10-19', dueOn: '2026-10-19' })
    const got = applyConfusion({ 'a|b': done }, 'a', 'b', () => ['a', 'b', 'z'], NOW)
    expect(Object.keys(got)).toEqual(['a|b'])
    const re = got['a|b']
    expect(Object.hasOwn(re, 'doneOn')).toBe(false)
    expect(re.settled).toEqual([])
    expect(re.bornOn).toBe(TODAY)
    expect(re.dueOn).toBe(TOMORROW)
    expect(re.members).toEqual(['a', 'b', 'z'])
    expect(re.lastAt).toBe(NOW.toISOString())
  })

  it("a reopen also appends the new pair's key, when it is not there already", () => {
    const done = stat({ pairs: ['a|b'], members: ['a', 'b', 'c'], doneOn: '2026-10-19' })
    const got = applyConfusion({ 'a|b': done }, 'b', 'c', members, NOW)
    expect(got['a|b'].pairs).toEqual(['a|b', 'b|c'])
    const again = applyConfusion({ 'a|b': done }, 'a', 'b', members, NOW)
    expect(again['a|b'].pairs).toEqual(['a|b'])
  })

  it('picks the tangle with the latest lastAt when several hold both words', () => {
    const older = stat({ pairs: ['a|c'], lastAt: noon(2026, 10, 15).toISOString() })
    const newer = stat({ pairs: ['b|c'], lastAt: noon(2026, 10, 17).toISOString() })
    const got = applyConfusion({ 'a|c': older, 'b|c': newer }, 'a', 'b', members, NOW)
    expect(got['b|c'].pairs).toEqual(['b|c', 'a|b'])
    expect(got['a|c']).toEqual(older)
  })

  it('checks open tangles before done ones, even when the done one is later', () => {
    const open = stat({ pairs: ['a|c'], lastAt: noon(2026, 10, 15).toISOString() })
    const done = stat({ pairs: ['b|c'], doneOn: '2026-10-19', lastAt: noon(2026, 10, 19).toISOString() })
    const got = applyConfusion({ 'a|c': open, 'b|c': done }, 'a', 'b', members, NOW)
    expect(got['a|c'].pairs).toEqual(['a|c', 'a|b'])
    expect(got['a|c'].doneOn).toBeUndefined()
    expect(got['b|c']).toEqual(done)
  })

  it('opens a new tangle when no tangle holds both words, even if one holds either', () => {
    const t = stat({ pairs: ['a|c'], members: ['a', 'c'] })
    const got = applyConfusion({ 'a|c': t }, 'a', 'b', members, NOW)
    expect(Object.keys(got).sort()).toEqual(['a|b', 'a|c'])
    expect(got['a|b'].bornOn).toBe(TODAY)
    expect(got['a|c']).toEqual(t)
  })

  it('returns a new record and never mutates what it was given', () => {
    const input = deepFreeze({ 'a|b': stat({ doneOn: '2026-10-19' }), 'c|d': stat({ members: ['c', 'd'] }) })
    const before = structuredClone(input)
    const reopened = applyConfusion(input, 'a', 'b', members, NOW)
    const refreshed = applyConfusion(deepFreeze({ 'a|b': stat() }), 'a', 'b', members, NOW)
    expect(input).toEqual(before)
    expect(reopened).not.toBe(input)
    expect(refreshed['a|b']).not.toBe(input['a|b'])
  })

  it('steps over a malformed stat instead of throwing, and leaves it where it was', () => {
    const junk = { pairs: 'a|b', members: 7, settled: null } as unknown as TangleStat
    const got = applyConfusion({ 'x|y': junk }, 'a', 'b', members, NOW)
    expect(got['x|y']).toBe(junk)
    expect(got['a|b'].bornOn).toBe(TODAY)
  })
})

describe('dueTangles', () => {
  const live = new Set(['a', 'b', 'c', 'd', 'e', 'f'])

  it('lists open tangles due today or earlier, oldest dueOn first, then bornOn, then key', () => {
    // Keys run against bornOn on purpose: 'a-…' is born last and must come after 'z-…', so a missing bornOn tiebreak shows.
    const tangles = {
      'a-late': stat({ dueOn: '2026-10-20', bornOn: '2026-10-10' }),
      'a-young': stat({ dueOn: '2026-10-15', bornOn: '2026-10-12' }),
      'z-old': stat({ dueOn: '2026-10-15', bornOn: '2026-10-11' }),
      'y-old': stat({ dueOn: '2026-10-15', bornOn: '2026-10-11' }),
    }
    expect(dueTangles(tangles, TODAY, live)).toEqual(['y-old', 'z-old', 'a-young', 'a-late'])
  })

  it('leaves out a done tangle, one not yet due, and one with fewer than 2 members still in the library', () => {
    const tangles = {
      done: stat({ doneOn: '2026-10-19' }),
      tomorrow: stat({ dueOn: TOMORROW }),
      oneLive: stat({ members: ['a', 'gone1', 'gone2'] }),
      noneLive: stat({ members: ['gone1', 'gone2'] }),
      twoLive: stat({ members: ['a', 'b', 'gone1'] }),
      today: stat({ dueOn: TODAY }),
    }
    expect(dueTangles(tangles, TODAY, live).sort()).toEqual(['today', 'twoLive'])
  })

  it('is empty when there are no tangles at all', () => {
    expect(dueTangles(undefined, TODAY, live)).toEqual([])
    expect(dueTangles({}, TODAY, live)).toEqual([])
  })

  it('skips a malformed stat instead of throwing: a login or cached boot reaches here unmerged', () => {
    const bad = (over: Record<string, unknown>) => ({ ...stat(), ...over }) as unknown as TangleStat
    const tangles = {
      good: stat(),
      dueNumber: bad({ dueOn: 7 }),
      bornMissing: bad({ bornOn: undefined }),
      membersString: bad({ members: 'a,b' }),
      settledNull: bad({ settled: null }),
      pairsObject: bad({ pairs: {} }),
      memberNotString: bad({ members: ['a', 2] }),
      nothing: null as unknown as TangleStat,
      list: [] as unknown as TangleStat,
      number: 7 as unknown as TangleStat,
    }
    expect(dueTangles(tangles, TODAY, live)).toEqual(['good'])
  })

  it('reads a doneOn that is not a string as not done, as the merge does', () => {
    const odd = { ...stat(), doneOn: 7 } as unknown as TangleStat
    expect(dueTangles({ odd }, TODAY, live)).toEqual(['odd'])
  })
})

describe('todaysConfusedPairs', () => {
  const live = new Set(['a', 'b', 'c', 'd'])
  const at = (d: number, h: number) => noon(2026, 10, d, h).toISOString()
  const rec = (over: Partial<ForgetRecord> = {}): ForgetRecord => ({
    at: at(20, 9), kind: 'confused', with: 'b', prevInterval: 10, prevReviewedAt: '2026-10-10T00:00:00.000Z', ...over,
  })
  const entry = (forgot?: unknown): ProgressEntry => ({
    state: 'learning', ease: 2.3, intervalDays: 0, due: TODAY, stepIndex: 0, reps: 3, lapses: 1,
    lastReviewedAt: at(20, 9), ...(forgot === undefined ? {} : { forgot: forgot as ForgetRecord[] }),
  })
  const progress = (words: Record<string, unknown>): Progress =>
    ({ ...emptyProgress(), words: words as Progress['words'] })

  it("is one entry per pair from today's confused records that name a partner", () => {
    const p = progress({ a: entry([rec({ with: 'b' })]), c: entry([rec({ at: at(20, 10), with: 'd' })]) })
    expect(todaysConfusedPairs(p, TODAY, live)).toEqual([
      { lapsed: 'a', partner: 'b' },
      { lapsed: 'c', partner: 'd' },
    ])
  })

  it('makes one entry of a pair confused from both sides, keeping the earlier record', () => {
    const p = progress({
      a: entry([rec({ at: at(20, 11), with: 'b' })]),
      b: entry([rec({ at: at(20, 9), with: 'a' })]),
    })
    expect(todaysConfusedPairs(p, TODAY, live)).toEqual([{ lapsed: 'b', partner: 'a' }])
  })

  it('lists a pair once however many times it was confused today, and one word may open two pairs', () => {
    const p = progress({
      a: entry([rec({ at: at(20, 9), with: 'b' }), rec({ at: at(20, 12), with: 'b' }), rec({ at: at(20, 13), with: 'c' })]),
    })
    expect(todaysConfusedPairs(p, TODAY, live)).toEqual([
      { lapsed: 'a', partner: 'b' },
      { lapsed: 'a', partner: 'c' },
    ])
  })

  it('orders by when it was confused, not by where the word sits in the progress object', () => {
    const p = progress({
      c: entry([rec({ at: at(20, 14), with: 'd' })]),
      a: entry([rec({ at: at(20, 8), with: 'b' })]),
    })
    expect(todaysConfusedPairs(p, TODAY, live).map((x) => x.lapsed)).toEqual(['a', 'c'])
  })

  it('leaves out other days, blank records, the own-sense answer and an answer naming no partner', () => {
    const p = progress({
      a: entry([rec({ at: at(19, 9) })]),
      b: entry([rec({ kind: 'blank', with: undefined })]),
      c: entry([rec({ with: 'self' })]),
      d: entry([rec({ with: undefined })]),
      e: entry([rec({ kind: 'blank', with: 'b' })]),
    })
    expect(todaysConfusedPairs(p, TODAY, new Set([...live, 'e']))).toEqual([])
  })

  it("never reads 'self' as a partner, even when the library has a word with that id", () => {
    const p = progress({ a: entry([rec({ with: 'self' })]) })
    expect(todaysConfusedPairs(p, TODAY, new Set([...live, 'self']))).toEqual([])
  })

  it('leaves out a pair with a word that is no longer in the library, whichever side', () => {
    const p = progress({
      a: entry([rec({ with: 'gone' })]),
      gone: entry([rec({ with: 'b' })]),
    })
    expect(todaysConfusedPairs(p, TODAY, live)).toEqual([])
  })

  it('skips malformed data instead of throwing: a non-array log, a non-string at, a junk record, a junk entry', () => {
    const p = progress({
      a: entry(7),
      // A numeric `at` that lands on today would pass for a date if only the day were checked.
      b: entry([rec({ at: noon(2026, 10, 20).getTime() as unknown as string, with: 'd' }), null, 'x', [], rec({ kind: 'weird' as ForgetRecord['kind'], with: 'd' })]),
      c: entry([rec({ with: 3 as unknown as string })]),
      d: null,
      e: entry([rec({ with: 'a' })]),
    })
    expect(todaysConfusedPairs(p, TODAY, new Set([...live, 'e']))).toEqual([{ lapsed: 'e', partner: 'a' }])
  })
})

describe('applyTangleResults', () => {
  const live = new Set(['a', 'b', 'c'])

  it('adds the right answers and the auto-settled members to settled, once each', () => {
    const got = applyTangleResults(stat({ settled: ['a'] }), ['a', 'b'], ['b'], live, NOW)
    expect(got.settled).toEqual(['a', 'b'])
  })

  it('is done today when every member still in the library is settled', () => {
    const got = applyTangleResults(stat({ settled: ['a'] }), ['b'], ['c'], live, NOW)
    expect(got.doneOn).toBe(TODAY)
    expect(got.lastAt).toBe(NOW.toISOString())
  })

  it('does not wait on a member that has been deleted', () => {
    const got = applyTangleResults(stat({ members: ['a', 'b', 'gone'] }), ['a', 'b'], [], live, NOW)
    expect(got.doneOn).toBe(TODAY)
    expect(got.settled).toEqual(['a', 'b'])
  })

  it('otherwise stays open and is due tomorrow, with a miss leaving its member unsettled', () => {
    const got = applyTangleResults(stat({ dueOn: '2026-10-18' }), ['a', 'b'], [], live, NOW)
    expect(got.settled).toEqual(['a', 'b'])
    expect(got.dueOn).toBe(TOMORROW)
    expect(Object.hasOwn(got, 'doneOn')).toBe(false)
    expect(got.lastAt).toBe(NOW.toISOString())
  })

  it('keeps the fields it does not change, including one a newer build added', () => {
    const base = { ...stat(), future: 'kept' } as TangleStat
    const got = applyTangleResults(base, ['a', 'b', 'c'], [], live, NOW)
    expect(got.pairs).toEqual(base.pairs)
    expect(got.members).toEqual(base.members)
    expect(got.bornOn).toBe(base.bornOn)
    expect((got as unknown as { future: string }).future).toBe('kept')
  })

  it('does not settle an id that is not a member', () => {
    const got = applyTangleResults(stat(), ['zzz'], [], live, NOW)
    expect(got.settled).toEqual([])
  })

  it('returns a new stat and never mutates the one it was given', () => {
    const input = deepFreeze(stat({ settled: ['a'] }))
    const before = structuredClone(input)
    const got = applyTangleResults(input, ['b'], ['c'], live, NOW)
    expect(input).toEqual(before)
    expect(got).not.toBe(input)
    expect(got.settled).not.toBe(input.settled)
  })
})
