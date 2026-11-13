import { describe, expect, it } from 'vitest'
import { pullBackIntervals } from './pull-back-intervals'
import { addDays, MAX_INTERVAL_DAYS } from '../src/lib/srs'
import type { ProgressEntry } from '../src/types'

const TODAY = '2026-11-12'

/** Local noon `daysAgo` days before TODAY, as the app would have written it. Noon keeps the local date clear of any timezone edge. */
const seen = (daysAgo: number): string => new Date(2026, 10, 12 - daysAgo, 12, 0, 0).toISOString()

const entry = (over: Partial<ProgressEntry> = {}): ProgressEntry => ({
  state: 'review', ease: 2.2, intervalDays: 60, due: addDays(TODAY, 50),
  stepIndex: 0, reps: 5, lapses: 1, lastReviewedAt: seen(10), ...over,
})

describe('pullBackIntervals', () => {
  it('returns an entry at or under the ceiling untouched, as the same object', () => {
    const atCeiling = entry({ intervalDays: MAX_INTERVAL_DAYS })
    const short = entry({ intervalDays: 8 })
    const out = pullBackIntervals({ atCeiling, short }, TODAY)
    expect(out.words.atCeiling).toBe(atCeiling)
    expect(out.words.short).toBe(short)
    expect(out.pulled).toBe(0)
  })

  it('leaves a learning-state entry alone whatever its interval says', () => {
    const relearning = entry({ state: 'learning', intervalDays: 90 })
    expect(pullBackIntervals({ relearning }, TODAY).words.relearning).toBe(relearning)
  })

  it('a word seen 10 days ago comes due 21 days after it was seen, with the interval rewritten to match', () => {
    const out = pullBackIntervals({ a: entry() }, TODAY)
    expect(out.words.a.intervalDays).toBe(MAX_INTERVAL_DAYS)
    expect(out.words.a.due).toBe(addDays(TODAY, MAX_INTERVAL_DAYS - 10))
    expect(out.pulled).toBe(1)
    expect(out.late).toBe(0)
  })

  it('never moves a due date later than it was', () => {
    // Seen 5 days ago, so the ceiling would put it 16 days out, but it was
    // already due in 3.
    const soon = entry({ lastReviewedAt: seen(5), due: addDays(TODAY, 3) })
    const out = pullBackIntervals({ soon }, TODAY)
    expect(out.words.soon.due).toBe(addDays(TODAY, 3))
    expect(out.words.soon.intervalDays).toBe(MAX_INTERVAL_DAYS)
  })

  it('spreads the words already past the ceiling from tomorrow, perDay to a day, oldest due date first', () => {
    // All five were last seen more than 21 days ago. Old due dates decide
    // the order; ids break the tie between c and d.
    const words = {
      e: entry({ lastReviewedAt: seen(30), due: addDays(TODAY, 60) }),
      d: entry({ lastReviewedAt: seen(40), due: addDays(TODAY, 40) }),
      c: entry({ lastReviewedAt: seen(25), due: addDays(TODAY, 40) }),
      b: entry({ lastReviewedAt: seen(50), due: addDays(TODAY, 30) }),
      a: entry({ lastReviewedAt: seen(22), due: addDays(TODAY, 20) }),
    }
    const out = pullBackIntervals(words, TODAY, 2)
    expect(out.late).toBe(5)
    expect(out.words.a.due).toBe(addDays(TODAY, 1))
    expect(out.words.b.due).toBe(addDays(TODAY, 1))
    expect(out.words.c.due).toBe(addDays(TODAY, 2))
    expect(out.words.d.due).toBe(addDays(TODAY, 2))
    expect(out.words.e.due).toBe(addDays(TODAY, 3))
  })

  it('does not make a late word due today: tomorrow is the first slot', () => {
    // Due today after the day's session, it would be carried over tomorrow
    // and take a new word's place (newQuota).
    const out = pullBackIntervals({ a: entry({ lastReviewedAt: seen(21) }) }, TODAY)
    expect(out.late).toBe(1)
    expect(out.words.a.due).toBe(addDays(TODAY, 1))
  })

  it('a late word whose old due date is earlier than its slot keeps the old date', () => {
    const words = {
      x: entry({ lastReviewedAt: seen(30), due: addDays(TODAY, 1) }),
      y: entry({ lastReviewedAt: seen(30), due: addDays(TODAY, 2) }),
      z: entry({ lastReviewedAt: seen(30), due: addDays(TODAY, 2) }),
      overdue: entry({ lastReviewedAt: seen(90), due: addDays(TODAY, -4) }),
    }
    const out = pullBackIntervals(words, TODAY, 1)
    // Slots run overdue, x, y, z at +1, +2, +3, +4.
    expect(out.words.overdue.due).toBe(addDays(TODAY, -4))
    expect(out.words.x.due).toBe(addDays(TODAY, 1))
    expect(out.words.y.due).toBe(addDays(TODAY, 2))
    expect(out.words.z.due).toBe(addDays(TODAY, 2))
  })

  it('moves lastReviewedAt by exactly one second, so the entry out-ranks every cached copy in mergeProgress', () => {
    const before = entry()
    const after = pullBackIntervals({ a: before }, TODAY).words.a
    expect(Date.parse(after.lastReviewedAt) - Date.parse(before.lastReviewedAt)).toBe(1000)
    expect(after.lastReviewedAt > before.lastReviewedAt).toBe(true)
  })

  it('still compares greater as a string when the old timestamp had no milliseconds', () => {
    // ISO strings compare as strings. +1ms on '…T00:00:00Z' gives
    // '…T00:00:00.001Z', which sorts BELOW the original ('.' < 'Z').
    const before = entry({ lastReviewedAt: '2026-11-02T20:00:00Z' })
    const after = pullBackIntervals({ a: before }, TODAY).words.a
    expect(after.lastReviewedAt > before.lastReviewedAt).toBe(true)
  })

  it('changes nothing but intervalDays, due and lastReviewedAt', () => {
    const before = entry({
      missedAt: '2026-11-01', demotedOn: '2026-11-01', startedOn: '2026-08-01',
      recall: { reps: 3, correct: 2, streak: 1, lastAt: '2026-11-01T00:00:00.000Z' },
      recallRating: { level: 'hard', at: '2026-10-01T00:00:00.000Z' },
      forgot: [{ at: '2026-10-25T05:02:27.646Z', kind: 'blank', prevInterval: 16, prevReviewedAt: '2026-10-08T23:35:50.275Z' }],
    })
    const after = pullBackIntervals({ a: before }, TODAY).words.a
    expect({ ...after, intervalDays: 0, due: '', lastReviewedAt: '' })
      .toEqual({ ...before, intervalDays: 0, due: '', lastReviewedAt: '' })
  })

  it('skips an entry whose lastReviewedAt cannot be read rather than guess a date for it', () => {
    const broken = entry({ lastReviewedAt: 'not a date' })
    const out = pullBackIntervals({ broken }, TODAY)
    expect(out.words.broken).toBe(broken)
    expect(out.pulled).toBe(0)
  })
})
