import { describe, expect, it } from 'vitest'
import { computeStreak, longestStreak, reviewProgress } from './todayStats'
import { emptyProgress, emptyStat } from '../types'
import type { DailyStat, Progress, Word } from '../types'

const stat = (reviewed: number): DailyStat => ({ ...emptyStat(), reviewed })

const word = (id: string): Word => ({
  id, headword: id, phonetic: '/x/', meanings: [{ pos: 'n.', en: 'x', zh: 'x' }],
  examples: ['a', 'b'], synonyms: [], antonyms: [], collocations: [], relatedForms: [], sourceNote: 't', addedAt: '2026-07-01',
})

describe('longestStreak', () => {
  it('empty dailyStats → 0', () => {
    expect(longestStreak({})).toBe(0)
  })

  it('takes the longest run, not the most recent one', () => {
    expect(longestStreak({
      '2026-07-01': stat(1), '2026-07-02': stat(1), '2026-07-03': stat(1), '2026-07-04': stat(1),
      // gap
      '2026-07-20': stat(1), '2026-07-21': stat(1),
    })).toBe(4)
  })

  it('a day with reviewed=0 breaks the run instead of being skipped over', () => {
    expect(longestStreak({
      '2026-07-01': stat(1), '2026-07-02': stat(0), '2026-07-03': stat(1),
    })).toBe(1)
  })

  it('counts across a month boundary rather than resetting on the 1st', () => {
    expect(longestStreak({
      '2026-07-30': stat(1), '2026-07-31': stat(1), '2026-08-01': stat(1),
    })).toBe(3)
  })
})

describe('computeStreak', () => {
  it('empty dailyStats → 0', () => {
    expect(computeStreak({}, '2026-07-25')).toBe(0)
  })

  it('only today has been reviewed → 1', () => {
    const stats = { '2026-07-25': stat(3) }
    expect(computeStreak(stats, '2026-07-25')).toBe(1)
  })

  it('today hasn\'t been reviewed yet, but yesterday and the day before were → not a broken streak, counted from yesterday as 2', () => {
    const stats = {
      '2026-07-24': stat(2),
      '2026-07-23': stat(1),
      // 2026-07-25 (today) is missing, treated as 0, but shouldn't break the streak — should count from yesterday
    }
    expect(computeStreak(stats, '2026-07-25')).toBe(2)
  })

  it('a gap appears two days ago → truncated at the gap, earlier records don\'t count', () => {
    const stats = {
      '2026-07-25': stat(1), // today
      '2026-07-24': stat(1), // yesterday
      // 2026-07-23 missing — the gap
      '2026-07-22': stat(5), // a record exists before the gap, but shouldn't be counted
    }
    expect(computeStreak(stats, '2026-07-25')).toBe(2)
  })

  it('a day present in the map but with reviewed:0 → equivalent to a gap, truncates the count', () => {
    const stats = {
      '2026-07-25': stat(1),
      '2026-07-24': stat(1),
      '2026-07-23': stat(0), // explicitly recorded as 0, not missing
      '2026-07-22': stat(9),
    }
    expect(computeStreak(stats, '2026-07-25')).toBe(2)
  })

  it('counts correctly across a month boundary', () => {
    const stats = {
      '2026-08-02': stat(1), // today
      '2026-08-01': stat(1),
      '2026-07-31': stat(1),
      '2026-07-30': stat(1),
      // 2026-07-29 missing — the gap
    }
    expect(computeStreak(stats, '2026-08-02')).toBe(4)
  })
})

describe('reviewProgress', () => {
  it('a normal ratio: word count in review state / total word count', () => {
    const words = ['alpha', 'bravo', 'carol', 'delta', 'echo'].map(word)
    const progress: Progress = emptyProgress()
    progress.words['alpha'] = { state: 'review', ease: 2.5, intervalDays: 10, due: '2026-08-01', stepIndex: 0, reps: 3, lapses: 0, lastReviewedAt: '2026-07-01T00:00:00Z' }
    progress.words['bravo'] = { state: 'review', ease: 2.5, intervalDays: 5, due: '2026-07-30', stepIndex: 0, reps: 2, lapses: 0, lastReviewedAt: '2026-07-01T00:00:00Z' }
    progress.words['carol'] = { state: 'learning', ease: 2.5, intervalDays: 0, due: '2026-07-25', stepIndex: 1, reps: 1, lapses: 0, lastReviewedAt: '2026-07-25T00:00:00Z' }
    expect(reviewProgress(words, progress)).toEqual({ count: 2, total: 5, ratio: 0.4 })
  })

  it('everything is new (progress.words is empty) → count 0, ratio 0', () => {
    const words = ['alpha', 'bravo'].map(word)
    expect(reviewProgress(words, emptyProgress())).toEqual({ count: 0, total: 2, ratio: 0 })
  })

  it('an empty library → {count:0, total:0, ratio:0}, no NaN produced', () => {
    const result = reviewProgress([], emptyProgress())
    expect(result).toEqual({ count: 0, total: 0, ratio: 0 })
    expect(Number.isNaN(result.ratio)).toBe(false)
  })
})
