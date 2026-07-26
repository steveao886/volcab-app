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
  it('到期词进 due:learning 优先,再按 due 日期排序;未到期不进', () => {
    const q = buildQueue(words, prog(), '2026-07-24')
    expect(q.due).toEqual(['bravo', 'alpha'])
  })
  it('新词数量 = newPerDay − 今日已学', () => {
    const q = buildQueue(words, prog(), '2026-07-24')
    expect(q.fresh).toHaveLength(2)
    const p2 = prog()
    p2.dailyStats['2026-07-24'] = { reviewed: 0, newLearned: 1, correct: 0, quizTaken: 0 }
    expect(buildQueue(words, p2, '2026-07-24').fresh).toHaveLength(1)
  })
  it('新词额度用完则为空', () => {
    const p = prog()
    p.dailyStats['2026-07-24'] = { reviewed: 0, newLearned: 2, correct: 0, quizTaken: 0 }
    expect(buildQueue(words, p, '2026-07-24').fresh).toEqual([])
  })
})

describe('buildQueue —— 按遇见概率优先', () => {
  /**
   * 每天只学 newPerDay 个新词,取哪几个决定了这份投入的回报。
   * 原本是 `.slice(0, budget)`,即数组顺序 —— 谁先进词库谁先学,
   * 于是新加的词几个月内轮不到,而且学到的是不是常用词全凭运气。
   */
  const p = (newPerDay: number): Progress => {
    const x = emptyProgress()
    x.settings.newPerDay = newPerDay
    return x
  }

  it('新词按遇见概率从高到低取,不看它在词库里的位置', () => {
    const ws = [word('rare', 2), word('common', 9), word('mid', 5)]
    expect(buildQueue(ws, p(2), '2026-07-24').fresh).toEqual(['common', 'mid'])
  })

  it('分数相同时保持词库原有顺序(稳定排序),不无端打乱', () => {
    const ws = [word('a', 5), word('b', 5), word('c', 5)]
    expect(buildQueue(ws, p(3), '2026-07-24').fresh).toEqual(['a', 'b', 'c'])
  })

  it('缺 usageScore 的词排在最后 —— 未评分不等于高频,不该插队', () => {
    const ws = [word('unscored'), word('low', 1)]
    expect(buildQueue(ws, p(2), '2026-07-24').fresh).toEqual(['low', 'unscored'])
  })

  it('复习词同状态同到期日时,按遇见概率排,而不是字母序', () => {
    const ws = [word('apple', 3), word('zebra', 9)]
    const x = emptyProgress()
    const entry = { state: 'review' as const, ease: 2.5, intervalDays: 5, due: '2026-07-20', stepIndex: 0, reps: 2, lapses: 0, lastReviewedAt: '2026-07-15T00:00:00Z' }
    x.words['apple'] = { ...entry }
    x.words['zebra'] = { ...entry }
    expect(buildQueue(ws, x, '2026-07-24').due).toEqual(['zebra', 'apple'])
  })

  it('遇见概率只是末位 tiebreaker:learning 优先与到期日优先都不受它影响', () => {
    const ws = [word('lowLearning', 1), word('highReview', 10), word('highLate', 10)]
    const x = emptyProgress()
    x.words['lowLearning'] = { state: 'learning', ease: 2.5, intervalDays: 0, due: '2026-07-24', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-24T00:00:00Z' }
    x.words['highReview'] = { state: 'review', ease: 2.5, intervalDays: 5, due: '2026-07-10', stepIndex: 0, reps: 2, lapses: 0, lastReviewedAt: '2026-07-05T00:00:00Z' }
    x.words['highLate'] = { state: 'review', ease: 2.5, intervalDays: 5, due: '2026-07-22', stepIndex: 0, reps: 2, lapses: 0, lastReviewedAt: '2026-07-17T00:00:00Z' }
    // learning 的 1 分词仍在最前;两个 10 分词之间按到期日先后,早的在前
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

  it('按失误次数从多到少排', () => {
    const ws = [word('a'), word('b'), word('c')]
    expect(buildLapseQueue(ws, withLapses({ a: 1, b: 5, c: 3 }))).toEqual(['b', 'c', 'a'])
  })

  it('失误为 0 的不算顽固词', () => {
    const ws = [word('a'), word('b')]
    expect(buildLapseQueue(ws, withLapses({ a: 0, b: 2 }))).toEqual(['b'])
  })

  it('从未复习过的词不进(progress 里没有记录)', () => {
    const ws = [word('a'), word('b')]
    expect(buildLapseQueue(ws, withLapses({ b: 2 }))).toEqual(['b'])
  })

  it('失误次数相同时看遇见概率,常用的先来', () => {
    const ws = [word('rare', 2), word('common', 9)]
    expect(buildLapseQueue(ws, withLapses({ rare: 3, common: 3 }))).toEqual(['common', 'rare'])
  })

  it('不看到期日 —— 顽固词是主动清算,不是等它到期', () => {
    // 上面的 entry() 一律给 due: 2099,正常队列一个都不会取
    const ws = [word('a')]
    expect(buildQueue(ws, withLapses({ a: 4 }), '2026-07-24').due).toEqual([])
    expect(buildLapseQueue(ws, withLapses({ a: 4 }))).toEqual(['a'])
  })

  it('数量封顶', () => {
    const ws = Array.from({ length: 30 }, (_, i) => word(`w${i}`))
    const spec = Object.fromEntries(ws.map((w, i) => [w.id, i + 1]))
    expect(buildLapseQueue(ws, withLapses(spec))).toHaveLength(20)
    expect(buildLapseQueue(ws, withLapses(spec), 5)).toHaveLength(5)
  })

  it('一个顽固词都没有时返回空', () => {
    expect(buildLapseQueue([word('a')], emptyProgress())).toEqual([])
  })
})
