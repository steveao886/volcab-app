import { describe, expect, it } from 'vitest'
import { advance, buildSessionQueue, currentId, dropCurrent, isDone } from './reviewQueue'
import { gradeWord } from '../lib/srs'
import type { ProgressEntry } from '../types'

const TODAY = '2026-07-25'
const noFuzz = () => 0.5

const entry = (over: Partial<ProgressEntry> = {}): ProgressEntry => ({
  state: 'learning', ease: 2.5, intervalDays: 0, due: TODAY,
  stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: `${TODAY}T00:00:00Z`, ...over,
})

describe('buildSessionQueue', () => {
  it('due 词在前,fresh 词在后,拼成会话队列', () => {
    const q = buildSessionQueue(['a', 'b'], ['c', 'd'])
    expect(q.ids).toEqual(['a', 'b', 'c', 'd'])
  })
  it('初始 seen=0,total=队列长度', () => {
    const q = buildSessionQueue(['a', 'b'], ['c'])
    expect(q.seen).toBe(0)
    expect(q.total).toBe(3)
  })
  it('due 与 fresh 都为空 → 空队列', () => {
    const q = buildSessionQueue([], [])
    expect(q.ids).toEqual([])
    expect(q.total).toBe(0)
  })
})

describe('currentId / isDone', () => {
  it('当前卡是队首', () => {
    expect(currentId(buildSessionQueue(['x', 'y'], []))).toBe('x')
  })
  it('空队列没有当前卡,视为已完成', () => {
    const q = buildSessionQueue([], [])
    expect(currentId(q)).toBeUndefined()
    expect(isDone(q)).toBe(true)
  })
  it('非空队列未完成', () => {
    expect(isDone(buildSessionQueue(['x'], []))).toBe(false)
  })
})

describe('advance —— 出队与重新入队', () => {
  it('打分后已毕业(review 状态)→ 彻底出队,seen+1,total 不变', () => {
    const q = buildSessionQueue(['a', 'b'], [])
    const graduated = entry({ state: 'review', due: '2026-07-26' })
    const next = advance(q, 'a', graduated, TODAY)
    expect(next.ids).toEqual(['b'])
    expect(next.seen).toBe(1)
    expect(next.total).toBe(2)
  })
  it('仍是 learning 但 due 已推到明天(简单打完毕业前的中间态不会发生,但防御 due>today)→ 不重排', () => {
    const q = buildSessionQueue(['a'], [])
    const next = advance(q, 'a', entry({ due: '2026-07-26' }), TODAY)
    expect(next.ids).toEqual([])
  })
  it('仍是 learning 且 due 仍是今天(学习步长未走完)→ 重新插入队尾,total+1', () => {
    const q = buildSessionQueue(['a', 'b'], [])
    const next = advance(q, 'a', entry({ due: TODAY }), TODAY)
    expect(next.ids).toEqual(['b', 'a'])
    expect(next.seen).toBe(1)
    expect(next.total).toBe(3)
  })
  it('entry 为 undefined(不应发生,但要防御)→ 视为不重排,直接出队', () => {
    const q = buildSessionQueue(['a'], [])
    const next = advance(q, 'a', undefined, TODAY)
    expect(next.ids).toEqual([])
    expect(next.seen).toBe(1)
  })
  it('只有这一张卡时重新入队 → 队首还是它自己(会话内立刻重现)', () => {
    const q = buildSessionQueue(['a'], [])
    const next = advance(q, 'a', entry({ due: TODAY }), TODAY)
    expect(currentId(next)).toBe('a')
    expect(isDone(next)).toBe(false)
  })
})

describe('dropCurrent —— 词条在词库里消失(另一台设备删除)', () => {
  it('摘掉队首,不计入 seen,total 一起减一', () => {
    const q = buildSessionQueue(['a', 'b', 'c'], [])
    const next = dropCurrent(q)
    expect(next.ids).toEqual(['b', 'c'])
    expect(next.seen).toBe(0)
    expect(next.total).toBe(2)
  })
  it('摘掉最后一张 → 队列清空,视为完成', () => {
    const q = buildSessionQueue(['a'], [])
    const next = dropCurrent(q)
    expect(next.ids).toEqual([])
    expect(isDone(next)).toBe(true)
    expect(next.total).toBe(0)
  })
  it('摘掉之后不影响其余词正常出队/重排', () => {
    let q = buildSessionQueue(['a', 'b'], [])
    q = dropCurrent(q) // a 在另一台设备被删了
    expect(currentId(q)).toBe('b')
    const next = advance(q, 'b', entry({ state: 'review', due: '2026-07-26' }), TODAY)
    expect(isDone(next)).toBe(true)
    expect(next.seen).toBe(1)
    expect(next.total).toBe(1) // 原本 2 张,摘掉 1 张后只剩 1 张,分母对得上
  })
})

describe('与真实 gradeWord 集成:重来的卡会在会话内重新出现,且会话最终能结束', () => {
  const now = new Date(2026, 6, 25, 9, 0, 0) // 2026-07-25 本地时间,与 TODAY 对应

  it('新词打 good 两次毕业;新词打 easy 一次即毕业', () => {
    // alpha:两步学习(good, good)毕业;bravo:新词 easy 直接毕业
    let q = buildSessionQueue([], ['alpha', 'bravo'])
    const progress: Record<string, ProgressEntry> = {}

    // 第 1 张:alpha,新词
    expect(currentId(q)).toBe('alpha')
    progress['alpha'] = gradeWord(progress['alpha'], 'good', now, noFuzz)
    q = advance(q, 'alpha', progress['alpha'], TODAY)
    // 学习步长未走完 → 重新排到队尾
    expect(q.ids).toEqual(['bravo', 'alpha'])

    // 第 2 张:bravo,新词,easy 直接毕业
    expect(currentId(q)).toBe('bravo')
    progress['bravo'] = gradeWord(progress['bravo'], 'easy', now, noFuzz)
    q = advance(q, 'bravo', progress['bravo'], TODAY)
    expect(progress['bravo'].state).toBe('review')
    expect(q.ids).toEqual(['alpha']) // bravo 已毕业,不再出现

    // 第 3 张:alpha 重新出现,再打 good 走完第二步 → 毕业
    expect(currentId(q)).toBe('alpha')
    progress['alpha'] = gradeWord(progress['alpha'], 'good', now, noFuzz)
    q = advance(q, 'alpha', progress['alpha'], TODAY)
    expect(progress['alpha'].state).toBe('review')
    expect(q.ids).toEqual([])
    expect(isDone(q)).toBe(true)
    expect(q.seen).toBe(3)   // 打了 3 次分
    expect(q.total).toBe(3)  // 2 张初始 + 1 次重现插入
  })

  it('连续打"重来"会不断重新入队(不丢卡),但只要用户换一次评分,会话就能结束;进度分母随重现诚实增长', () => {
    let q = buildSessionQueue(['carol'], [])
    let carolEntry: ProgressEntry | undefined
    let againCount = 0

    // 模拟连续点了 5 次"重来",每次都应该重新出现在队列里,而不是被丢弃或卡死
    for (let i = 0; i < 5; i++) {
      expect(currentId(q)).toBe('carol') // 每次都轮到它(队列里只有它一张)
      carolEntry = gradeWord(carolEntry, 'again', now, noFuzz)
      q = advance(q, 'carol', carolEntry, TODAY)
      againCount++
      expect(isDone(q)).toBe(false)   // 还没完成
      expect(q.total).toBe(1 + againCount) // 分母随每次重来诚实增长,x/y 不会看起来卡住
      expect(q.seen).toBe(againCount)
    }

    // 用户终于打了"简单",直接毕业,会话立刻能结束 —— 证明不是死循环,只是行为使然
    carolEntry = gradeWord(carolEntry, 'easy', now, noFuzz)
    q = advance(q, 'carol', carolEntry, TODAY)
    expect(isDone(q)).toBe(true)
    expect(carolEntry.state).toBe('review')
  })
})
