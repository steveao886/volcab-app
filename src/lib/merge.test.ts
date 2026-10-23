import { describe, expect, it } from 'vitest'
import { mergeProgress } from './merge'
import { emptyProgress } from '../types'
import type { DailyStat, ForgetRecord, Progress, ProgressEntry, TangleStat } from '../types'

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

describe("mergeProgress's bestGuess", () => {
  const withGuess = (score: number, date: string) => {
    const p = emptyProgress()
    p.bestGuess = { score, date }
    return p
  }

  it('takes the higher count of no-clue solves, ties going to the earlier date', () => {
    expect(mergeProgress(withGuess(3, '2026-08-01'), withGuess(6, '2026-08-05')).bestGuess)
      .toEqual({ score: 6, date: '2026-08-05' })
    expect(mergeProgress(withGuess(6, '2026-08-05'), withGuess(6, '2026-08-01')).bestGuess)
      .toEqual({ score: 6, date: '2026-08-01' })
  })

  it('survives a device on an older build that has never heard of it', () => {
    expect(mergeProgress(emptyProgress(), withGuess(4, '2026-08-02')).bestGuess)
      .toEqual({ score: 4, date: '2026-08-02' })
    expect(mergeProgress(withGuess(4, '2026-08-02'), emptyProgress()).bestGuess)
      .toEqual({ score: 4, date: '2026-08-02' })
  })

  it('is omitted rather than written as undefined when neither side has one', () => {
    // mergeProgress rebuilds the result from named fields, so a new optional
    // field that isn't listed there is silently dropped the first time two
    // devices sync. This is the test that catches that.
    const m = mergeProgress(emptyProgress(), emptyProgress())
    expect(Object.hasOwn(m, 'bestGuess')).toBe(false)
  })

  it('keeps a zero — a session where nothing came unaided is still a session', () => {
    expect(mergeProgress(withGuess(0, '2026-08-01'), emptyProgress()).bestGuess)
      .toEqual({ score: 0, date: '2026-08-01' })
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

  it('quizModes survives the merge — an unlisted field is dropped the first time two devices sync', () => {
    const m = mergeProgress(
      withDay(day({ quizModes: { recall: { asked: 10, correct: 6 } } })),
      withDay(day({ quizModes: { recall: { asked: 10, correct: 6 } } })),
    )
    expect(m.dailyStats['2026-07-25'].quizModes).toEqual({ recall: { asked: 10, correct: 6 } })
  })

  it('unions the modes, so a mode played only on the other device is not thrown away', () => {
    // The real shape of the problem: 回想 on the phone, 短文 on the laptop,
    // same day. "The side with more modes wins" would lose one of them.
    const m = mergeProgress(
      withDay(day({ quizModes: { recall: { asked: 10, correct: 7 } } })),
      withDay(day({ quizModes: { passage: { asked: 6, correct: 5 } } })),
    )
    expect(m.dailyStats['2026-07-25'].quizModes).toEqual({
      recall: { asked: 10, correct: 7 },
      passage: { asked: 6, correct: 5 },
    })
  })

  it('takes the higher count per mode', () => {
    const m = mergeProgress(
      withDay(day({ quizModes: { recall: { asked: 20, correct: 11 } } })),
      withDay(day({ quizModes: { recall: { asked: 10, correct: 14 } } })),
    )
    expect(m.dailyStats['2026-07-25'].quizModes).toEqual({ recall: { asked: 20, correct: 14 } })
  })

  it('neither side has quizModes: the key stays absent, not {}', () => {
    const m = mergeProgress(withDay(day({ reviewed: 4 })), withDay(day()))
    expect('quizModes' in m.dailyStats['2026-07-25']).toBe(false)
  })

  it('junk from a hand-edited file is skipped, not spread', () => {
    // isDailyStat deliberately does not gate this field, so anything can
    // arrive here — the same reasoning as unionDismissed.
    const junk = { recall: null, passage: 7, audio: { asked: 3 } } as unknown as DailyStat['quizModes']
    const m = mergeProgress(withDay(day({ quizModes: junk })), withDay(day()))
    expect(m.dailyStats['2026-07-25'].quizModes).toEqual({ audio: { asked: 3, correct: 0 } })
  })
})

describe("mergeProgress's recall", () => {
  const entry = (over: Partial<ProgressEntry> = {}): ProgressEntry => ({
    state: 'review', ease: 2.5, intervalDays: 10, due: '2026-08-20',
    stepIndex: 0, reps: 5, lapses: 0, lastReviewedAt: '2026-08-01T00:00:00Z', ...over,
  })
  const withEntry = (e: ProgressEntry): Progress => {
    const p = emptyProgress()
    p.words.alpha = e
    return p
  }
  const stat = (reps: number, correct: number, streak: number, lastAt: string) =>
    ({ reps, correct, streak, lastAt })

  /**
   * The reason recall is merged on its own timestamp rather than riding the
   * wholesale entry pick: `lastReviewedAt` is the scheduler's stamp, and 回想
   * deliberately never writes it. A device that graded the word more
   * recently would otherwise carry a stale (or absent) recall record over
   * the one that actually did the practice.
   */
  it('survives when the other device graded the word more recently', () => {
    const practised = withEntry(entry({ lastReviewedAt: '2026-08-01T00:00:00Z', recall: stat(6, 5, 3, '2026-08-09T00:00:00Z') }))
    const graded = withEntry(entry({ lastReviewedAt: '2026-08-10T00:00:00Z' }))
    const m = mergeProgress(practised, graded)
    // The graded entry wins the schedule…
    expect(m.words.alpha.lastReviewedAt).toBe('2026-08-10T00:00:00Z')
    // …and the practice is still there.
    expect(m.words.alpha.recall).toEqual(stat(6, 5, 3, '2026-08-09T00:00:00Z'))
  })

  it('takes the later session for streak, and the higher count for the ledger', () => {
    const a = withEntry(entry({ recall: stat(10, 8, 4, '2026-08-05T00:00:00Z') }))
    const b = withEntry(entry({ recall: stat(7, 6, 1, '2026-08-09T00:00:00Z') }))
    expect(mergeProgress(a, b).words.alpha.recall).toEqual(stat(10, 8, 1, '2026-08-09T00:00:00Z'))
  })

  it('a streak is never maxed — that would claim consecutive answers nobody gave', () => {
    const a = withEntry(entry({ recall: stat(3, 3, 3, '2026-08-01T00:00:00Z') }))
    const b = withEntry(entry({ recall: stat(4, 3, 0, '2026-08-08T00:00:00Z') }))
    expect(mergeProgress(a, b).words.alpha.recall?.streak).toBe(0)
  })

  it('one side missing takes the other', () => {
    const a = withEntry(entry({ recall: stat(2, 2, 2, '2026-08-05T00:00:00Z') }))
    expect(mergeProgress(a, withEntry(entry())).words.alpha.recall).toEqual(stat(2, 2, 2, '2026-08-05T00:00:00Z'))
    expect(mergeProgress(withEntry(entry()), a).words.alpha.recall).toEqual(stat(2, 2, 2, '2026-08-05T00:00:00Z'))
  })

  it('absent on both stays absent rather than becoming a zeroed record', () => {
    const m = mergeProgress(withEntry(entry()), withEntry(entry()))
    expect(Object.hasOwn(m.words.alpha, 'recall')).toBe(false)
  })

  /** The contract the whole field rests on: it is a second axis, not a second scheduler. */
  it('merging recall leaves every scheduler field untouched', () => {
    const sched = entry({ ease: 2.35, intervalDays: 17, due: '2026-09-02', reps: 9, lapses: 2 })
    const a = withEntry({ ...sched, recall: stat(1, 0, 0, '2026-08-09T00:00:00Z') })
    const b = withEntry({ ...sched, recall: stat(3, 3, 3, '2026-08-04T00:00:00Z') })
    const m = mergeProgress(a, b).words.alpha
    const { recall: _a, ...mergedSched } = m
    const { recall: _b, ...originalSched } = a.words.alpha
    expect(mergedSched).toEqual(originalSched)
  })
})

describe("mergeProgress's recallRating", () => {
  const entry = (over: Partial<ProgressEntry> = {}): ProgressEntry => ({
    state: 'review', ease: 2.5, intervalDays: 10, due: '2026-08-20',
    stepIndex: 0, reps: 5, lapses: 0, lastReviewedAt: '2026-08-01T00:00:00Z', ...over,
  })
  const withEntry = (e: ProgressEntry): Progress => {
    const p = emptyProgress()
    p.words.alpha = e
    return p
  }
  const rating = (level: 'easy' | 'hard' | 'none', at: string) => ({ level, at })

  /**
   * Same failure the recall record is merged on its own timestamp to avoid,
   * one field over: the phone rated the word, the laptop graded it in
   * /review afterwards. The wholesale pick resolves by `lastReviewedAt`,
   * which only the scheduler stamps, so the laptop's entry would win and
   * the rating would disappear silently and for good.
   */
  it('survives when the other device graded the word more recently', () => {
    const rated = withEntry(entry({ lastReviewedAt: '2026-08-01T00:00:00Z', recallRating: rating('hard', '2026-08-20T00:00:00Z') }))
    const graded = withEntry(entry({ lastReviewedAt: '2026-08-24T00:00:00Z' }))
    expect(mergeProgress(rated, graded).words.alpha.recallRating).toEqual(rating('hard', '2026-08-20T00:00:00Z'))
    expect(mergeProgress(graded, rated).words.alpha.recallRating).toEqual(rating('hard', '2026-08-20T00:00:00Z'))
  })

  it('the later rating wins, whichever side it is on', () => {
    const a = withEntry(entry({ recallRating: rating('easy', '2026-08-20T00:00:00Z') }))
    const b = withEntry(entry({ recallRating: rating('hard', '2026-08-22T00:00:00Z') }))
    expect(mergeProgress(a, b).words.alpha.recallRating).toEqual(rating('hard', '2026-08-22T00:00:00Z'))
    expect(mergeProgress(b, a).words.alpha.recallRating).toEqual(rating('hard', '2026-08-22T00:00:00Z'))
  })

  /**
   * The whole reason clearing writes 'none' instead of deleting the key.
   * With absence meaning "cleared", the only rules available are "the side
   * holding a value wins" — which undoes the clear on every sync, the
   * mirror of what unionDismissed prevents — and "absence wins", which
   * loses a rating the other device has not synced yet.
   */
  it('a clear beats an older rating instead of being resurrected by it', () => {
    const stale = withEntry(entry({ recallRating: rating('easy', '2026-08-20T00:00:00Z') }))
    const cleared = withEntry(entry({ recallRating: rating('none', '2026-08-23T00:00:00Z') }))
    expect(mergeProgress(stale, cleared).words.alpha.recallRating?.level).toBe('none')
    expect(mergeProgress(cleared, stale).words.alpha.recallRating?.level).toBe('none')
  })

  it('one side missing takes the other, and absent on both stays absent', () => {
    const rated = withEntry(entry({ recallRating: rating('hard', '2026-08-20T00:00:00Z') }))
    expect(mergeProgress(withEntry(entry()), rated).words.alpha.recallRating).toEqual(rating('hard', '2026-08-20T00:00:00Z'))
    expect(mergeProgress(rated, withEntry(entry())).words.alpha.recallRating).toEqual(rating('hard', '2026-08-20T00:00:00Z'))
    expect(mergeProgress(withEntry(entry()), withEntry(entry())).words.alpha).not.toHaveProperty('recallRating')
  })

  it('a rating and a recall record both survive the same merge', () => {
    // They are merged in one loop and each has its own timestamp; a rewrite
    // that folded them together would drop whichever came second.
    const a = withEntry(entry({ recallRating: rating('hard', '2026-08-22T00:00:00Z') }))
    const b = withEntry(entry({ recall: { reps: 4, correct: 3, streak: 1, lastAt: '2026-08-23T00:00:00Z' } }))
    const m = mergeProgress(a, b)
    expect(m.words.alpha.recallRating?.level).toBe('hard')
    expect(m.words.alpha.recall?.reps).toBe(4)
  })
})

describe('mergeProgress diverge', () => {
  const stat = (best: number, size: number, lastAt: string) => ({ best, size, lastAt })

  it('merges per key, so two devices playing different concepts keep both histories', () => {
    const local = emptyProgress(), remote = emptyProgress()
    local.diverge = { 'stubborn|synonym': stat(5, 8, '2026-09-18T10:00:00Z') }
    remote.diverge = { 'diligent|opposite': stat(2, 3, '2026-09-18T09:00:00Z') }
    const m = mergeProgress(local, remote)
    expect(Object.keys(m.diverge!).sort()).toEqual(['diligent|opposite', 'stubborn|synonym'])
  })

  it('best takes the maximum, so a record can only ever go up', () => {
    const local = emptyProgress(), remote = emptyProgress()
    // The later attempt scored worse. The record still stands.
    local.diverge = { k: stat(3, 8, '2026-09-18T12:00:00Z') }
    remote.diverge = { k: stat(7, 8, '2026-09-18T09:00:00Z') }
    expect(mergeProgress(local, remote).diverge!['k'].best).toBe(7)
  })

  it('size comes from the later attempt, because it is a snapshot and not a record', () => {
    const local = emptyProgress(), remote = emptyProgress()
    local.diverge = { k: stat(3, 9, '2026-09-18T12:00:00Z') }
    remote.diverge = { k: stat(7, 8, '2026-09-18T09:00:00Z') }
    const m = mergeProgress(local, remote).diverge!['k']
    expect(m).toEqual({ best: 7, size: 9, lastAt: '2026-09-18T12:00:00Z' })
  })

  it('takes a shrinking set at face value — the user deletes words', () => {
    const local = emptyProgress(), remote = emptyProgress()
    local.diverge = { k: stat(4, 3, '2026-09-18T12:00:00Z') }
    remote.diverge = { k: stat(4, 8, '2026-09-18T09:00:00Z') }
    expect(mergeProgress(local, remote).diverge!['k'].size).toBe(3)
  })

  it('omits the key entirely when neither side has one', () => {
    const m = mergeProgress(emptyProgress(), emptyProgress())
    expect(Object.hasOwn(m, 'diverge')).toBe(false)
  })

  it('skips junk rather than throwing inside the boot path', () => {
    const local = emptyProgress(), remote = emptyProgress()
    // isProgress deliberately does not check this field, so a hand-edited
    // file reaches here intact.
    ;(local as unknown as { diverge: unknown }).diverge = { good: stat(1, 2, '2026-09-18T10:00:00Z'), bad: 7, worse: { best: 3 } }
    remote.diverge = { other: stat(2, 2, '2026-09-18T10:00:00Z') }
    const m = mergeProgress(local, remote)
    expect(Object.keys(m.diverge!).sort()).toEqual(['good', 'other'])
  })
})

describe("mergeProgress's forgot", () => {
  const entry = (over: Partial<ProgressEntry> = {}): ProgressEntry => ({
    state: 'review', ease: 2.5, intervalDays: 10, due: '2026-10-20',
    stepIndex: 0, reps: 5, lapses: 0, lastReviewedAt: '2026-10-01T00:00:00Z', ...over,
  })
  const withEntry = (e: ProgressEntry): Progress => {
    const p = emptyProgress()
    p.words.alpha = e
    return p
  }
  /** One lapse, stamped on day `d` of October 2026. The same `d` is the same lapse. */
  const rec = (d: number, over: Partial<ForgetRecord> = {}): ForgetRecord => ({
    at: `2026-10-${String(d).padStart(2, '0')}T08:00:00.000Z`,
    kind: 'blank', prevInterval: 10, prevReviewedAt: '2026-09-20T08:00:00.000Z', ...over,
  })

  /**
   * The reason the log is merged on its own: the lapse is written on the
   * entry the 重来 just graded, and the wholesale pick resolves entries by
   * `lastReviewedAt`. The laptop grading the same word later out-ranks the
   * phone's entry, and the record of how the phone forgot it goes with it,
   * silently, along with the only copy of the interval it was lost at.
   */
  it('keeps a forget record written on one device when the other device graded the word later', () => {
    const r1 = rec(5, { kind: 'confused', with: 'beta' })
    const forgot = withEntry(entry({ lastReviewedAt: '2026-10-05T08:00:00.000Z', forgot: [r1] }))
    const graded = withEntry(entry({ lastReviewedAt: '2026-10-09T08:00:00.000Z' }))
    for (const m of [mergeProgress(forgot, graded), mergeProgress(graded, forgot)]) {
      expect(m.words.alpha.forgot).toEqual([r1])
      // The later grade still owns the schedule.
      expect(m.words.alpha.lastReviewedAt).toBe('2026-10-09T08:00:00.000Z')
    }
  })

  it('unions forget records by at, oldest first, keeping the last 10', () => {
    // 7 + 7 with 3 shared is 11 distinct lapses, so the oldest (day 1) must go.
    // Interleaved and out of order on purpose: a concatenation would pass a
    // test whose two lists were already sorted and disjoint.
    const local = withEntry(entry({ forgot: [1, 3, 5, 7, 9, 11, 13].map((d) => rec(d)) }))
    const remote = withEntry(entry({ forgot: [5, 9, 13, 2, 4, 6, 8].map((d) => rec(d)) }))
    const days = (p: Progress) => p.words.alpha.forgot!.map((r) => Number(r.at.slice(8, 10)))
    expect(days(mergeProgress(local, remote))).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 11, 13])
    // The result is a function of the two sets, not of which device merged.
    expect(mergeProgress(remote, local).words.alpha.forgot).toEqual(mergeProgress(local, remote).words.alpha.forgot)
  })

  it('keeps a 没想全 record, a kind added after the first two', () => {
    const r1 = rec(6, { kind: 'partial' })
    const m = mergeProgress(withEntry(entry({ forgot: [r1] })), withEntry(entry()))
    expect(m.words.alpha.forgot).toEqual([r1])
  })

  it('absent on both sides stays absent', () => {
    const m = mergeProgress(withEntry(entry()), withEntry(entry()))
    expect('forgot' in m.words.alpha).toBe(false)
  })

  it('a word held by one side only keeps its log', () => {
    const r1 = rec(3)
    const p = emptyProgress()
    p.words.beta = entry({ forgot: [r1] })
    const m = mergeProgress(p, withEntry(entry()))
    expect(m.words.beta.forgot).toEqual([r1])
    expect('forgot' in m.words.alpha).toBe(false)
  })

  it('skips records without a string at or a known kind, and never throws on a non-array', () => {
    const good = rec(4)
    // isProgress does not check this field, so a hand-edited file reaches here intact.
    const junk = [{ ...good, at: 5 }, { ...good, kind: 'bogus' }, null, 'x', good] as unknown as ForgetRecord[]
    const m = mergeProgress(withEntry(entry({ forgot: junk })), withEntry(entry()))
    expect(m.words.alpha.forgot).toEqual([good])
    // A non-array is replaced by a clean one, not carried through by the winning entry.
    const bad = withEntry(entry({ forgot: 7 as unknown as ForgetRecord[] }))
    expect(mergeProgress(bad, withEntry(entry())).words.alpha.forgot).toEqual([])
  })

  it('merging the log leaves every scheduler field untouched', () => {
    const sched = entry({ ease: 2.35, intervalDays: 17, due: '2026-11-02', reps: 9, lapses: 2 })
    const a = withEntry({ ...sched, forgot: [rec(2)] })
    const b = withEntry({ ...sched, forgot: [rec(6)] })
    const { forgot: _m, ...mergedSched } = mergeProgress(a, b).words.alpha
    expect(mergedSched).toEqual(sched)
  })
})

describe("mergeProgress's tangles", () => {
  const stat = (lastAt: string, over: Partial<TangleStat> = {}): TangleStat => ({
    pairs: ['alpha|beta'], members: ['alpha', 'beta'], settled: [],
    bornOn: '2026-10-20', dueOn: '2026-10-21', lastAt, ...over,
  })

  it('tangles: the later lastAt wins per key, keys from both sides survive', () => {
    const local = emptyProgress(), remote = emptyProgress()
    local.tangles = {
      both: stat('2026-10-21T09:00:00.000Z', { settled: ['alpha'] }),
      back: stat('2026-10-20T09:00:00.000Z'),
      localOnly: stat('2026-10-20T10:00:00.000Z'),
    }
    remote.tangles = {
      both: stat('2026-10-20T09:00:00.000Z'),
      back: stat('2026-10-22T09:00:00.000Z', { doneOn: '2026-10-22' }),
      remoteOnly: stat('2026-10-20T11:00:00.000Z'),
    }
    const m = mergeProgress(local, remote).tangles!
    expect(Object.keys(m).sort()).toEqual(['back', 'both', 'localOnly', 'remoteOnly'])
    // Local is later on `both`, remote is later on `back`: neither side wins by being local.
    expect(m.both.settled).toEqual(['alpha'])
    expect(m.back.doneOn).toBe('2026-10-22')
  })

  it('tangles: the later stat is taken whole, never field by field', () => {
    // A field-wise union would put `alpha` back in `settled` and keep a
    // `doneOn` that the later state has already reopened away from.
    const local = emptyProgress(), remote = emptyProgress()
    local.tangles = { k: stat('2026-10-21T09:00:00.000Z', { settled: ['alpha'], doneOn: '2026-10-21' }) }
    remote.tangles = { k: stat('2026-10-23T09:00:00.000Z', { dueOn: '2026-10-24' }) }
    const m = mergeProgress(local, remote).tangles!.k
    expect(m).toEqual(stat('2026-10-23T09:00:00.000Z', { dueOn: '2026-10-24' }))
    expect('doneOn' in m).toBe(false)
  })

  it('tangles: a tie keeps the first side seen, the way diverge does', () => {
    const local = emptyProgress(), remote = emptyProgress()
    local.tangles = { k: stat('2026-10-21T09:00:00.000Z', { dueOn: '2026-10-22' }) }
    remote.tangles = { k: stat('2026-10-21T09:00:00.000Z', { dueOn: '2026-10-23' }) }
    expect(mergeProgress(local, remote).tangles!.k.dueOn).toBe('2026-10-22')
  })

  it('tangles: a malformed entry is skipped, not thrown on', () => {
    const local = emptyProgress(), remote = emptyProgress()
    const ok = stat('2026-10-21T09:00:00.000Z')
    ;(local as unknown as { tangles: unknown }).tangles = {
      k: { lastAt: 5 },
      noMembers: { ...ok, members: 'alpha' },
      mixedPairs: { ...ok, pairs: ['alpha|beta', 7] },
      noSettled: { ...ok, settled: undefined },
      noDue: { ...ok, dueOn: undefined },
      noBorn: { ...ok, bornOn: 3 },
      notAStat: 7,
      good: ok,
    }
    remote.tangles = { other: stat('2026-10-21T10:00:00.000Z') }
    expect(Object.keys(mergeProgress(local, remote).tangles!).sort()).toEqual(['good', 'other'])
    // A whole non-object is the same junk, one level up.
    ;(local as unknown as { tangles: unknown }).tangles = 7
    expect(Object.keys(mergeProgress(local, remote).tangles!)).toEqual(['other'])
  })

  it('tangles absent on both sides stays absent', () => {
    const m = mergeProgress(emptyProgress(), emptyProgress())
    expect('tangles' in m).toBe(false)
  })
})

describe("mergeProgress's synonymSeen", () => {
  it('merges per term, the later stamp winning, the same in both orders', () => {
    const local = emptyProgress(), remote = emptyProgress()
    local.synonymSeen = { 反感: '2026-10-23T10:00:00.000Z', 抱怨: '2026-10-20T08:00:00.000Z' }
    remote.synonymSeen = { 反感: '2026-10-22T10:00:00.000Z', 抱怨: '2026-10-21T08:00:00.000Z', 减轻: '2026-10-19T08:00:00.000Z' }
    const want = { 反感: '2026-10-23T10:00:00.000Z', 抱怨: '2026-10-21T08:00:00.000Z', 减轻: '2026-10-19T08:00:00.000Z' }
    expect(mergeProgress(local, remote).synonymSeen).toEqual(want)
    expect(mergeProgress(remote, local).synonymSeen).toEqual(want)
  })

  it('skips a value that is not a string', () => {
    const local = emptyProgress(), remote = emptyProgress()
    local.synonymSeen = { 反感: 5, 抱怨: '2026-10-20T08:00:00.000Z' } as unknown as Progress['synonymSeen']
    expect(mergeProgress(local, remote).synonymSeen).toEqual({ 抱怨: '2026-10-20T08:00:00.000Z' })
  })

  it('stays absent when neither side has it', () => {
    expect('synonymSeen' in mergeProgress(emptyProgress(), emptyProgress())).toBe(false)
  })
})
