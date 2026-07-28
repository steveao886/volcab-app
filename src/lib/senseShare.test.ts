import { describe, expect, it } from 'vitest'
import { SHARE_OPTIONS, isShareOrdered, normalizeMeanings, shareSum, validateShares } from './senseShare'
import type { Meaning } from '../types'

const m = (zh: string, share?: number): Meaning => ({ pos: 'v.', en: zh, zh, share })

describe('SHARE_OPTIONS', () => {
  it('is the multiples of ten from 10 to 90, excluding 0 and 100', () => {
    expect(SHARE_OPTIONS).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90])
  })
})

describe('validateShares', () => {
  it('passes when a single-sense word has no share', () => {
    expect(validateShares([m('唯一义')])).toBeNull()
  })

  it('a single-sense word with a share is an error — 100% is noise, and it would break the "having a share means multi-sense" rule', () => {
    expect(validateShares([m('唯一义', 100)])).toMatch(/单义/)
    expect(validateShares([m('唯一义', 90)])).toMatch(/单义/)
  })

  it('passes when a multi-sense word has shares on every sense summing to 100', () => {
    expect(validateShares([m('甲', 90), m('乙', 10)])).toBeNull()
    expect(validateShares([m('甲', 50), m('乙', 30), m('丙', 20)])).toBeNull()
  })

  it('a multi-sense word allows 50/50', () => {
    expect(validateShares([m('甲', 50), m('乙', 50)])).toBeNull()
  })

  it('errors when a multi-sense word has no shares filled in at all', () => {
    expect(validateShares([m('甲'), m('乙')])).toMatch(/每条/)
  })

  it('errors when a multi-sense word only has some shares filled in', () => {
    expect(validateShares([m('甲', 90), m('乙')])).toMatch(/每条/)
  })

  it('errors when not a multiple of ten', () => {
    expect(validateShares([m('甲', 85), m('乙', 15)])).toMatch(/整十/)
  })

  it('errors on decimals', () => {
    expect(validateShares([m('甲', 90.5), m('乙', 9.5)])).toMatch(/整十/)
  })

  it('errors when outside the 10-90 range', () => {
    expect(validateShares([m('甲', 100), m('乙', 0)])).toMatch(/整十/)
  })

  it('errors when the total is not 100, and includes the current total', () => {
    const err = validateShares([m('甲', 90), m('乙', 20)])
    expect(err).toMatch(/合计/)
    expect(err).toContain('110')
  })

  it("not being sorted descending is not an error — ordering is normalizeMeanings' job at save time", () => {
    expect(validateShares([m('甲', 10), m('乙', 90)])).toBeNull()
  })

  it('an empty array is not this function\'s concern — that is handled by the upstream "at least one sense" validation', () => {
    expect(validateShares([])).toBeNull()
  })
})

describe('isShareOrdered', () => {
  it('descending is true', () => {
    expect(isShareOrdered([m('甲', 90), m('乙', 10)])).toBe(true)
  })

  it('equal values count as ordered (50/50)', () => {
    expect(isShareOrdered([m('甲', 50), m('乙', 50)])).toBe(true)
  })

  it('ascending is false', () => {
    expect(isShareOrdered([m('甲', 10), m('乙', 90)])).toBe(false)
  })

  it('no shares counts as ordered', () => {
    expect(isShareOrdered([m('甲'), m('乙')])).toBe(true)
    expect(isShareOrdered([m('唯一义')])).toBe(true)
  })
})

describe('normalizeMeanings', () => {
  it('a multi-sense word is re-sorted by share descending', () => {
    const out = normalizeMeanings([m('少见', 10), m('主流', 90)])
    expect(out.map(x => x.zh)).toEqual(['主流', '少见'])
  })

  it('keeps the original order when shares are equal (stable sort)', () => {
    const out = normalizeMeanings([m('甲', 50), m('乙', 50)])
    expect(out.map(x => x.zh)).toEqual(['甲', '乙'])
  })

  it('strips share from a single-sense word', () => {
    const out = normalizeMeanings([m('唯一义', 100)])
    expect(out).toHaveLength(1)
    expect('share' in out[0]).toBe(false)
  })

  it('returns as-is when a single-sense word already had no share', () => {
    const out = normalizeMeanings([m('唯一义')])
    expect(out[0].zh).toBe('唯一义')
    expect(out[0].share).toBeUndefined()
  })

  it('keeps the original order when a multi-sense word has no shares at all, without inventing values', () => {
    const out = normalizeMeanings([m('甲'), m('乙')])
    expect(out.map(x => x.zh)).toEqual(['甲', '乙'])
    expect(out.every(x => x.share === undefined)).toBe(true)
  })

  it('does not mutate the input array', () => {
    const input = [m('少见', 10), m('主流', 90)]
    normalizeMeanings(input)
    expect(input.map(x => x.zh)).toEqual(['少见', '主流'])
  })

  it('preserves fields other than share', () => {
    const out = normalizeMeanings([{ pos: 'n.', en: 'a thing', zh: '东西', share: 60 }, m('别的', 40)])
    expect(out[0]).toEqual({ pos: 'n.', en: 'a thing', zh: '东西', share: 60 })
  })
})

describe('shareSum', () => {
  it('sums the values', () => {
    expect(shareSum([m('甲', 90), m('乙', 10)])).toBe(100)
  })

  it('a sense missing share counts as 0 — the form\'s total display needs to be able to show "how much is left"', () => {
    expect(shareSum([m('甲', 90), m('乙')])).toBe(90)
  })

  it('an empty array is 0', () => {
    expect(shareSum([])).toBe(0)
  })
})
