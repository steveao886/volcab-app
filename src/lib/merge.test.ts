import { describe, expect, it } from 'vitest'
import { mergeProgress } from './merge'
import { emptyProgress } from '../types'
import type { ProgressEntry } from '../types'

const entry = (lastReviewedAt: string, reps: number): ProgressEntry => ({
  state: 'review', ease: 2.5, intervalDays: 3, due: '2026-07-30',
  stepIndex: 0, reps, lapses: 0, lastReviewedAt,
})

describe('mergeProgress', () => {
  it('takes the newer record by lastReviewedAt for each word', () => {
    const local = emptyProgress(), remote = emptyProgress()
    local.words['a'] = entry('2026-07-24T10:00:00Z', 5)
    remote.words['a'] = entry('2026-07-23T10:00:00Z', 4)
    remote.words['b'] = entry('2026-07-24T09:00:00Z', 2)
    const m = mergeProgress(local, remote)
    expect(m.words['a'].reps).toBe(5)
    expect(m.words['b'].reps).toBe(2)
  })
  it('dailyStats takes the max value per field per day', () => {
    const local = emptyProgress(), remote = emptyProgress()
    local.dailyStats['2026-07-24'] = { reviewed: 10, newLearned: 3, correct: 8, quizTaken: 0 }
    remote.dailyStats['2026-07-24'] = { reviewed: 6, newLearned: 5, correct: 5, quizTaken: 1 }
    remote.dailyStats['2026-07-23'] = { reviewed: 20, newLearned: 10, correct: 18, quizTaken: 2 }
    const m = mergeProgress(local, remote)
    expect(m.dailyStats['2026-07-24']).toEqual({ reviewed: 10, newLearned: 5, correct: 8, quizTaken: 1 })
    expect(m.dailyStats['2026-07-23'].reviewed).toBe(20)
  })
  // The original assertion was "settings default to the local copy." That rule made settings
  // **permanently unable to sync** between two devices: device A changes it to 28 and pushes,
  // device B pulls and merges with local winning, so B keeps its old value and pushes that back,
  // wiping out the 28. A user actually hit this (changed the daily new-word count, the other
  // device never picked it up). Switched to deciding by updatedAt, the same approach used for
  // word progress via lastReviewedAt.
  describe('settings are decided by update time', () => {
    const withSettings = (newPerDay: number, updatedAt?: string) => {
      const p = emptyProgress()
      p.settings = { ...p.settings, newPerDay, ...(updatedAt === undefined ? {} : { updatedAt }) }
      return p
    }

    it('remote was updated later, remote wins', () => {
      const local = withSettings(10, '2026-07-25T09:00:00Z')
      const remote = withSettings(28, '2026-07-25T10:00:00Z')
      expect(mergeProgress(local, remote).settings.newPerDay).toBe(28)
    })

    it('local was updated later, local wins', () => {
      const local = withSettings(28, '2026-07-25T10:00:00Z')
      const remote = withSettings(10, '2026-07-25T09:00:00Z')
      expect(mergeProgress(local, remote).settings.newPerDay).toBe(28)
    })

    it('local has no timestamp (settings never changed), remote does: remote wins', () => {
      // This device has always used the default, the other device changed it — it should
      // follow the device that changed it, not push the default back
      const local = withSettings(10)
      const remote = withSettings(28, '2026-07-25T10:00:00Z')
      expect(mergeProgress(local, remote).settings.newPerDay).toBe(28)
    })

    it('remote has no timestamp (old data), local does: local wins', () => {
      const local = withSettings(28, '2026-07-25T10:00:00Z')
      const remote = withSettings(10)
      expect(mergeProgress(local, remote).settings.newPerDay).toBe(28)
    })

    it('neither side has a timestamp: keep local, no pointless churn', () => {
      expect(mergeProgress(withSettings(20), withSettings(10)).settings.newPerDay).toBe(20)
    })

    it('timestamps are equal: keep local, result is stable', () => {
      const t = '2026-07-25T10:00:00Z'
      expect(mergeProgress(withSettings(20, t), withSettings(10, t)).settings.newPerDay).toBe(20)
    })

    it('the whole settings object moves together, not field by field — soundEnabled must not get left behind in the stale copy', () => {
      const local = withSettings(10, '2026-07-25T09:00:00Z')
      local.settings.soundEnabled = true
      const remote = withSettings(28, '2026-07-25T10:00:00Z')
      remote.settings.soundEnabled = false
      const m = mergeProgress(local, remote)
      expect(m.settings.soundEnabled).toBe(false)   // comes from remote together with newPerDay
      expect(m.settings.newPerDay).toBe(28)
    })
  })
})

describe("mergeProgress's bestSprint", () => {
  const withBest = (score: number, date: string) => {
    const p = emptyProgress()
    p.bestSprint = { score, date }
    return p
  }

  it('takes whichever side has the higher score', () => {
    expect(mergeProgress(withBest(30, '2026-07-20'), withBest(42, '2026-07-25')).bestSprint)
      .toEqual({ score: 42, date: '2026-07-25' })
    expect(mergeProgress(withBest(42, '2026-07-25'), withBest(30, '2026-07-20')).bestSprint)
      .toEqual({ score: 42, date: '2026-07-25' })
  })

  it('ties take the earlier date — the record belongs to whichever happened first', () => {
    expect(mergeProgress(withBest(42, '2026-07-25'), withBest(42, '2026-07-20')).bestSprint)
      .toEqual({ score: 42, date: '2026-07-20' })
    expect(mergeProgress(withBest(42, '2026-07-20'), withBest(42, '2026-07-25')).bestSprint)
      .toEqual({ score: 42, date: '2026-07-20' })
  })

  it('when one side is missing it, take the other — progress pushed by an old app version lacks this field', () => {
    expect(mergeProgress(emptyProgress(), withBest(20, '2026-07-21')).bestSprint)
      .toEqual({ score: 20, date: '2026-07-21' })
    expect(mergeProgress(withBest(20, '2026-07-21'), emptyProgress()).bestSprint)
      .toEqual({ score: 20, date: '2026-07-21' })
  })

  it('when neither side has it, the key is omitted entirely, not written as undefined', () => {
    const m = mergeProgress(emptyProgress(), emptyProgress())
    expect(m.bestSprint).toBeUndefined()
    expect(Object.hasOwn(m, 'bestSprint')).toBe(false)
  })

  it('a record of 0 still counts — it must not be treated as "no record"', () => {
    // A pattern like `local.bestSprint ?? remote.bestSprint` is correct here, but something
    // like `score || other` would swallow a score of 0. A score of 0 is a real, if very poor,
    // result.
    expect(mergeProgress(withBest(0, '2026-07-20'), emptyProgress()).bestSprint)
      .toEqual({ score: 0, date: '2026-07-20' })
  })
})
