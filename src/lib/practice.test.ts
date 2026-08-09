import { describe, expect, it } from 'vitest'
import { PRACTICE_DRAW_SIZE, samplePractice } from './practice'
import type { Word } from '../types'

const word = (id: string): Word => ({
  id, headword: id, phonetic: '/x/', meanings: [{ pos: 'n.', en: 'x', zh: 'x' }],
  examples: ['a', 'b'], synonyms: [], antonyms: [], collocations: [], relatedForms: [], sourceNote: 't', addedAt: '2026-07-01',
})

const pool = (n: number): Word[] => Array.from({ length: n }, (_, i) => word(`w${i}`))

/**
 * A reproducible pseudo-random number generator. **Do not substitute
 * `() => 0.5`**: that makes shuffle's `Math.floor(0.5 * (i+1))` degenerate
 * into a fixed permutation, so the randomness being tested never moves.
 * Same generator as passage.test.ts, for the same reason.
 */
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('samplePractice', () => {
  it('draws PRACTICE_DRAW_SIZE words by default', () => {
    expect(samplePractice(pool(50), undefined, { rng: mulberry32(1) })).toHaveLength(PRACTICE_DRAW_SIZE)
  })

  it('same seed, same draw — the shuffle is entirely the injected rng', () => {
    const ids = (seed: number) => samplePractice(pool(50), 5, { rng: mulberry32(seed) }).map(w => w.id)
    expect(ids(7)).toEqual(ids(7))
  })

  it('actually shuffles: a different seed reorders the draw', () => {
    const ids = (seed: number) => samplePractice(pool(50), 20, { rng: mulberry32(seed) }).map(w => w.id)
    expect(ids(1)).not.toEqual(ids(2))
  })

  it('never repeats a word inside one draw', () => {
    const drawn = samplePractice(pool(30), 20, { rng: mulberry32(3) }).map(w => w.id)
    expect(new Set(drawn).size).toBe(drawn.length)
  })

  it('a pool smaller than the size returns all of it, not a padded or empty draw', () => {
    const drawn = samplePractice(pool(6), 20, { rng: mulberry32(4) })
    expect(drawn).toHaveLength(6)
    expect(new Set(drawn.map(w => w.id))).toEqual(new Set(['w0', 'w1', 'w2', 'w3', 'w4', 'w5']))
  })

  it('excludes what was already seen, so 另来一批 walks the slice instead of resampling it', () => {
    const seen = new Set(['w0', 'w1', 'w2'])
    const drawn = samplePractice(pool(5), 20, { rng: mulberry32(5), exclude: seen })
    expect(drawn.map(w => w.id).sort()).toEqual(['w3', 'w4'])
  })

  it('returns empty once the slice is exhausted — that is how the caller knows to stop offering a redraw', () => {
    const seen = new Set(['w0', 'w1', 'w2'])
    expect(samplePractice(pool(3), 20, { rng: mulberry32(6), exclude: seen })).toEqual([])
  })

  it('an empty pool is a normal outcome, not a throw — a bookmarked filter can match nothing', () => {
    expect(samplePractice([], 20, { rng: mulberry32(7) })).toEqual([])
  })

  it('a non-positive size draws nothing', () => {
    expect(samplePractice(pool(10), 0, { rng: mulberry32(8) })).toEqual([])
    expect(samplePractice(pool(10), -1, { rng: mulberry32(8) })).toEqual([])
  })

  it('leaves the caller\'s array alone — Library holds the same array it renders from', () => {
    const original = pool(10)
    const before = original.map(w => w.id)
    samplePractice(original, 5, { rng: mulberry32(9) })
    expect(original.map(w => w.id)).toEqual(before)
  })
})
