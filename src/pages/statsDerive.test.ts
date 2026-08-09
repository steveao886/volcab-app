import { describe, expect, it } from 'vitest'
import { emptyProgress, emptyStat } from '../types'
import type { Progress, Word } from '../types'
import {
  accuracySeries, accuracyStats, agoLabel, cumulativeTotals, dailySeries, dueForecast, forecastLabel,
  masteryBreakdown, modeAccuracy, modeOverview, recommendMode, retentionStats, shortDate,
  usageCoverage, windowSummary,
} from './statsDerive'
import type { DayPoint } from './statsDerive'

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

describe('windowSummary', () => {
  const day = (date: string, reviewed: number, newLearned = 0): DayPoint =>
    ({ date, reviewed, newLearned, correct: reviewed })

  it('totals the window and names the busiest day', () => {
    const s = windowSummary([day('2026-07-23', 4, 1), day('2026-07-24', 0), day('2026-07-25', 9, 3)])
    expect(s).toMatchObject({ reviewed: 13, newLearned: 4, activeDays: 2 })
    expect(s.peak?.date).toBe('2026-07-25')
  })

  it('a tie keeps the earlier day — the peak names when it first happened', () => {
    expect(windowSummary([day('2026-07-23', 7), day('2026-07-24', 7)]).peak?.date).toBe('2026-07-23')
  })

  it('an all-zero window has no peak at all, rather than a 0-review "busiest day"', () => {
    expect(windowSummary([day('2026-07-24', 0), day('2026-07-25', 0)]).peak).toBeNull()
  })
})

describe('accuracyStats', () => {
  const day = (date: string, reviewed: number, correct: number): DayPoint =>
    ({ date, reviewed, correct, newLearned: 0 })

  it('the average is weighted by review count, not the mean of the daily rates', () => {
    // Unweighted this would be (100% + 50%) / 2 = 75%; weighted it is 51/100.
    const s = accuracyStats([day('2026-07-24', 2, 2), day('2026-07-25', 98, 49)])
    expect(s.average).toBeCloseTo(0.51)
  })

  it('best / worst / latest ignore days with no review', () => {
    const s = accuracyStats([day('2026-07-23', 10, 9), day('2026-07-24', 0, 0), day('2026-07-25', 10, 5)])
    expect(s.best?.date).toBe('2026-07-23')
    expect(s.worst?.date).toBe('2026-07-25')
    expect(s.latest?.date).toBe('2026-07-25')
    expect(s.ratedDays).toBe(2)
  })

  it('ties go to the later day, so the number quoted is the recent one', () => {
    const s = accuracyStats([day('2026-07-24', 4, 4), day('2026-07-25', 8, 8)])
    expect(s.best?.date).toBe('2026-07-25')
  })

  it('a window with no reviews gives null, not NaN or 0%', () => {
    const s = accuracyStats([day('2026-07-25', 0, 0)])
    expect(s).toMatchObject({ average: null, best: null, worst: null, latest: null, ratedDays: 0 })
  })
})

describe('dueForecast', () => {
  const scheduled = (due: string, state: 'learning' | 'review' = 'review') => ({
    state, ease: 2.5, intervalDays: 3, due, stepIndex: 0, reps: 2, lapses: 0, lastReviewedAt: '2026-07-20T00:00:00Z',
  })

  it('the first bucket absorbs overdue words — that is the pile you face today', () => {
    const words = [w('a'), w('b'), w('c')]
    const p = emptyProgress()
    p.words['a'] = scheduled('2026-07-20')   // overdue
    p.words['b'] = scheduled('2026-07-25')   // today
    p.words['c'] = scheduled('2026-07-26')   // tomorrow
    const f = dueForecast(words, p, '2026-07-25', 3)
    expect(f.days).toEqual([
      { date: '2026-07-25', count: 2 },
      { date: '2026-07-26', count: 1 },
      { date: '2026-07-27', count: 0 },
    ])
  })

  it('words scheduled past the window are counted as beyond, not folded into the last day', () => {
    const p = emptyProgress()
    p.words['a'] = scheduled('2026-09-01')
    const f = dueForecast([w('a')], p, '2026-07-25', 3)
    expect(f.days.every(d => d.count === 0)).toBe(true)
    expect(f).toMatchObject({ beyond: 1, total: 1 })
  })

  it('new and unlearned words are not scheduled, matching buildQueue', () => {
    const p = emptyProgress()
    p.words['a'] = { ...scheduled('2026-07-25'), state: 'new' as const }
    const f = dueForecast([w('a'), w('b')], p, '2026-07-25', 3)   // b has no record at all
    expect(f.total).toBe(0)
  })

  it('a word in progress whose id is gone from the library is not counted', () => {
    const p = emptyProgress()
    p.words['deleted'] = scheduled('2026-07-25')
    expect(dueForecast([w('a')], p, '2026-07-25', 3).total).toBe(0)
  })
})

// The strugglingSummary suite stood here. It only ever tested that the
// wrapper passed rankStrugglingWords' output through — the ranking rules
// themselves (ease as the entry condition, both exits, the ordering) are
// covered in lib/queue.test.ts and are unaffected by the card's removal.

describe('forecastLabel / shortDate', () => {
  it('names the two days that have names, weekday for the rest', () => {
    expect(forecastLabel('2026-07-25', '2026-07-25')).toBe('今天')
    expect(forecastLabel('2026-07-26', '2026-07-25')).toBe('明天')
    // 2026-07-27 is a Monday
    expect(forecastLabel('2026-07-27', '2026-07-25')).toBe('周一')
  })

  it('the weekday is read in local time — UTC parsing would shift every label by a day', () => {
    expect(forecastLabel('2026-08-02', '2026-07-25')).toBe('周日')
  })

  it('shortDate drops the year', () => {
    expect(shortDate('2026-07-05')).toBe('7/5')
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

describe('modeAccuracy', () => {
  const stat = (quizModes: NonNullable<Progress['dailyStats'][string]['quizModes']>) =>
    ({ reviewed: 0, newLearned: 0, correct: 0, quizTaken: 1, quizModes })

  it('sums each mode across days and never blends them together', () => {
    const p = prog({
      '2026-07-24': stat({ recall: { asked: 10, correct: 4 }, contrast: { asked: 10, correct: 9 } }),
      '2026-07-25': stat({ recall: { asked: 10, correct: 6 } }),
    })
    const rows = modeAccuracy(p)
    expect(rows.map(r => r.mode)).toEqual(['recall', 'contrast'])   // most-asked first
    expect(rows[0]).toMatchObject({ label: '回想', asked: 20, correct: 10, rate: 0.5 })
    expect(rows[1]).toMatchObject({ label: '辨析', asked: 10, correct: 9, rate: 0.9 })
  })

  it('omits a mode never played — no data is a different claim from no success', () => {
    const rows = modeAccuracy(prog({ '2026-07-25': stat({ recall: { asked: 4, correct: 2 } }) }))
    expect(rows.map(r => r.mode)).toEqual(['recall'])
  })

  it('days recorded before the field existed contribute nothing, and are not back-filled into mixed', () => {
    const p = prog({ '2026-07-24': { reviewed: 8, newLearned: 0, correct: 7, quizTaken: 3 } })
    expect(modeAccuracy(p)).toEqual([])
  })

  it('an unknown mode key from a newer build is skipped, not rendered as a blank row', () => {
    const p = prog({ '2026-07-25': stat({ recall: { asked: 5, correct: 5 }, telepathy: { asked: 9, correct: 9 } }) })
    expect(modeAccuracy(p).map(r => r.mode)).toEqual(['recall'])
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
    expect(t.totalQuizzes).toBe(1)
  })

  it('quizzes taken on a day with no review still count', () => {
    const t = cumulativeTotals(prog({ '2026-07-25': { reviewed: 0, newLearned: 0, correct: 0, quizTaken: 2 } }))
    expect(t).toMatchObject({ totalReviewed: 0, activeDays: 0, totalQuizzes: 2 })
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

describe('retentionStats', () => {
  it('sums only the scheduled-review counters, ignoring total card views', () => {
    const p = prog({
      '2026-07-24': { reviewed: 40, newLearned: 8, correct: 36, quizTaken: 0, reviewPhase: 10, reviewPhaseCorrect: 10 },
      '2026-07-25': { reviewed: 30, newLearned: 6, correct: 25, quizTaken: 0, reviewPhase: 10, reviewPhaseCorrect: 9 },
    })
    const r = retentionStats(p, '2026-07-25', 2)
    expect(r).toMatchObject({ reviewed: 20, correct: 19 })
    expect(r.rate).toBeCloseTo(0.95)
    // The headline accuracy over the same days is 61/70 = 87%; retention is
    // 95%. Conflating them is what sent the interval tuning the wrong way.
  })

  it('days recorded before the measurement existed contribute nothing, rather than counting as zero', () => {
    const p = prog({ '2026-07-25': { reviewed: 20, newLearned: 4, correct: 18, quizTaken: 0 } })
    expect(retentionStats(p, '2026-07-25', 1)).toEqual({ reviewed: 0, correct: 0, rate: null })
  })

  it('a window with no scheduled reviews gives null, not 0%', () => {
    expect(retentionStats(emptyProgress(), '2026-07-25', 30).rate).toBeNull()
  })
})

/** Progress whose dailyStats carry only quizModes tallies. */
const progWithModes = (
  days: Record<string, Record<string, { asked: number; correct: number }>>,
): Progress => {
  const p = emptyProgress()
  for (const [date, quizModes] of Object.entries(days)) {
    p.dailyStats[date] = { ...emptyStat(), quizModes }
  }
  return p
}

describe('modeOverview', () => {
  it('returns all seven modes in fixed key order, played or not', () => {
    const rows = modeOverview(emptyProgress())
    expect(rows.map(r => r.mode)).toEqual(['mixed', 'recall', 'contrast', 'audio', 'sprint', 'passage', 'guess'])
    expect(rows[0]).toMatchObject({ asked: 0, correct: 0, rate: null, lastPlayed: null })
  })

  it('aggregates across days and keeps the most recent date as lastPlayed', () => {
    const rows = modeOverview(progWithModes({
      '2026-08-01': { audio: { asked: 10, correct: 6 } },
      '2026-08-05': { audio: { asked: 10, correct: 7 } },
    }))
    const audio = rows.find(r => r.mode === 'audio')
    expect(audio).toMatchObject({ asked: 20, correct: 13, lastPlayed: '2026-08-05' })
    expect(audio?.rate).toBeCloseTo(0.65)
  })

  it('rate stays null below the accuracy floor', () => {
    const rows = modeOverview(progWithModes({ '2026-08-01': { recall: { asked: 9, correct: 9 } } }))
    expect(rows.find(r => r.mode === 'recall')).toMatchObject({ asked: 9, rate: null })
  })

  it('ignores unknown metric keys from newer builds', () => {
    const rows = modeOverview(progWithModes({ '2026-08-01': { newfangled: { asked: 50, correct: 50 } } }))
    expect(rows.every(r => r.asked === 0)).toBe(true)
  })
})

describe('recommendMode', () => {
  it('picks the lowest printable accuracy', () => {
    const rows = modeOverview(progWithModes({
      '2026-08-01': { mixed: { asked: 20, correct: 18 }, audio: { asked: 20, correct: 12 } },
    }))
    expect(recommendMode(rows)).toBe('audio')
  })

  it('needs evidence: null when no mode clears the floor', () => {
    const rows = modeOverview(progWithModes({ '2026-08-01': { audio: { asked: 5, correct: 0 } } }))
    expect(recommendMode(rows)).toBeNull()
  })

  it('ties keep the earlier fixed-order mode so the badge cannot flicker', () => {
    const rows = modeOverview(progWithModes({
      '2026-08-01': { recall: { asked: 10, correct: 6 }, audio: { asked: 10, correct: 6 } },
    }))
    expect(recommendMode(rows)).toBe('recall')
  })
})

describe('agoLabel', () => {
  it('names the near days and counts the rest', () => {
    expect(agoLabel(null, '2026-08-07')).toBe('未练过')
    expect(agoLabel('2026-08-07', '2026-08-07')).toBe('今天')
    expect(agoLabel('2026-08-06', '2026-08-07')).toBe('昨天')
    expect(agoLabel('2026-08-02', '2026-08-07')).toBe('5 天前')
  })
})
