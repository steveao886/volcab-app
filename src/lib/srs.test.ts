import { describe, expect, it } from 'vitest'
import { addDays, clampIntervalModifier, gradeWord, MAX_INTERVAL_DAYS, todayStr } from './srs'
import type { ProgressEntry } from '../types'

const now = new Date(2026, 6, 24, 10, 0, 0) // 2026-07-24 local time
const noFuzz = () => 0.5 // fuzz factor = 1.0

const reviewEntry = (over: Partial<ProgressEntry> = {}): ProgressEntry => ({
  state: 'review', ease: 2.5, intervalDays: 10, due: '2026-07-24',
  stepIndex: 0, reps: 3, lapses: 0, lastReviewedAt: '2026-07-14T00:00:00Z', ...over,
})

describe('todayStr/addDays', () => {
  it('formats a local date', () => expect(todayStr(now)).toBe('2026-07-24'))
  it('adds days across a month boundary', () => expect(addDays('2026-07-30', 3)).toBe('2026-08-02'))
})

describe('new-word learning phase', () => {
  it('grading a new word good → advances to the next step, reappears today', () => {
    const e = gradeWord(undefined, 'good', now, noFuzz)
    expect(e.state).toBe('learning')
    expect(e.stepIndex).toBe(1)
    expect(e.due).toBe('2026-07-24')
  })
  it('finishing all steps graduates to review, with a 1-day interval', () => {
    const s1 = gradeWord(undefined, 'good', now, noFuzz)
    const s2 = gradeWord(s1, 'good', now, noFuzz)
    expect(s2.state).toBe('review')
    expect(s2.intervalDays).toBe(1)
    expect(s2.due).toBe('2026-07-25')
  })
  it('grading a new word easy → graduates immediately, with a 4-day interval', () => {
    const e = gradeWord(undefined, 'easy', now, noFuzz)
    expect(e.state).toBe('review')
    expect(e.intervalDays).toBe(4)
  })
  it('grading again while learning → resets to step 0', () => {
    const s1 = gradeWord(undefined, 'good', now, noFuzz)
    const e = gradeWord(s1, 'again', now, noFuzz)
    expect(e.stepIndex).toBe(0)
    expect(e.state).toBe('learning')
  })
})

describe('review phase', () => {
  it('good → interval × ease', () => {
    const e = gradeWord(reviewEntry(), 'good', now, noFuzz)
    expect(e.intervalDays).toBe(25)
    expect(e.due).toBe(addDays('2026-07-24', 25))
  })
  it('hard → interval ×1.2, ease −0.15', () => {
    const e = gradeWord(reviewEntry(), 'hard', now, noFuzz)
    expect(e.intervalDays).toBe(12)
    expect(e.ease).toBeCloseTo(2.35)
  })
  it('easy → interval × ease×1.3, ease +0.15', () => {
    const e = gradeWord(reviewEntry(), 'easy', now, noFuzz)
    expect(e.ease).toBeCloseTo(2.65)
    expect(e.intervalDays).toBe(Math.round(10 * 2.65 * 1.3))
  })
  it('again → lapse+1, ease −0.2, back to the learning phase due today', () => {
    const e = gradeWord(reviewEntry(), 'again', now, noFuzz)
    expect(e.lapses).toBe(1)
    expect(e.ease).toBeCloseTo(2.3)
    expect(e.state).toBe('learning')
    expect(e.due).toBe('2026-07-24')
  })
  it('ease never drops below 1.3', () => {
    const e = gradeWord(reviewEntry({ ease: 1.3 }), 'hard', now, noFuzz)
    expect(e.ease).toBe(1.3)
  })
  it('interval caps at 365 days', () => {
    const e = gradeWord(reviewEntry({ intervalDays: 300, ease: 2.5 }), 'good', now, noFuzz)
    expect(e.intervalDays).toBe(365)
  })
  it('interval advances by at least 1 day', () => {
    const e = gradeWord(reviewEntry({ intervalDays: 1, ease: 1.3 }), 'hard', now, noFuzz)
    expect(e.intervalDays).toBeGreaterThanOrEqual(2)
  })
})

describe('intervalModifier', () => {
  it('defaults to no change at all, so an unset setting behaves exactly as before', () => {
    const base = gradeWord(reviewEntry(), 'good', now, noFuzz)
    expect(gradeWord(reviewEntry(), 'good', now, noFuzz, 1).intervalDays).toBe(base.intervalDays)
    expect(gradeWord(reviewEntry(), 'good', now, noFuzz, undefined as unknown as number).intervalDays)
      .toBe(base.intervalDays)
  })

  it('stretches the review interval', () => {
    const plain = gradeWord(reviewEntry(), 'good', now, noFuzz).intervalDays
    const stretched = gradeWord(reviewEntry(), 'good', now, noFuzz, 1.3).intervalDays
    expect(stretched).toBeGreaterThan(plain)
    expect(stretched).toBe(Math.round(plain * 1.3))
  })

  it('compounds across reviews — five at 1.3 is far more than 30% longer', () => {
    // Started from a one-day interval on purpose: from a longer one both
    // sides run into MAX_INTERVAL_DAYS within five reviews and the ratio
    // collapses back to 1, which would make this assertion meaningless.
    let plain = reviewEntry({ intervalDays: 1 }), stretched = reviewEntry({ intervalDays: 1 })
    for (let i = 0; i < 5; i++) {
      plain = gradeWord(plain, 'good', now, noFuzz)
      stretched = gradeWord(stretched, 'good', now, noFuzz, 1.3)
    }
    expect(plain.intervalDays).toBeLessThan(MAX_INTERVAL_DAYS)
    expect(stretched.intervalDays).toBeLessThan(MAX_INTERVAL_DAYS)
    expect(stretched.intervalDays / plain.intervalDays).toBeGreaterThan(2.5)
  })

  it('never lets an interval stand still, even below 1', () => {
    const e = gradeWord(reviewEntry({ intervalDays: 10 }), 'good', now, noFuzz, 0.5)
    expect(e.intervalDays).toBeGreaterThan(10)
  })

  it('leaves ease alone — it is a schedule knob, not a difficulty estimate', () => {
    expect(gradeWord(reviewEntry(), 'good', now, noFuzz, 2).ease).toBe(reviewEntry().ease)
  })

  it('does not touch the graduating intervals, which belong to the learning steps', () => {
    expect(gradeWord(undefined, 'easy', now, noFuzz, 3).intervalDays)
      .toBe(gradeWord(undefined, 'easy', now, noFuzz).intervalDays)
  })

  it('clamps garbage instead of throwing — it arrives from a synced settings blob', () => {
    expect(clampIntervalModifier(undefined)).toBe(1)
    expect(clampIntervalModifier(Number.NaN)).toBe(1)
    expect(clampIntervalModifier(99)).toBe(3)
    expect(clampIntervalModifier(0)).toBe(0.5)
    expect(clampIntervalModifier(1.3)).toBe(1.3)
  })
})
