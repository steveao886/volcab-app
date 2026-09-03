import { beforeEach, describe, expect, it } from 'vitest'
import { practiceSizeOptions, preferredOption, readPracticeSize, writePracticeSize } from './practiceSize'
import { PRACTICE_DRAW_SIZE } from './practice'
import { storage } from './storage'

const labels = (poolSize: number): string[] => practiceSizeOptions(poolSize).map(o => o.label)

describe('practiceSizeOptions', () => {
  it('offers the steps below the pool, then 全部 carrying the pool count', () => {
    expect(labels(100)).toEqual(['10', '20', '30', '50', '全部 100'])
  })

  it('drops steps the pool cannot fill — no button that quietly does the same as its neighbour', () => {
    expect(labels(35)).toEqual(['10', '20', '30', '全部 35'])
    expect(labels(14)).toEqual(['10', '全部 14'])
  })

  it('a pool at a step exactly is 全部, not a duplicate pair', () => {
    expect(labels(10)).toEqual(['全部 10'])
  })

  it('a pool smaller than every step is 全部 alone', () => {
    expect(labels(3)).toEqual(['全部 3'])
    expect(practiceSizeOptions(3)[0].size).toBe(3)
  })

  it('an empty pool offers nothing, so the caller can skip the step', () => {
    expect(practiceSizeOptions(0)).toEqual([])
    expect(practiceSizeOptions(-1)).toEqual([])
  })
})

describe('preferredOption', () => {
  it('lights up the exact chip that was chosen last time', () => {
    expect(preferredOption(practiceSizeOptions(100), 30)?.label).toBe('30')
    expect(preferredOption(practiceSizeOptions(100), 'all')?.label).toBe('全部 100')
  })

  it('falls back to the largest chip that fits when the pool has shrunk past the remembered size', () => {
    // Remembered 50, but only 14 stubborn words left: 全部 14, not nothing.
    expect(preferredOption(practiceSizeOptions(14), 50)?.label).toBe('全部 14')
    expect(preferredOption(practiceSizeOptions(35), 50)?.label).toBe('全部 35')
  })

  it('always highlights something, so "same as last time" stays one tap', () => {
    for (const pool of [1, 3, 10, 14, 35, 100]) {
      for (const choice of [10, 20, 30, 50, 'all' as const]) {
        expect(preferredOption(practiceSizeOptions(pool), choice)).toBeDefined()
      }
    }
  })

  it('has nothing to highlight for an empty list', () => {
    expect(preferredOption([], 20)).toBeUndefined()
  })
})

describe('readPracticeSize', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to the size every session used to be', () => {
    expect(readPracticeSize()).toBe(PRACTICE_DRAW_SIZE)
  })

  it('round-trips a count and 全部', () => {
    writePracticeSize(50)
    expect(readPracticeSize()).toBe(50)
    writePracticeSize('all')
    expect(readPracticeSize()).toBe('all')
  })

  it('falls back to the default on a stored value that could not have come from a chip', () => {
    for (const bad of ['20', 0, -5, 12.5, null, {}, [], true]) {
      storage.set('practiceSize', bad)
      expect(readPracticeSize()).toBe(PRACTICE_DRAW_SIZE)
    }
  })

  it('keeps a remembered count the current pool cannot offer — preferredOption resolves it, not this', () => {
    writePracticeSize(50)
    expect(readPracticeSize()).toBe(50)
  })
})
