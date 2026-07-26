import { describe, expect, it } from 'vitest'
import { emptyProgress } from '../types'
import type { Progress, Word } from '../types'
import { accuracySeries, cumulativeTotals, dailySeries, masteryBreakdown } from './statsDerive'

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
  it('按日期连续补齐,缺失的日子记 0', () => {
    const s = dailySeries(prog({ '2026-07-25': { reviewed: 5, newLearned: 2, correct: 4, quizTaken: 0 } }), '2026-07-25', 3)
    expect(s.map(d => d.date)).toEqual(['2026-07-23', '2026-07-24', '2026-07-25'])
    expect(s.map(d => d.reviewed)).toEqual([0, 0, 5])
  })
  it('空进度返回全 0 而不是空数组', () => {
    const s = dailySeries(emptyProgress(), '2026-07-25', 2)
    expect(s).toHaveLength(2)
    expect(s.every(d => d.reviewed === 0)).toBe(true)
  })
})

describe('accuracySeries', () => {
  it('正确率 = correct / reviewed', () => {
    const s = accuracySeries(prog({ '2026-07-25': { reviewed: 10, newLearned: 0, correct: 8, quizTaken: 0 } }), '2026-07-25', 1)
    expect(s[0].accuracy).toBeCloseTo(0.8)
  })
  it('当天没复习时正确率为 null,不是 0 也不是 NaN', () => {
    const s = accuracySeries(emptyProgress(), '2026-07-25', 1)
    expect(s[0].accuracy).toBeNull()
  })
})

describe('masteryBreakdown', () => {
  it('未学/学习中/已掌握三档计数,无记录视为未学', () => {
    const words = [w('a'), w('b'), w('c')]
    const p = emptyProgress()
    p.words['a'] = entry('learning')
    p.words['b'] = entry('review')
    expect(masteryBreakdown(words, p)).toEqual({ new: 1, learning: 1, review: 1, total: 3 })
  })
  it('空词库不产生除零', () => {
    expect(masteryBreakdown([], emptyProgress())).toEqual({ new: 0, learning: 0, review: 0, total: 0 })
  })
})

describe('cumulativeTotals', () => {
  it('累计复习次数与平均每日新词', () => {
    const p = prog({
      '2026-07-24': { reviewed: 10, newLearned: 4, correct: 9, quizTaken: 1 },
      '2026-07-25': { reviewed: 6, newLearned: 2, correct: 5, quizTaken: 0 },
    })
    const t = cumulativeTotals(p)
    expect(t.totalReviewed).toBe(16)
    expect(t.activeDays).toBe(2)
    expect(t.avgNewPerActiveDay).toBeCloseTo(3)
  })
  it('无数据时平均值为 0 而不是 NaN', () => {
    expect(cumulativeTotals(emptyProgress()).avgNewPerActiveDay).toBe(0)
  })
})
