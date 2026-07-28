import { describe, expect, it } from 'vitest'
import { buildLapseQueue, buildQueue } from './queue'
import { emptyProgress } from '../types'
import type { Progress, Word } from '../types'

const word = (id: string, usageScore?: number): Word => ({
  id, headword: id, phonetic: '/x/', meanings: [{ pos: 'n.', en: 'x', zh: 'x' }],
  examples: ['a', 'b'], synonyms: [], antonyms: [], collocations: [], relatedForms: [], sourceNote: 't', addedAt: '2026-07-01',
  ...(usageScore === undefined ? {} : { usageScore }),
})
const words = ['alpha', 'bravo', 'carol', 'delta', 'echo'].map(id => word(id))

const prog = (): Progress => {
  const p = emptyProgress()
  p.settings.newPerDay = 2
  p.words['alpha'] = { state: 'review', ease: 2.5, intervalDays: 5, due: '2026-07-20', stepIndex: 0, reps: 2, lapses: 0, lastReviewedAt: '2026-07-15T00:00:00Z' }
  p.words['bravo'] = { state: 'learning', ease: 2.5, intervalDays: 0, due: '2026-07-24', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-24T00:00:00Z' }
  p.words['carol'] = { state: 'review', ease: 2.5, intervalDays: 30, due: '2026-08-10', stepIndex: 0, reps: 5, lapses: 0, lastReviewedAt: '2026-07-10T00:00:00Z' }
  return p
}

describe('buildQueue', () => {
  it('due words go into due: learning takes priority, then sorted by due date; not-yet-due words are excluded', () => {
    const q = buildQueue(words, prog(), '2026-07-24')
    expect(q.due).toEqual(['bravo', 'alpha'])
  })
  it('new word count = newPerDay minus today\'s already-learned count', () => {
    const q = buildQueue(words, prog(), '2026-07-24')
    expect(q.fresh).toHaveLength(2)
    const p2 = prog()
    p2.dailyStats['2026-07-24'] = { reviewed: 0, newLearned: 1, correct: 0, quizTaken: 0 }
    expect(buildQueue(words, p2, '2026-07-24').fresh).toHaveLength(1)
  })
  it('empty once the new-word quota is used up', () => {
    const p = prog()
    p.dailyStats['2026-07-24'] = { reviewed: 0, newLearned: 2, correct: 0, quizTaken: 0 }
    expect(buildQueue(words, p, '2026-07-24').fresh).toEqual([])
  })
})

describe('buildQueue — prioritized by encounter probability', () => {
  /**
   * Only newPerDay new words are learned each day, so which ones get picked determines the
   * return on that investment. It used to be `.slice(0, budget)` — array order — so whichever
   * word entered the list first got learned first, meaning newly added words wouldn't come up
   * for months, and whether you ended up learning a common word was pure luck.
   */
  const p = (newPerDay: number): Progress => {
    const x = emptyProgress()
    x.settings.newPerDay = newPerDay
    return x
  }

  it('new words are taken by encounter probability from high to low, regardless of their position in the word list', () => {
    const ws = [word('rare', 2), word('common', 9), word('mid', 5)]
    expect(buildQueue(ws, p(2), '2026-07-24').fresh).toEqual(['common', 'mid'])
  })

  it('ties keep the word list\'s original order (stable sort), no pointless shuffling', () => {
    const ws = [word('a', 5), word('b', 5), word('c', 5)]
    expect(buildQueue(ws, p(3), '2026-07-24').fresh).toEqual(['a', 'b', 'c'])
  })

  it('words missing usageScore sort last — unscored does not mean high-frequency, it should not jump the queue', () => {
    const ws = [word('unscored'), word('low', 1)]
    expect(buildQueue(ws, p(2), '2026-07-24').fresh).toEqual(['low', 'unscored'])
  })

  it('when review words tie on state and due date, sort by encounter probability, not alphabetically', () => {
    const ws = [word('apple', 3), word('zebra', 9)]
    const x = emptyProgress()
    const entry = { state: 'review' as const, ease: 2.5, intervalDays: 5, due: '2026-07-20', stepIndex: 0, reps: 2, lapses: 0, lastReviewedAt: '2026-07-15T00:00:00Z' }
    x.words['apple'] = { ...entry }
    x.words['zebra'] = { ...entry }
    expect(buildQueue(ws, x, '2026-07-24').due).toEqual(['zebra', 'apple'])
  })

  it('encounter probability is only a last-resort tiebreaker: it does not affect learning-first or due-date-first priority', () => {
    const ws = [word('lowLearning', 1), word('highReview', 10), word('highLate', 10)]
    const x = emptyProgress()
    x.words['lowLearning'] = { state: 'learning', ease: 2.5, intervalDays: 0, due: '2026-07-24', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-24T00:00:00Z' }
    x.words['highReview'] = { state: 'review', ease: 2.5, intervalDays: 5, due: '2026-07-10', stepIndex: 0, reps: 2, lapses: 0, lastReviewedAt: '2026-07-05T00:00:00Z' }
    x.words['highLate'] = { state: 'review', ease: 2.5, intervalDays: 5, due: '2026-07-22', stepIndex: 0, reps: 2, lapses: 0, lastReviewedAt: '2026-07-17T00:00:00Z' }
    // the learning word scoring 1 still comes first; between the two words scoring 10, the earlier due date comes first
    expect(buildQueue(ws, x, '2026-07-24').due).toEqual(['lowLearning', 'highReview', 'highLate'])
  })
})

describe('buildLapseQueue', () => {
  const entry = (lapses: number) => ({
    state: 'review' as const, ease: 2.5, intervalDays: 5, due: '2099-01-01',
    stepIndex: 0, reps: 9, lapses, lastReviewedAt: '2026-07-15T00:00:00Z',
  })
  const withLapses = (spec: Record<string, number>): Progress => {
    const p = emptyProgress()
    for (const [id, n] of Object.entries(spec)) p.words[id] = entry(n)
    return p
  }

  it('sorted by lapse count from most to least', () => {
    const ws = [word('a'), word('b'), word('c')]
    expect(buildLapseQueue(ws, withLapses({ a: 1, b: 5, c: 3 }))).toEqual(['b', 'c', 'a'])
  })

  it('zero lapses does not count as a stubborn word', () => {
    const ws = [word('a'), word('b')]
    expect(buildLapseQueue(ws, withLapses({ a: 0, b: 2 }))).toEqual(['b'])
  })

  it('words never reviewed are excluded (no record in progress)', () => {
    const ws = [word('a'), word('b')]
    expect(buildLapseQueue(ws, withLapses({ b: 2 }))).toEqual(['b'])
  })

  it('when lapse counts tie, break by encounter probability, common words come first', () => {
    const ws = [word('rare', 2), word('common', 9)]
    expect(buildLapseQueue(ws, withLapses({ rare: 3, common: 3 }))).toEqual(['common', 'rare'])
  })

  it('ignores the due date — stubborn words are actively cleared, not waited on until due', () => {
    // entry() above always gives due: 2099, so the normal queue would pick none of them
    const ws = [word('a')]
    expect(buildQueue(ws, withLapses({ a: 4 }), '2026-07-24').due).toEqual([])
    expect(buildLapseQueue(ws, withLapses({ a: 4 }))).toEqual(['a'])
  })

  it('capped count', () => {
    const ws = Array.from({ length: 30 }, (_, i) => word(`w${i}`))
    const spec = Object.fromEntries(ws.map((w, i) => [w.id, i + 1]))
    expect(buildLapseQueue(ws, withLapses(spec))).toHaveLength(20)
    expect(buildLapseQueue(ws, withLapses(spec), 5)).toHaveLength(5)
  })

  it('returns empty when there are no stubborn words at all', () => {
    expect(buildLapseQueue([word('a')], emptyProgress())).toEqual([])
  })
})
