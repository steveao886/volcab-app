import { describe, expect, it } from 'vitest'
import { addDays, gradeWord, todayStr } from './srs'
import type { ProgressEntry } from '../types'

const now = new Date(2026, 6, 24, 10, 0, 0) // 2026-07-24 本地时间
const noFuzz = () => 0.5 // fuzz 因子 = 1.0

const reviewEntry = (over: Partial<ProgressEntry> = {}): ProgressEntry => ({
  state: 'review', ease: 2.5, intervalDays: 10, due: '2026-07-24',
  stepIndex: 0, reps: 3, lapses: 0, lastReviewedAt: '2026-07-14T00:00:00Z', ...over,
})

describe('todayStr/addDays', () => {
  it('格式化本地日期', () => expect(todayStr(now)).toBe('2026-07-24'))
  it('跨月加天数', () => expect(addDays('2026-07-30', 3)).toBe('2026-08-02'))
})

describe('新词学习阶段', () => {
  it('新词打良好 → 进入下一步长,今天重现', () => {
    const e = gradeWord(undefined, 'good', now, noFuzz)
    expect(e.state).toBe('learning')
    expect(e.stepIndex).toBe(1)
    expect(e.due).toBe('2026-07-24')
  })
  it('走完步长毕业 → review,间隔 1 天', () => {
    const s1 = gradeWord(undefined, 'good', now, noFuzz)
    const s2 = gradeWord(s1, 'good', now, noFuzz)
    expect(s2.state).toBe('review')
    expect(s2.intervalDays).toBe(1)
    expect(s2.due).toBe('2026-07-25')
  })
  it('新词打简单 → 直接毕业,间隔 4 天', () => {
    const e = gradeWord(undefined, 'easy', now, noFuzz)
    expect(e.state).toBe('review')
    expect(e.intervalDays).toBe(4)
  })
  it('学习中打重来 → 回到第 0 步', () => {
    const s1 = gradeWord(undefined, 'good', now, noFuzz)
    const e = gradeWord(s1, 'again', now, noFuzz)
    expect(e.stepIndex).toBe(0)
    expect(e.state).toBe('learning')
  })
})

describe('复习阶段', () => {
  it('良好 → 间隔 × ease', () => {
    const e = gradeWord(reviewEntry(), 'good', now, noFuzz)
    expect(e.intervalDays).toBe(25)
    expect(e.due).toBe(addDays('2026-07-24', 25))
  })
  it('困难 → 间隔 ×1.2,ease −0.15', () => {
    const e = gradeWord(reviewEntry(), 'hard', now, noFuzz)
    expect(e.intervalDays).toBe(12)
    expect(e.ease).toBeCloseTo(2.35)
  })
  it('简单 → 间隔 × ease×1.3,ease +0.15', () => {
    const e = gradeWord(reviewEntry(), 'easy', now, noFuzz)
    expect(e.ease).toBeCloseTo(2.65)
    expect(e.intervalDays).toBe(Math.round(10 * 2.65 * 1.3))
  })
  it('重来 → lapse+1,ease −0.2,回学习阶段今天到期', () => {
    const e = gradeWord(reviewEntry(), 'again', now, noFuzz)
    expect(e.lapses).toBe(1)
    expect(e.ease).toBeCloseTo(2.3)
    expect(e.state).toBe('learning')
    expect(e.due).toBe('2026-07-24')
  })
  it('ease 不低于 1.3', () => {
    const e = gradeWord(reviewEntry({ ease: 1.3 }), 'hard', now, noFuzz)
    expect(e.ease).toBe(1.3)
  })
  it('间隔封顶 365 天', () => {
    const e = gradeWord(reviewEntry({ intervalDays: 300, ease: 2.5 }), 'good', now, noFuzz)
    expect(e.intervalDays).toBe(365)
  })
  it('间隔至少前进 1 天', () => {
    const e = gradeWord(reviewEntry({ intervalDays: 1, ease: 1.3 }), 'hard', now, noFuzz)
    expect(e.intervalDays).toBeGreaterThanOrEqual(2)
  })
})
