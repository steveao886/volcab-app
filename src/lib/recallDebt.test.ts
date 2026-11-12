import { describe, expect, it } from 'vitest'
import { hasRecallDebt, maskGloss, maskHeadword, owedRecallWords, recallDebtDue, recallDebtOverdue, reviewsReversed } from './recallDebt'
import type { Progress, ProgressEntry, RecallStat } from '../types'

// Local noon, so todayStr(new Date(lastAt)) is the same day in any timezone.
const at = (day: string) => new Date(`${day}T12:00:00`).toISOString()

const entry = (recall: RecallStat | undefined, over: Partial<ProgressEntry> = {}): ProgressEntry => ({
  state: 'review', ease: 2.5, intervalDays: 30, due: '2026-11-11', stepIndex: 0, reps: 5, lapses: 0,
  lastReviewedAt: at('2026-10-12'), recall, ...over,
})

const stat = (reps: number, correct: number, streak: number, day: string): RecallStat =>
  ({ reps, correct, streak, lastAt: at(day) })

describe('hasRecallDebt', () => {
  it('owes after a miss until three right in a row', () => {
    expect(hasRecallDebt(entry(stat(1, 0, 0, '2026-11-01')))).toBe(true)
    expect(hasRecallDebt(entry(stat(3, 2, 2, '2026-11-01')))).toBe(true)
    expect(hasRecallDebt(entry(stat(4, 3, 3, '2026-11-01')))).toBe(false)
  })

  it('owes nothing when never missed, never asked, or still new', () => {
    expect(hasRecallDebt(entry(stat(2, 2, 2, '2026-11-01')))).toBe(false)
    expect(hasRecallDebt(entry(undefined))).toBe(false)
    expect(hasRecallDebt(undefined)).toBe(false)
    expect(hasRecallDebt(entry(stat(1, 0, 0, '2026-11-01'), { state: 'new' }))).toBe(false)
  })

  it('a live miss owes even when a merge has levelled the ledger', () => {
    // mergeRecall: per-field max of reps and correct, streak from the later side.
    expect(hasRecallDebt(entry(stat(5, 5, 0, '2026-11-01')))).toBe(true)
    expect(hasRecallDebt(entry(stat(0, 0, 0, '2026-11-01')))).toBe(false)
  })

  it('is overruled by 太简单 and by nothing else', () => {
    const r = stat(2, 1, 1, '2026-11-01')
    expect(hasRecallDebt(entry(r, { recallRating: { level: 'easy', at: at('2026-11-02') } }))).toBe(false)
    expect(hasRecallDebt(entry(r, { recallRating: { level: 'hard', at: at('2026-11-02') } }))).toBe(true)
    expect(hasRecallDebt(entry(r, { recallRating: { level: 'none', at: at('2026-11-02') } }))).toBe(true)
  })
})

describe('recallDebtDue', () => {
  it('waits 1, 3 and 7 days at streak 0, 1 and 2', () => {
    const today = '2026-11-11'
    expect(recallDebtDue(entry(stat(1, 0, 0, '2026-11-11')), today)).toBe(false)
    expect(recallDebtDue(entry(stat(1, 0, 0, '2026-11-10')), today)).toBe(true)
    expect(recallDebtDue(entry(stat(2, 1, 1, '2026-11-09')), today)).toBe(false)
    expect(recallDebtDue(entry(stat(2, 1, 1, '2026-11-08')), today)).toBe(true)
    expect(recallDebtDue(entry(stat(3, 2, 2, '2026-11-05')), today)).toBe(false)
    expect(recallDebtDue(entry(stat(3, 2, 2, '2026-11-04')), today)).toBe(true)
  })

  it('skips a record it cannot read', () => {
    expect(recallDebtOverdue(entry({ reps: 1, correct: 0, streak: 0, lastAt: 'nonsense' }), '2026-11-11')).toBeUndefined()
    expect(recallDebtOverdue(entry({ reps: 1, correct: 0, streak: -1, lastAt: at('2026-11-01') }), '2026-11-11')).toBeUndefined()
  })
})

describe('owedRecallWords', () => {
  it('lists due debts most overdue first, ties by id', () => {
    const progress = {
      words: {
        late: entry(stat(1, 0, 0, '2026-11-01')),
        b: entry(stat(1, 0, 0, '2026-11-09')),
        a: entry(stat(1, 0, 0, '2026-11-09')),
        waiting: entry(stat(1, 0, 0, '2026-11-11')),
        steady: entry(stat(4, 3, 3, '2026-10-01')),
      },
    } as unknown as Progress
    expect(owedRecallWords(progress, '2026-11-11')).toEqual(['late', 'a', 'b'])
  })

  it('within a day the older answer comes first, whatever the ids', () => {
    const morning = { ...stat(1, 0, 0, '2026-11-09'), lastAt: new Date('2026-11-09T08:00:00').toISOString() }
    const evening = { ...stat(1, 0, 0, '2026-11-09'), lastAt: new Date('2026-11-09T20:00:00').toISOString() }
    const progress = { words: { a: entry(evening), z: entry(morning) } } as unknown as Progress
    expect(owedRecallWords(progress, '2026-11-11')).toEqual(['z', 'a'])
  })
})

describe('reviewsReversed', () => {
  const owing = stat(1, 0, 0, '2026-11-01')
  it('turns a due review-phase card whose debt is due', () => {
    expect(reviewsReversed(entry(owing), '2026-11-11')).toBe(true)
  })
  it('leaves learning cards, cards not yet due, and settled words alone', () => {
    expect(reviewsReversed(entry(owing, { state: 'learning' }), '2026-11-11')).toBe(false)
    expect(reviewsReversed(entry(owing, { due: '2026-11-12' }), '2026-11-11')).toBe(false)
    expect(reviewsReversed(entry(stat(1, 0, 0, '2026-11-11')), '2026-11-11')).toBe(false)
    expect(reviewsReversed(entry(undefined), '2026-11-11')).toBe(false)
  })
})

describe('maskGloss', () => {
  it('leaves no English in a gloss the turned front shows', () => {
    expect(maskGloss('前提;假设(常用复数premises)')).toBe('前提;假设(常用复数…)')
    expect(maskGloss('可能犯错的(区别于 fallacy)')).toBe('可能犯错的(区别于 …)')
    expect(maskGloss('(take/treat … with a pinch of salt)')).not.toMatch(/[A-Za-z]/)
    expect(maskGloss('屈服于;抵挡不住(压力、诱惑等)')).toBe('屈服于;抵挡不住(压力、诱惑等)')
  })
})

describe('maskHeadword', () => {
  it('keeps the first letter and the shape', () => {
    expect(maskHeadword('rudimentary')).toBe('r••••••••••')
    expect(maskHeadword('fall through')).toBe('f••• •••••••')
    expect(maskHeadword('that-said')).toBe('t•••-••••')
    expect(maskHeadword('')).toBe('')
  })
})
