import { describe, expect, it } from 'vitest'
import type { ForgetRecord, Progress, ProgressEntry, TangleStat, Word } from '../types'
import { emptyProgress } from '../types'
import type { ContrastPair } from './contrast'
import { headwordPattern } from './headword'
import type { SenseGroup } from './senseGroup'
import {
  TANGLE_DAILY_CAP, TANGLE_MEMBER_CAP, applyConfusion, applyTangleResults, buildTangleSession, dueTangles,
  isFinished, pickTangle, tangleGroups, tangleMembers, todaysConfusedPairs,
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

  it("never replaces a tangle sitting at the pair's key: a reopen can drop a member, and the next confusion of that pair finds it", () => {
    // Done `a|c` holds [a, c, b]. Confusing a|b reopens it and recomputes members from (a, b),
    // whose three closer common partners push c out.
    const done = stat({ pairs: ['a|c'], members: ['a', 'c', 'b'], settled: ['a', 'b', 'c'], doneOn: '2026-10-19' })
    const reopened = applyConfusion({ 'a|c': done }, 'a', 'b', () => ['a', 'b', 'p1', 'p2', 'p3'], NOW)
    expect(reopened['a|c'].members).toEqual(['a', 'b', 'p1', 'p2', 'p3'])

    const live = new Set(['a', 'b', 'c', 'p1', 'p2', 'p3'])
    const progressed = applyTangleResults(reopened['a|c'], ['p1'], [], live, NOW)

    let calls = 0
    const again = applyConfusion({ 'a|c': progressed }, 'a', 'c', () => (calls++, ['a', 'c']), NOW)
    expect(Object.keys(again)).toEqual(['a|c'])
    expect(again['a|c'].pairs).toEqual(['a|c', 'a|b'])
    expect(again['a|c'].settled).toEqual(['p1'])
    expect(again['a|c'].dueOn).toBe(TOMORROW)
    expect(again['a|c'].members).toEqual(['a', 'b', 'p1', 'p2', 'p3'])
    expect(calls).toBe(0)
  })

  it("reopens a done tangle at the pair's key that holds neither word, keeping its pairs", () => {
    const done = stat({ pairs: ['a|b', 'x|y'], members: ['x', 'y'], settled: ['x', 'y'], doneOn: '2026-10-19' })
    const got = applyConfusion({ 'a|b': done }, 'a', 'b', members, NOW)
    expect(Object.keys(got)).toEqual(['a|b'])
    expect(got['a|b'].pairs).toEqual(['a|b', 'x|y'])
    expect(got['a|b'].members).toEqual(['a', 'b', 'c'])
    expect(got['a|b'].bornOn).toBe(TODAY)
    expect(Object.hasOwn(got['a|b'], 'doneOn')).toBe(false)
  })

  it("refreshes an open tangle at the pair's key that holds neither word, without recomputing its members", () => {
    const open = stat({ pairs: ['a|b', 'x|y'], members: ['x', 'y'], settled: ['x'] })
    const got = applyConfusion({ 'a|b': open }, 'a', 'b', () => ['never', 'called'], NOW)
    expect(Object.keys(got)).toEqual(['a|b'])
    expect(got['a|b'].pairs).toEqual(['a|b', 'x|y'])
    expect(got['a|b'].members).toEqual(['x', 'y'])
    expect(got['a|b'].settled).toEqual(['x'])
    expect(got['a|b'].dueOn).toBe('2026-10-19')
  })

  it("replaces an unreadable stat at the pair's own key, which is how a hand-edited one is repaired", () => {
    const junk = { pairs: 'a|b', members: 7, settled: null } as unknown as TangleStat
    const got = applyConfusion({ 'a|b': junk }, 'a', 'b', members, NOW)
    expect(got['a|b'].pairs).toEqual(['a|b'])
    expect(got['a|b'].bornOn).toBe(TODAY)
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

  it('leaves out a tangle with nothing left to ask, though nothing wrote its doneOn: the unsettled member was deleted', () => {
    // [a, b, c], a and b settled, c missed and then deleted.
    const tangles = { gone: stat({ members: ['a', 'b', 'c'], settled: ['a', 'b'] }) }
    expect(dueTangles(tangles, TODAY, new Set(['a', 'b']))).toEqual([])
    expect(dueTangles(tangles, TODAY, new Set(['a', 'b', 'c']))).toEqual(['gone'])
  })

  it('lists exactly the tangles applyTangleResults would not finish, so the two cannot disagree', () => {
    const lives = [new Set(['a', 'b', 'c']), new Set(['a', 'b']), new Set(['b', 'c'])]
    const settleds = [[], ['a'], ['a', 'b'], ['b', 'c'], ['a', 'b', 'c']]
    for (const live of lives) {
      for (const settled of settleds) {
        const s = stat({ members: ['a', 'b', 'c'], settled })
        const listed = dueTangles({ k: s }, TODAY, live).includes('k')
        const finishes = applyTangleResults(s, [], [], live, NOW).doneOn !== undefined
        expect(listed, `live ${[...live]} settled ${settled}`).toBe(!finishes)
      }
    }
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

describe('pickTangle', () => {
  it('runs the named tangle when it is due', () => {
    expect(pickTangle('b|c', ['a|b', 'b|c'])).toBe('b|c')
  })

  it('falls back to the oldest due tangle for no name, or a name that is not due', () => {
    // A missing key, a finished one, one left with a single live member and
    // one not due until tomorrow all fail the same test: dueTangles left them
    // out, so the session would have nothing it owes to ask.
    expect(pickTangle(null, ['a|b', 'b|c'])).toBe('a|b')
    expect(pickTangle('x|y', ['a|b', 'b|c'])).toBe('a|b')
    expect(pickTangle('', ['a|b'])).toBe('a|b')
  })

  it('is null with nothing due, named or not', () => {
    expect(pickTangle(null, [])).toBeNull()
    expect(pickTangle('a|b', [])).toBeNull()
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

describe('isFinished', () => {
  const live = new Set(['a', 'b', 'c'])

  it('is false while a member still in the library is unsettled', () => {
    expect(isFinished(stat({ settled: ['a', 'b'] }), live)).toBe(false)
    expect(isFinished(stat({ settled: [] }), live)).toBe(false)
  })

  it('is true once every member still in the library is settled, whatever happened to the deleted ones', () => {
    expect(isFinished(stat({ settled: ['a', 'b', 'c'] }), live)).toBe(true)
    expect(isFinished(stat({ members: ['a', 'b', 'gone'], settled: ['a', 'b'] }), live)).toBe(true)
    expect(isFinished(stat({ members: ['gone1', 'gone2'], settled: [] }), live)).toBe(true)
  })

  it('is true when doneOn is set, even if a word deleted and added again is a live member nobody settled', () => {
    expect(isFinished(stat({ settled: ['a', 'b'], doneOn: '2026-10-19' }), live)).toBe(true)
  })

  it('reads a doneOn that is not a string as not done, and decides by the settled list', () => {
    const odd = { ...stat({ settled: ['a'] }), doneOn: 7 } as unknown as TangleStat
    expect(isFinished(odd, live)).toBe(false)
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

  it('keeps the doneOn a finished tangle already has', () => {
    const got = applyTangleResults(stat({ settled: ['a', 'b', 'c'], doneOn: '2026-10-19' }), [], [], live, NOW)
    expect(got.doneOn).toBe('2026-10-19')
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

describe('buildTangleSession', () => {
  const mkWord = (id: string, examples: string[]): Word => ({
    id, headword: id, phonetic: `/${id}/`, meanings: [{ pos: 'v.', en: `def of ${id}`, zh: '甲' }],
    examples, synonyms: [], antonyms: [], collocations: [], relatedForms: [],
    sourceNote: 't', addedAt: '2026-07-01',
  })
  // Two clean sentences and two that carry another member, per word: a filter that is
  // dropped picks a dirty sentence on some seed below, while a working one never does.
  const corroborate = mkWord('corroborate', [
    'Two independent witnesses corroborated the account of the crash.',
    'The lab results corroborate what the nurse had suspected all week.',
    'Nothing in the logbook would corroborate or vindicate his story.',
    'She hoped a second audit would corroborate the first and substantiate her figures.',
  ])
  const vindicate = mkWord('vindicate', [
    'The final report vindicated the engineer who had raised the alarm.',
    'Years later the data vindicated her early warning.',
    'Only the recording could vindicate her, and it would also corroborate his version.',
    'A court ruling would vindicate the whole team and substantiate their claim.',
  ])
  const substantiate = mkWord('substantiate', [
    'He could not substantiate the rumour with a single document.',
    'A receipt would substantiate the refund claim.',
    'Nothing would substantiate or corroborate the claim.',
    'Only the log could substantiate her story and vindicate him.',
  ])
  const extra = mkWord('extra', ['The extra shift paid for itself.'])
  const byId = new Map([corroborate, vindicate, substantiate, extra].map((w) => [w.id, w]))
  const MEMBERS = ['corroborate', 'vindicate', 'substantiate']
  const tangle = (over: Partial<TangleStat> = {}) =>
    stat({ pairs: ['corroborate|vindicate'], members: MEMBERS, ...over })

  /** A small deterministic generator, so each seed is a different but repeatable draw. */
  const seeded = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  const SEEDS = Array.from({ length: 25 }, (_, i) => i + 1)

  it('gives a note for every member pair that has one, the confused pairs first and marked', () => {
    const notes = {
      'corroborate|vindicate': '前者是旁证，后者是平反。',
      'substantiate|vindicate': '前者是拿出证据，后者是证明无辜。',
      'corroborate|extra': 'not a member',
      'gone|vindicate': 'not in the library',
    }
    // The confused pair is the *last* member pair in member order, so only putting it first moves it.
    const got = buildTangleSession(tangle({ pairs: ['substantiate|vindicate'] }), byId, notes, seeded(1))
    expect(got.notes).toEqual([
      { key: 'substantiate|vindicate', text: notes['substantiate|vindicate'], confused: true },
      { key: 'corroborate|vindicate', text: notes['corroborate|vindicate'], confused: false },
    ])
  })

  it('marks a confused pair only when both of its words are live members of the tangle', () => {
    const notes = {
      'corroborate|vindicate': 'ok',
      'corroborate|gone': 'gone is not in the library',
      'corroborate|extra': 'extra is live but not a member',
      'substantiate|vindicate': 'a pair the user never confused',
    }
    const got = buildTangleSession(
      tangle({ pairs: ['corroborate|gone', 'corroborate|extra', 'corroborate|vindicate'] }), byId, notes, seeded(1),
    )
    expect(got.notes.map((n) => [n.key, n.confused])).toEqual([
      ['corroborate|vindicate', true],
      ['substantiate|vindicate', false],
    ])
  })

  it('asks one cloze per unsettled live member, with every live member as an option', () => {
    for (const seed of SEEDS) {
      const got = buildTangleSession(tangle({ settled: ['vindicate'] }), byId, {}, seeded(seed))
      expect(got.questions.map((q) => q.answerId)).toEqual(['corroborate', 'substantiate'])
      expect(got.autoSettled).toEqual([])
      for (const q of got.questions) {
        expect(q.prompt).toContain('___')
        // Every other member, the settled one included: all of them are on offer as options.
        for (const other of MEMBERS.filter((id) => id !== q.answerId)) {
          expect(headwordPattern(q.prompt, other), `${q.answerId} offered ${other} in: ${q.prompt}`).toBeNull()
        }
        expect([...q.options].sort()).toEqual([...MEMBERS].sort())
      }
    }
  })

  it('shuffles the options with the injected rng, so an answer has no fixed place', () => {
    const places = new Set<number>()
    for (const seed of SEEDS) {
      const q = buildTangleSession(tangle(), byId, {}, seeded(seed)).questions[0]
      places.add(q.options.indexOf(q.answerId))
    }
    expect(places.size).toBeGreaterThan(1)
  })

  it('settles by being shown a member whose every example carries another member, and asks the rest', () => {
    const crowded = mkWord('substantiate', [
      'Nothing would substantiate or corroborate the claim.',
      'Only the log could substantiate her story and vindicate him.',
    ])
    const got = buildTangleSession(tangle(), new Map(byId).set('substantiate', crowded), {}, seeded(3))
    expect(got.autoSettled).toEqual(['substantiate'])
    expect(got.questions.map((q) => q.answerId)).toEqual(['corroborate', 'vindicate'])
    // Still a member on the page and an option, only not a question: shown, so settled.
    expect(got.members.map((w) => w.id)).toEqual(MEMBERS)
    expect(got.questions[0].options).toContain('substantiate')
  })

  it('settles by being shown a member none of whose examples locates the headword', () => {
    const unlocatable = mkWord('vindicate', ['The report cleared the engineer completely.', 'Nobody doubted her afterwards.'])
    const got = buildTangleSession(tangle(), new Map(byId).set('vindicate', unlocatable), {}, seeded(3))
    expect(got.autoSettled).toEqual(['vindicate'])
    expect(got.questions.map((q) => q.answerId)).toEqual(['corroborate', 'substantiate'])
  })

  it('neither asks nor reports a member that is already settled, usable sentence or not', () => {
    const unlocatable = mkWord('vindicate', ['The report cleared the engineer completely.'])
    const got = buildTangleSession(tangle({ settled: ['vindicate'] }), new Map(byId).set('vindicate', unlocatable), {}, seeded(3))
    expect(got.autoSettled).toEqual([])
    expect(got.questions.map((q) => q.answerId)).toEqual(['corroborate', 'substantiate'])
  })

  it('leaves a member that is not in the library out of the members, the notes and the questions', () => {
    const notes = { 'corroborate|vindicate': 'ok', 'corroborate|gone': 'x', 'gone|vindicate': 'y' }
    const got = buildTangleSession(
      tangle({ members: ['corroborate', 'gone', 'vindicate', 'substantiate'], pairs: ['corroborate|gone'] }),
      byId, notes, seeded(2),
    )
    expect(got.members.map((w) => w.id)).toEqual(MEMBERS)
    expect(got.notes.map((n) => n.key)).toEqual(['corroborate|vindicate'])
    expect(got.questions.map((q) => q.answerId)).toEqual(MEMBERS)
    for (const q of got.questions) expect(q.options).not.toContain('gone')
    expect(got.autoSettled).toEqual([])
  })

  it('asks nothing and settles nothing when fewer than two members are left', () => {
    const got = buildTangleSession(tangle({ members: ['corroborate', 'gone', 'also-gone'] }), byId, {}, seeded(1))
    expect(got.members.map((w) => w.id)).toEqual(['corroborate'])
    expect(got.questions).toEqual([])
    expect(got.autoSettled).toEqual([])
  })

  it('is the same session for the same rng sequence', () => {
    const notes = { 'corroborate|vindicate': 'ok' }
    const a = buildTangleSession(tangle(), byId, notes, seeded(11))
    const b = buildTangleSession(tangle(), byId, notes, seeded(11))
    expect(b).toEqual(a)
  })

  it('reads a stat whose lists are not arrays as having none, instead of throwing', () => {
    const junk = (over: Record<string, unknown>) => ({ ...tangle(), ...over }) as unknown as TangleStat
    // A number, null and an object are not iterable, so each would throw if read as a list.
    for (const bad of [7, null, { a: 1 }, 'corroborate,vindicate']) {
      // No members: nothing to show, ask or settle.
      const noMembers = buildTangleSession(junk({ members: bad }), byId, {}, seeded(1))
      expect(noMembers).toEqual({ members: [], notes: [], questions: [], autoSettled: [] })
      // No settled list: every member is unsettled, so every member is asked.
      const noSettled = buildTangleSession(junk({ settled: bad }), byId, {}, seeded(1))
      expect(noSettled.questions.map((q) => q.answerId)).toEqual(MEMBERS)
      // No pairs: a note still shows, and none is marked as confused.
      const noPairs = buildTangleSession(junk({ pairs: bad }), byId, { 'corroborate|vindicate': 'ok' }, seeded(1))
      expect(noPairs.notes).toEqual([{ key: 'corroborate|vindicate', text: 'ok', confused: false }])
    }
  })
})

describe('tangleGroups', () => {
  const MEMBERS = ['corroborate', 'vindicate', 'substantiate']
  const group = (order: string[], extra?: string[]): SenseGroup => ({
    zh: `${order.join('/')} 的场景`, order, why: 'w', ...(extra === undefined ? {} : { extra }),
  })

  it('returns only groups whose order lies inside the members', () => {
    // The two real groups over these words (senseGroups.json): one inside the tangle, one reaching ratify.
    const inside = group(['vindicate', 'corroborate', 'substantiate'])
    const reaching = group(['substantiate', 'corroborate', 'ratify'])
    expect(tangleGroups(MEMBERS, [reaching, inside])).toEqual([inside])
  })

  it('returns a group of two inside the members, and keeps the order the groups come in', () => {
    const pair = group(['substantiate', 'vindicate'])
    const three = group(['vindicate', 'corroborate', 'substantiate'])
    expect(tangleGroups(MEMBERS, [pair, three])).toEqual([pair, three])
  })

  it('does not return a group of one, though its member is in the tangle: everything else it offers is outside it', () => {
    // Copied from senseGroups.json: corroborate alone, against outside words.
    const lone = group(['corroborate'], ['back up', 'bear out', 'cross-verify'])
    expect(tangleGroups(MEMBERS, [lone])).toEqual([])
  })

  it('returns nothing for a tangle no group fits inside', () => {
    expect(tangleGroups(['corroborate', 'ratify'], [group(MEMBERS)])).toEqual([])
    expect(tangleGroups(MEMBERS, [])).toEqual([])
  })
})
