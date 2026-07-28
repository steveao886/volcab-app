import { describe, expect, it } from 'vitest'
import { mergeProgress } from './merge'
import { emptyProgress } from '../types'
import type { ProgressEntry } from '../types'

const entry = (lastReviewedAt: string, reps: number): ProgressEntry => ({
  state: 'review', ease: 2.5, intervalDays: 3, due: '2026-07-30',
  stepIndex: 0, reps, lapses: 0, lastReviewedAt,
})

describe('mergeProgress', () => {
  it('每个词取 lastReviewedAt 较新的记录', () => {
    const local = emptyProgress(), remote = emptyProgress()
    local.words['a'] = entry('2026-07-24T10:00:00Z', 5)
    remote.words['a'] = entry('2026-07-23T10:00:00Z', 4)
    remote.words['b'] = entry('2026-07-24T09:00:00Z', 2)
    const m = mergeProgress(local, remote)
    expect(m.words['a'].reps).toBe(5)
    expect(m.words['b'].reps).toBe(2)
  })
  it('dailyStats 按日按字段取最大值', () => {
    const local = emptyProgress(), remote = emptyProgress()
    local.dailyStats['2026-07-24'] = { reviewed: 10, newLearned: 3, correct: 8, quizTaken: 0 }
    remote.dailyStats['2026-07-24'] = { reviewed: 6, newLearned: 5, correct: 5, quizTaken: 1 }
    remote.dailyStats['2026-07-23'] = { reviewed: 20, newLearned: 10, correct: 18, quizTaken: 2 }
    const m = mergeProgress(local, remote)
    expect(m.dailyStats['2026-07-24']).toEqual({ reviewed: 10, newLearned: 5, correct: 8, quizTaken: 1 })
    expect(m.dailyStats['2026-07-23'].reviewed).toBe(20)
  })
  // 原断言是「settings 以本地为准」。那条规则让设置在两台设备间**永远无法同步**:
  // A 改成 28 推上去,B 拉下来合并时本地赢,B 保持原值,再推回去又把 28 冲掉。
  // 用户实际撞上了这个问题(改了每日新词数,另一台没变)。改为按 updatedAt 判优,
  // 与词条进度用 lastReviewedAt 判优是同一套思路。
  describe('settings 按更新时间判优', () => {
    const withSettings = (newPerDay: number, updatedAt?: string) => {
      const p = emptyProgress()
      p.settings = { ...p.settings, newPerDay, ...(updatedAt === undefined ? {} : { updatedAt }) }
      return p
    }

    it('远端改得更晚,采用远端', () => {
      const local = withSettings(10, '2026-07-25T09:00:00Z')
      const remote = withSettings(28, '2026-07-25T10:00:00Z')
      expect(mergeProgress(local, remote).settings.newPerDay).toBe(28)
    })

    it('本地改得更晚,采用本地', () => {
      const local = withSettings(28, '2026-07-25T10:00:00Z')
      const remote = withSettings(10, '2026-07-25T09:00:00Z')
      expect(mergeProgress(local, remote).settings.newPerDay).toBe(28)
    })

    it('本地没有时间戳(从未改过设置),远端有:采用远端', () => {
      // 这台设备一直用默认值,另一台改过 —— 该跟随改过的那台,而不是把默认值推回去
      const local = withSettings(10)
      const remote = withSettings(28, '2026-07-25T10:00:00Z')
      expect(mergeProgress(local, remote).settings.newPerDay).toBe(28)
    })

    it('远端没有时间戳(旧数据),本地有:采用本地', () => {
      const local = withSettings(28, '2026-07-25T10:00:00Z')
      const remote = withSettings(10)
      expect(mergeProgress(local, remote).settings.newPerDay).toBe(28)
    })

    it('两边都没有时间戳:保持本地,不无谓翻动', () => {
      expect(mergeProgress(withSettings(20), withSettings(10)).settings.newPerDay).toBe(20)
    })

    it('时间戳相同:保持本地,结果稳定', () => {
      const t = '2026-07-25T10:00:00Z'
      expect(mergeProgress(withSettings(20, t), withSettings(10, t)).settings.newPerDay).toBe(20)
    })

    it('整个 settings 一起搬,不逐字段挑 —— soundEnabled 不能被留在旧那份里', () => {
      const local = withSettings(10, '2026-07-25T09:00:00Z')
      local.settings.soundEnabled = true
      const remote = withSettings(28, '2026-07-25T10:00:00Z')
      remote.settings.soundEnabled = false
      const m = mergeProgress(local, remote)
      expect(m.settings.soundEnabled).toBe(false)   // 跟着 newPerDay 一起来自远端
      expect(m.settings.newPerDay).toBe(28)
    })
  })
})

describe('mergeProgress 的 bestSprint', () => {
  const withBest = (score: number, date: string) => {
    const p = emptyProgress()
    p.bestSprint = { score, date }
    return p
  }

  it('取分高的那一边', () => {
    expect(mergeProgress(withBest(30, '2026-07-20'), withBest(42, '2026-07-25')).bestSprint)
      .toEqual({ score: 42, date: '2026-07-25' })
    expect(mergeProgress(withBest(42, '2026-07-25'), withBest(30, '2026-07-20')).bestSprint)
      .toEqual({ score: 42, date: '2026-07-25' })
  })

  it('同分取日期早的 —— 先达成的那次才是纪录', () => {
    expect(mergeProgress(withBest(42, '2026-07-25'), withBest(42, '2026-07-20')).bestSprint)
      .toEqual({ score: 42, date: '2026-07-20' })
    expect(mergeProgress(withBest(42, '2026-07-20'), withBest(42, '2026-07-25')).bestSprint)
      .toEqual({ score: 42, date: '2026-07-20' })
  })

  it('一边没有就取另一边 —— 旧版 App 推上来的 progress 没有这个字段', () => {
    expect(mergeProgress(emptyProgress(), withBest(20, '2026-07-21')).bestSprint)
      .toEqual({ score: 20, date: '2026-07-21' })
    expect(mergeProgress(withBest(20, '2026-07-21'), emptyProgress()).bestSprint)
      .toEqual({ score: 20, date: '2026-07-21' })
  })

  it('两边都没有时整个键不写,而不是写一个 undefined', () => {
    const m = mergeProgress(emptyProgress(), emptyProgress())
    expect(m.bestSprint).toBeUndefined()
    expect(Object.hasOwn(m, 'bestSprint')).toBe(false)
  })

  it('0 分的纪录也算数,不能被当成「没有纪录」', () => {
    // `local.bestSprint ?? remote.bestSprint` 之类的写法在这里是对的,但
    // `score || other` 那种就会把 0 分吞掉。0 分是一次真实的、很差的成绩。
    expect(mergeProgress(withBest(0, '2026-07-20'), emptyProgress()).bestSprint)
      .toEqual({ score: 0, date: '2026-07-20' })
  })
})
