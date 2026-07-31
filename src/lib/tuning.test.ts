import { describe, expect, it } from 'vitest'
import {
  loadInputs, MIN_LOAD_DAYS, MIN_RETENTION_SAMPLE,
  recommendIntervalModifier, recommendNewPerDay, retentionWindowDays,
} from './tuning'
import type { LoadInputs } from './tuning'
import { emptyProgress } from '../types'
import type { Word } from '../types'

const word = (id: string): Word => ({
  id, headword: id, phonetic: '/x/', meanings: [{ pos: 'v.', en: 'x', zh: 'x' }],
  examples: ['a', 'b'], synonyms: [], antonyms: [], collocations: [],
  relatedForms: [], sourceNote: 'manual', addedAt: '2026-07-01',
})

describe('recommendIntervalModifier', () => {
  it('refuses to advise below the sample threshold, however lopsided the result looks', () => {
    // 20/20 is 100% retention and the arithmetic would demand a huge jump.
    const a = recommendIntervalModifier(20, 20, 1)
    expect(a).toEqual({ kind: 'insufficient', reviewed: 20, needed: MIN_RETENTION_SAMPLE })
  })

  it('says nothing needs changing when retention is already on target', () => {
    const a = recommendIntervalModifier(180, 200, 1)   // 90%
    expect(a.kind).toBe('ok')
  })

  it('lengthens intervals when retention runs above target', () => {
    const a = recommendIntervalModifier(195, 200, 1)   // 97.5%
    expect(a.kind).toBe('adjust')
    if (a.kind !== 'adjust') return
    expect(a.to).toBeGreaterThan(a.from)
  })

  it('shortens them when retention runs below target', () => {
    const a = recommendIntervalModifier(150, 200, 1.5)  // 75%
    expect(a.kind).toBe('adjust')
    if (a.kind !== 'adjust') return
    expect(a.to).toBeLessThan(a.from)
  })

  it('never moves more than 30% in one step, however extreme the arithmetic', () => {
    // At 97.8% the multiplier that lands on 90% is about 4.7x. Acting on that
    // off a few hundred reviews is exactly what the damping exists to stop.
    const a = recommendIntervalModifier(1955, 2000, 1)
    if (a.kind !== 'adjust') throw new Error('expected an adjustment')
    expect(a.to).toBeLessThanOrEqual(1.3)
    expect(a.to).toBeGreaterThan(1)
  })

  it('a perfect score is handled as the maximum step, not as infinity', () => {
    const a = recommendIntervalModifier(200, 200, 1)
    if (a.kind !== 'adjust') throw new Error('expected an adjustment')
    expect(Number.isFinite(a.to)).toBe(true)
    expect(a.to).toBe(1.3)
  })

  it('respects the setting bounds, so it never advises a value that cannot be saved', () => {
    const high = recommendIntervalModifier(1990, 2000, 3)
    expect(high.kind).toBe('ok')            // already at the ceiling, nothing to suggest
    const low = recommendIntervalModifier(1000, 2000, 0.5)
    expect(low.kind).toBe('ok')             // already at the floor
  })

  it('an unset modifier is read as 1, the same as everywhere else', () => {
    const a = recommendIntervalModifier(195, 200, undefined)
    if (a.kind !== 'adjust') throw new Error('expected an adjustment')
    expect(a.from).toBe(1)
  })
})

describe('recommendNewPerDay', () => {
  const load = (over: Partial<LoadInputs> = {}): LoadInputs =>
    ({ sustained: 60, activeDays: 14, duePerDay: 30, unlearned: 100, ...over })

  it('refuses to advise before there is a fortnight of habit to compare against', () => {
    const a = recommendNewPerDay(16, load({ activeDays: 3 }))
    expect(a).toEqual({ kind: 'insufficient', activeDays: 3, needed: MIN_LOAD_DAYS })
  })

  it('says nothing when the projected load already matches what is being sustained', () => {
    // 30 due + 15 new x 2 grades = 60, exactly the sustained volume.
    expect(recommendNewPerDay(15, load()).kind).toBe('ok')
  })

  it('advises fewer new words when the projection outruns the habit', () => {
    const a = recommendNewPerDay(40, load())
    expect(a.kind).toBe('adjust')
    if (a.kind !== 'adjust') return
    expect(a.to).toBeLessThan(40)
    expect(a.projected).toBeGreaterThan(a.sustained)
  })

  it('advises more when there is room and words left to learn', () => {
    const a = recommendNewPerDay(2, load())
    expect(a.kind).toBe('adjust')
    if (a.kind !== 'adjust') return
    expect(a.to).toBeGreaterThan(2)
  })

  it('never advises learning more words than the library still has', () => {
    const a = recommendNewPerDay(2, load({ unlearned: 3 }))
    if (a.kind !== 'adjust') throw new Error('expected an adjustment')
    expect(a.to).toBeLessThanOrEqual(5)
  })

  it('says nothing at all once every word has been started', () => {
    expect(recommendNewPerDay(16, load({ unlearned: 0 }))).toEqual({ kind: 'exhausted' })
  })

  it('stays inside the range the setting accepts', () => {
    const a = recommendNewPerDay(50, load({ sustained: 5, duePerDay: 40 }))
    if (a.kind !== 'adjust') throw new Error('expected an adjustment')
    expect(a.to).toBeGreaterThanOrEqual(1)
    expect(a.to).toBeLessThanOrEqual(50)
  })

  it('tolerates a small mismatch rather than nagging about noise', () => {
    // 30 due + 16 x 2 = 62 against 60 sustained: 3% over, not worth a badge.
    expect(recommendNewPerDay(16, load()).kind).toBe('ok')
  })
})

describe('loadInputs', () => {
  it('averages over active days only — a day off is not evidence of a smaller appetite', () => {
    const l = loadInputs([], emptyProgress(), [{ reviewed: 100 }, { reviewed: 0 }, { reviewed: 50 }], [10, 20])
    expect(l.sustained).toBe(75)
    expect(l.activeDays).toBe(2)
    expect(l.duePerDay).toBe(15)
  })

  it('counts words with no record, and words still marked new, as unlearned', () => {
    const p = emptyProgress()
    p.words['started'] = { state: 'review', ease: 2.5, intervalDays: 5, due: '2026-08-01', stepIndex: 0, reps: 3, lapses: 0, lastReviewedAt: '2026-07-30T00:00:00Z' }
    p.words['untouched'] = { ...p.words['started'], state: 'new' }
    const l = loadInputs([word('started'), word('untouched'), word('norecord')], p, [{ reviewed: 1 }], [1])
    expect(l.unlearned).toBe(2)
  })

  it('an empty history gives zeros rather than NaN', () => {
    const l = loadInputs([], emptyProgress(), [], [])
    expect(l).toMatchObject({ sustained: 0, activeDays: 0, duePerDay: 0, unlearned: 0 })
  })
})

describe('retentionWindowDays', () => {
  it('reads the whole window when the modifier has never been touched', () => {
    expect(retentionWindowDays(null, '2026-07-31', 30)).toBe(30)
  })

  it('collapses to nothing on the day the modifier changes', () => {
    // This is the point: right after a change there is no evidence about the
    // new setting, so the advice must go quiet rather than repeat itself.
    expect(retentionWindowDays('2026-07-31', '2026-07-31', 30)).toBe(0)
  })

  it('grows a day at a time as the new setting gets tested', () => {
    expect(retentionWindowDays('2026-07-25', '2026-07-31', 30)).toBe(6)
  })

  it('never exceeds the maximum the caller asked for', () => {
    expect(retentionWindowDays('2026-01-01', '2026-07-31', 30)).toBe(30)
  })

  it('an unparseable marker falls back to the full window rather than silencing the advice forever', () => {
    expect(retentionWindowDays('not-a-date', '2026-07-31', 30)).toBe(30)
  })

  it('a marker in the future clamps to zero instead of going negative', () => {
    expect(retentionWindowDays('2026-08-10', '2026-07-31', 30)).toBe(0)
  })
})
