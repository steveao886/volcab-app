import { describe, expect, it } from 'vitest'
import { buildQueue } from './queue'
import { emptyProgress } from '../types'
import type { Progress, Word } from '../types'

const word = (id: string): Word => ({
  id, headword: id, phonetic: '/x/', meanings: [{ pos: 'n.', en: 'x', zh: 'x' }],
  examples: ['a', 'b'], synonyms: [], antonyms: [], collocations: [], relatedForms: [], sourceNote: 't', addedAt: '2026-07-01',
})
const words = ['alpha', 'bravo', 'carol', 'delta', 'echo'].map(word)

const prog = (): Progress => {
  const p = emptyProgress()
  p.settings.newPerDay = 2
  p.words['alpha'] = { state: 'review', ease: 2.5, intervalDays: 5, due: '2026-07-20', stepIndex: 0, reps: 2, lapses: 0, lastReviewedAt: '2026-07-15T00:00:00Z' }
  p.words['bravo'] = { state: 'learning', ease: 2.5, intervalDays: 0, due: '2026-07-24', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-24T00:00:00Z' }
  p.words['carol'] = { state: 'review', ease: 2.5, intervalDays: 30, due: '2026-08-10', stepIndex: 0, reps: 5, lapses: 0, lastReviewedAt: '2026-07-10T00:00:00Z' }
  return p
}

describe('buildQueue', () => {
  it('到期词进 due:learning 优先,再按 due 日期排序;未到期不进', () => {
    const q = buildQueue(words, prog(), '2026-07-24')
    expect(q.due).toEqual(['bravo', 'alpha'])
  })
  it('新词按词库顺序取,数量 = newPerDay − 今日已学', () => {
    const q = buildQueue(words, prog(), '2026-07-24')
    expect(q.fresh).toEqual(['delta', 'echo'])
    const p2 = prog()
    p2.dailyStats['2026-07-24'] = { reviewed: 0, newLearned: 1, correct: 0, quizTaken: 0 }
    expect(buildQueue(words, p2, '2026-07-24').fresh).toEqual(['delta'])
  })
  it('新词额度用完则为空', () => {
    const p = prog()
    p.dailyStats['2026-07-24'] = { reviewed: 0, newLearned: 2, correct: 0, quizTaken: 0 }
    expect(buildQueue(words, p, '2026-07-24').fresh).toEqual([])
  })
})
