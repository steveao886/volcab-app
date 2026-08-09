import { describe, expect, it } from 'vitest'
import { buildMixedPractice, mixedPracticePool, PRACTICE_DRAW_SIZE, samplePractice } from './practice'
import { INITIAL_EASE } from './srs'
import { emptyProgress } from '../types'
import type { Progress, Word } from '../types'

/** Fixed date for difficultyWeight's recent-miss window. Fixtures below carry no missedAt unless a test sets one, so this only matters where one does. */
const TODAY = '2026-08-08'


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

describe('buildMixedPractice', () => {
  // 'review' + ease below initial => struggling; 'review' at initial ease => merely mastered.
  const prog = (spec: Record<string, { ease: number; state?: 'review' | 'learning' | 'new' }>): Progress => {
    const p = emptyProgress()
    for (const [id, s] of Object.entries(spec)) {
      p.words[id] = {
        state: s.state ?? 'review', ease: s.ease, intervalDays: 5, due: '2026-09-01',
        stepIndex: 0, reps: 4, lapses: s.ease < INITIAL_EASE ? 1 : 0, lastReviewedAt: '2026-08-01T00:00:00Z',
      }
    }
    return p
  }
  const hardIds = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`h${i}`, { ease: 2.0 }]))
  const easyIds = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`e${i}`, { ease: INITIAL_EASE }]))
  const setup = (nHard: number, nEasy: number) => {
    const spec = { ...hardIds(nHard), ...easyIds(nEasy) }
    return { words: Object.keys(spec).map(word), progress: prog(spec) }
  }

  it('splits the deck down the middle: half struggling, half merely mastered', () => {
    const { words, progress } = setup(30, 30)
    const drawn = buildMixedPractice(words, progress, TODAY, 20, { rng: mulberry32(1) })
    expect(drawn).toHaveLength(20)
    expect(drawn.filter(w => w.id.startsWith('h'))).toHaveLength(10)
    expect(drawn.filter(w => w.id.startsWith('e'))).toHaveLength(10)
  })

  it('never repeats a word, even though a struggling word is also a mastered word', () => {
    const { words, progress } = setup(30, 30)
    const drawn = buildMixedPractice(words, progress, TODAY, 20, { rng: mulberry32(2) })
    expect(new Set(drawn.map(w => w.id)).size).toBe(20)
  })

  it('does not hand back the same ten hard words every session — the frozen-list failure', () => {
    const { words, progress } = setup(40, 40)
    const a = buildMixedPractice(words, progress, TODAY, 20, { rng: mulberry32(3) }).filter(w => w.id.startsWith('h'))
    const b = buildMixedPractice(words, progress, TODAY, 20, { rng: mulberry32(9) }).filter(w => w.id.startsWith('h'))
    expect(a.map(w => w.id).sort()).not.toEqual(b.map(w => w.id).sort())
  })

  it('backfills from the mastered side when there are barely any struggling words', () => {
    const { words, progress } = setup(2, 40)
    const drawn = buildMixedPractice(words, progress, TODAY, 20, { rng: mulberry32(4) })
    expect(drawn).toHaveLength(20)
    expect(drawn.filter(w => w.id.startsWith('h')).length).toBeLessThanOrEqual(2)
  })

  it('backfills from the struggling side when almost nothing is merely mastered', () => {
    const { words, progress } = setup(40, 2)
    const drawn = buildMixedPractice(words, progress, TODAY, 20, { rng: mulberry32(5) })
    expect(drawn).toHaveLength(20)
    expect(drawn.filter(w => w.id.startsWith('h')).length).toBeGreaterThanOrEqual(18)
  })

  it('honours the exclusion set, so a redraw walks on instead of resampling', () => {
    const { words, progress } = setup(10, 10)
    const first = buildMixedPractice(words, progress, TODAY, 10, { rng: mulberry32(6) })
    const second = buildMixedPractice(words, progress, TODAY, 10, { rng: mulberry32(7), exclude: new Set(first.map(w => w.id)) })
    expect(second.some(w => first.some(f => f.id === w.id))).toBe(false)
  })

  it('ignores never-studied and still-learning words — this is practice over what you have already met', () => {
    const p = prog({ a: { ease: INITIAL_EASE }, b: { ease: INITIAL_EASE, state: 'learning' }, c: { ease: INITIAL_EASE, state: 'new' } })
    const drawn = buildMixedPractice([word('a'), word('b'), word('c'), word('d')], p, TODAY, 20, { rng: mulberry32(8) })
    expect(drawn.map(w => w.id)).toEqual(['a'])
  })

  it('an empty library is a normal outcome, not a throw', () => {
    expect(buildMixedPractice([], emptyProgress(), TODAY, 20, { rng: mulberry32(1) })).toEqual([])
    expect(buildMixedPractice(setup(5, 5).words, setup(5, 5).progress, TODAY, 0, { rng: mulberry32(1) })).toEqual([])
  })
})

describe('mixedPracticePool', () => {
  it('is the union of struggling and mastered, each word once', () => {
    const p = emptyProgress()
    const mk = (ease: number) => ({ state: 'review' as const, ease, intervalDays: 5, due: '2026-09-01', stepIndex: 0, reps: 4, lapses: 0, lastReviewedAt: '2026-08-01T00:00:00Z' })
    p.words['hard'] = mk(2.0)       // struggling AND review — must appear once, not twice
    p.words['easy'] = mk(INITIAL_EASE)
    p.words['fresh'] = { ...mk(INITIAL_EASE), state: 'new' }
    const pool = mixedPracticePool([word('hard'), word('easy'), word('fresh')], p)
    expect(pool.map(w => w.id).sort()).toEqual(['easy', 'hard'])
  })
})
