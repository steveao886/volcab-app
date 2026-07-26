import { describe, expect, it } from 'vitest'
import { SHARE_OPTIONS, isShareOrdered, normalizeMeanings, shareSum, validateShares } from './senseShare'
import type { Meaning } from '../types'

const m = (zh: string, share?: number): Meaning => ({ pos: 'v.', en: zh, zh, share })

describe('SHARE_OPTIONS', () => {
  it('是 10–90 的整十,不含 0 和 100', () => {
    expect(SHARE_OPTIONS).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90])
  })
})

describe('validateShares', () => {
  it('单义词不带 share 时通过', () => {
    expect(validateShares([m('唯一义')])).toBeNull()
  })

  it('单义词带 share 判错 —— 100% 是噪音,且会让「有 share 即多义词」失效', () => {
    expect(validateShares([m('唯一义', 100)])).toMatch(/单义/)
    expect(validateShares([m('唯一义', 90)])).toMatch(/单义/)
  })

  it('多义词全部带 share 且合计 100 时通过', () => {
    expect(validateShares([m('甲', 90), m('乙', 10)])).toBeNull()
    expect(validateShares([m('甲', 50), m('乙', 30), m('丙', 20)])).toBeNull()
  })

  it('多义词允许 50/50', () => {
    expect(validateShares([m('甲', 50), m('乙', 50)])).toBeNull()
  })

  it('多义词一条都没填时判错', () => {
    expect(validateShares([m('甲'), m('乙')])).toMatch(/每条/)
  })

  it('多义词只填了一部分时判错', () => {
    expect(validateShares([m('甲', 90), m('乙')])).toMatch(/每条/)
  })

  it('非整十判错', () => {
    expect(validateShares([m('甲', 85), m('乙', 15)])).toMatch(/整十/)
  })

  it('小数判错', () => {
    expect(validateShares([m('甲', 90.5), m('乙', 9.5)])).toMatch(/整十/)
  })

  it('超出 10–90 判错', () => {
    expect(validateShares([m('甲', 100), m('乙', 0)])).toMatch(/整十/)
  })

  it('合计不为 100 判错,并带上当前合计', () => {
    const err = validateShares([m('甲', 90), m('乙', 20)])
    expect(err).toMatch(/合计/)
    expect(err).toContain('110')
  })

  it('未按降序排列不算错 —— 排序由 normalizeMeanings 落库时负责', () => {
    expect(validateShares([m('甲', 10), m('乙', 90)])).toBeNull()
  })

  it('空数组不归它管,交给上游的「至少一条释义」校验', () => {
    expect(validateShares([])).toBeNull()
  })
})

describe('isShareOrdered', () => {
  it('降序为真', () => {
    expect(isShareOrdered([m('甲', 90), m('乙', 10)])).toBe(true)
  })

  it('相等视为有序(50/50)', () => {
    expect(isShareOrdered([m('甲', 50), m('乙', 50)])).toBe(true)
  })

  it('升序为假', () => {
    expect(isShareOrdered([m('甲', 10), m('乙', 90)])).toBe(false)
  })

  it('没有 share 时视为有序', () => {
    expect(isShareOrdered([m('甲'), m('乙')])).toBe(true)
    expect(isShareOrdered([m('唯一义')])).toBe(true)
  })
})

describe('normalizeMeanings', () => {
  it('多义词按 share 降序重排', () => {
    const out = normalizeMeanings([m('少见', 10), m('主流', 90)])
    expect(out.map(x => x.zh)).toEqual(['主流', '少见'])
  })

  it('占比相等时保持原有顺序(稳定排序)', () => {
    const out = normalizeMeanings([m('甲', 50), m('乙', 50)])
    expect(out.map(x => x.zh)).toEqual(['甲', '乙'])
  })

  it('单义词剥掉 share', () => {
    const out = normalizeMeanings([m('唯一义', 100)])
    expect(out).toHaveLength(1)
    expect('share' in out[0]).toBe(false)
  })

  it('单义词本来就没有 share 时原样返回', () => {
    const out = normalizeMeanings([m('唯一义')])
    expect(out[0].zh).toBe('唯一义')
    expect(out[0].share).toBeUndefined()
  })

  it('多义词都没有 share 时保持原顺序,不凭空造值', () => {
    const out = normalizeMeanings([m('甲'), m('乙')])
    expect(out.map(x => x.zh)).toEqual(['甲', '乙'])
    expect(out.every(x => x.share === undefined)).toBe(true)
  })

  it('不改动入参数组', () => {
    const input = [m('少见', 10), m('主流', 90)]
    normalizeMeanings(input)
    expect(input.map(x => x.zh)).toEqual(['少见', '主流'])
  })

  it('保留 share 之外的字段', () => {
    const out = normalizeMeanings([{ pos: 'n.', en: 'a thing', zh: '东西', share: 60 }, m('别的', 40)])
    expect(out[0]).toEqual({ pos: 'n.', en: 'a thing', zh: '东西', share: 60 })
  })
})

describe('shareSum', () => {
  it('求和', () => {
    expect(shareSum([m('甲', 90), m('乙', 10)])).toBe(100)
  })

  it('缺 share 的义项按 0 计 —— 表单合计提示要能显示「还差多少」', () => {
    expect(shareSum([m('甲', 90), m('乙')])).toBe(90)
  })

  it('空数组为 0', () => {
    expect(shareSum([])).toBe(0)
  })
})
