import { describe, expect, it } from 'vitest'
import { computeStreak } from './todayStats'
import { emptyStat } from '../types'
import type { DailyStat } from '../types'

const stat = (reviewed: number): DailyStat => ({ ...emptyStat(), reviewed })

describe('computeStreak', () => {
  it('空 dailyStats → 0', () => {
    expect(computeStreak({}, '2026-07-25')).toBe(0)
  })

  it('只有今天复习过 → 1', () => {
    const stats = { '2026-07-25': stat(3) }
    expect(computeStreak(stats, '2026-07-25')).toBe(1)
  })

  it('今天还没复习,但昨天和前天复习过 → 不断签,从昨天起算为 2', () => {
    const stats = {
      '2026-07-24': stat(2),
      '2026-07-23': stat(1),
      // 2026-07-25(今天)缺失,视为 0,但不应打断,应从昨天起算
    }
    expect(computeStreak(stats, '2026-07-25')).toBe(2)
  })

  it('两天前出现空缺 → 在缺口处截断,更早的记录不计入', () => {
    const stats = {
      '2026-07-25': stat(1), // 今天
      '2026-07-24': stat(1), // 昨天
      // 2026-07-23 缺失 —— 缺口
      '2026-07-22': stat(5), // 缺口之前还有记录,但不应被计入
    }
    expect(computeStreak(stats, '2026-07-25')).toBe(2)
  })

  it('某天在 map 中存在但 reviewed:0 → 等同缺口,截断计数', () => {
    const stats = {
      '2026-07-25': stat(1),
      '2026-07-24': stat(1),
      '2026-07-23': stat(0), // 显式记录为 0,不是缺失
      '2026-07-22': stat(9),
    }
    expect(computeStreak(stats, '2026-07-25')).toBe(2)
  })

  it('跨月边界的连续记录正确计数', () => {
    const stats = {
      '2026-08-02': stat(1), // 今天
      '2026-08-01': stat(1),
      '2026-07-31': stat(1),
      '2026-07-30': stat(1),
      // 2026-07-29 缺失 —— 缺口
    }
    expect(computeStreak(stats, '2026-08-02')).toBe(4)
  })
})
