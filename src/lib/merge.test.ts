import { describe, expect, it } from 'vitest'
import { mergeProgress } from './merge'
import { emptyProgress } from '../types'
import type { DailyStat, Progress, ProgressEntry } from '../types'

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

describe("mergeProgress's dismissed suggestions", () => {
  const withDismissed = (...ids: string[]): Progress => ({ ...emptyProgress(), dismissed: ids })

  it('takes the union — a rejection made on one device must survive a merge with the other', () => {
    // Not "the longer list", not "local wins": both devices' rejections are
    // real user intent, and losing either one puts that word back into the
    // next suggestion batch.
    expect(mergeProgress(withDismissed('abrogate'), withDismissed('corpus')).dismissed)
      .toEqual(['abrogate', 'corpus'])
  })

  it('deduplicates a word both devices rejected', () => {
    expect(mergeProgress(withDismissed('abrogate', 'corpus'), withDismissed('corpus')).dismissed)
      .toEqual(['abrogate', 'corpus'])
  })

  it('sorts, so merging twice with nothing new produces no diff', () => {
    // Concatenating in merge order would make a∪b and b∪a differ only in
    // ordering, and progress.json would get a spurious push every sync.
    const once = mergeProgress(withDismissed('corpus', 'abrogate'), withDismissed('elide'))
    expect(once.dismissed).toEqual(['abrogate', 'corpus', 'elide'])
    expect(mergeProgress(once, withDismissed('elide', 'corpus')).dismissed).toEqual(once.dismissed)
  })

  it('gives the same result in either direction', () => {
    const a = withDismissed('corpus', 'abrogate'), b = withDismissed('elide', 'abrogate')
    expect(mergeProgress(a, b).dismissed).toEqual(mergeProgress(b, a).dismissed)
  })

  it('one side missing the field defers to the side that has it — an older build pushes progress without it', () => {
    expect(mergeProgress(emptyProgress(), withDismissed('corpus')).dismissed).toEqual(['corpus'])
    expect(mergeProgress(withDismissed('corpus'), emptyProgress()).dismissed).toEqual(['corpus'])
  })

  it('a missing field never reads as "un-dismissed everything"', () => {
    // The failure this guards: treating absent as an empty list and
    // intersecting, or letting the side without the key win outright, would
    // let one sync from an older device wipe every rejection.
    const older = emptyProgress()
    expect(mergeProgress(withDismissed('corpus', 'abrogate'), older).dismissed).toHaveLength(2)
  })

  it('when neither side has it, the key is omitted entirely, not written as []', () => {
    const m = mergeProgress(emptyProgress(), emptyProgress())
    expect(m.dismissed).toBeUndefined()
    expect(Object.hasOwn(m, 'dismissed')).toBe(false)
  })

  it('survives alongside bestSprint — both optional keys have to be carried, not just the last one added', () => {
    const local = withDismissed('corpus')
    local.bestSprint = { score: 42, date: '2026-07-20' }
    const m = mergeProgress(local, emptyProgress())
    expect(m.dismissed).toEqual(['corpus'])
    expect(m.bestSprint).toEqual({ score: 42, date: '2026-07-20' })
  })

  it('skips junk members instead of throwing — isProgress deliberately does not gate this field', () => {
    const dirty = { ...emptyProgress(), dismissed: ['corpus', 3, null] as unknown as string[] }
    expect(mergeProgress(dirty, withDismissed('abrogate')).dismissed).toEqual(['abrogate', 'corpus'])
  })

  it('a hand-edited non-array is skipped rather than spread — spreading a number throws inside boot', () => {
    const dirty = { ...emptyProgress(), dismissed: 7 as unknown as string[] }
    expect(mergeProgress(dirty, withDismissed('corpus')).dismissed).toEqual(['corpus'])
  })
})

describe('mergeProgress: optional dailyStat counters', () => {
  const day = (over: Partial<DailyStat> = {}): DailyStat =>
    ({ reviewed: 0, newLearned: 0, correct: 0, quizTaken: 0, ...over })
  const withDay = (d: DailyStat): Progress => ({ ...emptyProgress(), dailyStats: { '2026-07-25': d } })

  it('carries reviewPhase across a merge instead of dropping it', () => {
    // The whole point: this function rebuilds each entry from named fields,
    // so an unlisted one is lost the first time two devices sync.
    const m = mergeProgress(
      withDay(day({ reviewed: 5, reviewPhase: 4, reviewPhaseCorrect: 4 })),
      withDay(day({ reviewed: 3, reviewPhase: 2, reviewPhaseCorrect: 1 })),
    )
    expect(m.dailyStats['2026-07-25']).toMatchObject({ reviewPhase: 4, reviewPhaseCorrect: 4 })
  })

  it('takes the higher count, like every other counter', () => {
    const m = mergeProgress(
      withDay(day({ reviewPhase: 2, reviewPhaseCorrect: 1 })),
      withDay(day({ reviewPhase: 9, reviewPhaseCorrect: 7 })),
    )
    expect(m.dailyStats['2026-07-25']).toMatchObject({ reviewPhase: 9, reviewPhaseCorrect: 7 })
  })

  it('one side missing the field defers to the side that has it', () => {
    const m = mergeProgress(withDay(day({ reviewPhase: 6 })), withDay(day()))
    expect(m.dailyStats['2026-07-25'].reviewPhase).toBe(6)
  })

  it('neither side has it: the key stays absent, not 0 — a day recorded by an older build did not measure "zero reviews"', () => {
    const m = mergeProgress(withDay(day({ reviewed: 4 })), withDay(day({ reviewed: 2 })))
    expect('reviewPhase' in m.dailyStats['2026-07-25']).toBe(false)
  })
})
