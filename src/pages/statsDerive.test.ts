import { describe, expect, it } from 'vitest'
import { emptyProgress } from '../types'
import type { Progress, Word } from '../types'
import { accuracySeries, cumulativeTotals, dailySeries, masteryBreakdown, usageCoverage } from './statsDerive'

const w = (id: string): Word => ({
  id, headword: id, phonetic: '/x/', meanings: [{ pos: 'v.', en: 'x', zh: 'x' }],
  examples: ['a', 'b'], synonyms: [], antonyms: [], collocations: [],
  relatedForms: [], sourceNote: 'manual', addedAt: '2026-07-01',
})
const entry = (state: 'learning' | 'review') => ({
  state, ease: 2.5, intervalDays: 1, due: '2026-07-25',
  stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-25T00:00:00Z',
})

const prog = (stats: Progress['dailyStats']): Progress => ({ ...emptyProgress(), dailyStats: stats })

describe('dailySeries', () => {
  it('fills in a continuous run of dates, missing days recorded as 0', () => {
    const s = dailySeries(prog({ '2026-07-25': { reviewed: 5, newLearned: 2, correct: 4, quizTaken: 0 } }), '2026-07-25', 3)
    expect(s.map(d => d.date)).toEqual(['2026-07-23', '2026-07-24', '2026-07-25'])
    expect(s.map(d => d.reviewed)).toEqual([0, 0, 5])
  })
  it('empty progress returns all zeros rather than an empty array', () => {
    const s = dailySeries(emptyProgress(), '2026-07-25', 2)
    expect(s).toHaveLength(2)
    expect(s.every(d => d.reviewed === 0)).toBe(true)
  })
})

describe('accuracySeries', () => {
  it('accuracy = correct / reviewed', () => {
    const s = accuracySeries(prog({ '2026-07-25': { reviewed: 10, newLearned: 0, correct: 8, quizTaken: 0 } }), '2026-07-25', 1)
    expect(s[0].accuracy).toBeCloseTo(0.8)
  })
  it('accuracy is null on a day with no review, not 0 and not NaN', () => {
    const s = accuracySeries(emptyProgress(), '2026-07-25', 1)
    expect(s[0].accuracy).toBeNull()
  })
})

describe('masteryBreakdown', () => {
  it('counts the three bands new/learning/review, with no record treated as new', () => {
    const words = [w('a'), w('b'), w('c')]
    const p = emptyProgress()
    p.words['a'] = entry('learning')
    p.words['b'] = entry('review')
    expect(masteryBreakdown(words, p)).toEqual({ new: 1, learning: 1, review: 1, total: 3 })
  })
  it('an empty library doesn\'t cause division by zero', () => {
    expect(masteryBreakdown([], emptyProgress())).toEqual({ new: 0, learning: 0, review: 0, total: 0 })
  })
})

describe('cumulativeTotals', () => {
  it('cumulative review count and average new words per day', () => {
    const p = prog({
      '2026-07-24': { reviewed: 10, newLearned: 4, correct: 9, quizTaken: 1 },
      '2026-07-25': { reviewed: 6, newLearned: 2, correct: 5, quizTaken: 0 },
    })
    const t = cumulativeTotals(p)
    expect(t.totalReviewed).toBe(16)
    expect(t.activeDays).toBe(2)
    expect(t.avgNewPerActiveDay).toBeCloseTo(3)
  })
  it('the average is 0, not NaN, when there\'s no data', () => {
    expect(cumulativeTotals(emptyProgress()).avgNewPerActiveDay).toBe(0)
  })
})

describe('usageCoverage', () => {
  const uw = (id: string, usageScore?: number): Word => ({
    id, headword: id, phonetic: '/x/', meanings: [{ pos: 'n.', en: 'x', zh: 'x' }],
    examples: ['a', 'b'], synonyms: [], antonyms: [], collocations: [], relatedForms: [],
    sourceNote: 't', addedAt: '2026-07-01', ...(usageScore === undefined ? {} : { usageScore }),
  })
  const withStates = (spec: Record<string, 'new' | 'learning' | 'review'>): Progress => {
    const p = emptyProgress()
    for (const [id, state] of Object.entries(spec)) {
      p.words[id] = { state, ease: 2.5, intervalDays: 5, due: '2026-08-01', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-20T00:00:00Z' }
    }
    return p
  }

  it('buckets into the three bands 7–10 / 5–6 / 1–4', () => {
    const words = [uw('a', 10), uw('b', 7), uw('c', 6), uw('d', 5), uw('e', 4), uw('f', 1)]
    const c = usageCoverage(words, emptyProgress())
    expect(c.bands.map(b => [b.label, b.total])).toEqual([['最常用', 2], ['常见', 2], ['少见', 2]])
  })

  it('"mastered" = state is review, the same definition as reviewProgress', () => {
    const words = [uw('a', 9), uw('b', 9), uw('c', 9)]
    const c = usageCoverage(words, withStates({ a: 'review', b: 'learning', c: 'new' }))
    expect(c.bands[0]).toMatchObject({ mastered: 1, total: 3 })
  })

  it('the headline takes the most-common-words band', () => {
    const words = [uw('a', 8), uw('b', 8), uw('c', 2)]
    const c = usageCoverage(words, withStates({ a: 'review', c: 'review' }))
    expect(c.headline).toEqual({ mastered: 1, total: 2, ratio: 0.5 })
  })

  it('words missing a usageScore go into no band — otherwise the denominator would inflate out of nowhere and dilute the mastery rate', () => {
    const words = [uw('scored', 9), uw('unscored')]
    const c = usageCoverage(words, withStates({ scored: 'review', unscored: 'review' }))
    expect(c.bands.reduce((s, b) => s + b.total, 0)).toBe(1)
    expect(c.headline).toEqual({ mastered: 1, total: 1, ratio: 1 })
  })

  it('ratio is recorded as 0, not NaN, when a band has no words at all', () => {
    const c = usageCoverage([uw('a', 3)], emptyProgress())
    expect(c.headline).toEqual({ mastered: 0, total: 0, ratio: 0 })
  })

  it('an empty library doesn\'t blow up', () => {
    expect(usageCoverage([], emptyProgress()).headline.ratio).toBe(0)
  })
})
