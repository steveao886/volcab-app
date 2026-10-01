import { describe, expect, it } from 'vitest'
import { orderFreshWords } from './freshOrder'
import type { Word } from '../types'

const word = (id: string, usageScore?: number, over: Partial<Word> = {}): Word => ({
  id, headword: id, phonetic: '/x/', meanings: [{ pos: 'n.', en: 'x', zh: 'x' }],
  examples: ['a', 'b'], synonyms: [], antonyms: [], collocations: [], relatedForms: [],
  sourceNote: 't', addedAt: '2026-07-01',
  ...(usageScore === undefined ? {} : { usageScore }),
  ...over,
})

/** Positions far enough apart that the capture-proximity rule never fires — relatedness has to come from somewhere else. */
const spread = (words: readonly Word[]): Map<string, number> =>
  new Map(words.map((w, i) => [w.id, i * 100]))

/** Positions as captured, i.e. one after another, which is what makes neighbours related. */
const asCaptured = (words: readonly Word[]): Map<string, number> =>
  new Map(words.map((w, i) => [w.id, i]))

const ids = (ws: readonly Word[]): string[] => ws.map(w => w.id)

/** NATO-ish filler: no two share a five-character prefix, so none of them are ever related to each other. */
const filler = ['carol', 'delta', 'india', 'juliet', 'kilo', 'lima', 'mike', 'oscar', 'papa', 'quebec']
  .map(id => word(id, 5))

describe('orderFreshWords', () => {
  it('takes new words by encounter likelihood, high to low', () => {
    const pool = [word('alpha', 5), word('bravo', 9), word('carol', 7)]
    expect(ids(orderFreshWords(pool, spread(pool), 5, 3))).toEqual(['bravo', 'carol', 'alpha'])
  })

  it('sorts unscored words last — unscored does not mean high-frequency', () => {
    const pool = [word('alpha'), word('bravo', 1)]
    expect(ids(orderFreshWords(pool, spread(pool), 5, 2))).toEqual(['bravo', 'alpha'])
  })

  it('breaks ties by hash, so the result does not depend on word-list order', () => {
    const pool = [word('alpha', 5), word('bravo', 5), word('carol', 5), word('delta', 5)]
    const reversed = [...pool].reverse()
    // The two inputs differ, so an ordering that still leaned on array
    // position — the tiebreak this replaced — could not produce one answer.
    expect(ids(orderFreshWords(pool, spread(pool), 5, 4)))
      .toEqual(ids(orderFreshWords(reversed, spread(reversed), 5, 4)))
  })

  it('is stable across calls — the Today page and Review must agree on today\'s words', () => {
    const pool = [word('alpha', 5), word('bravo', 5), word('carol', 5)]
    const first = ids(orderFreshWords(pool, spread(pool), 5, 3))
    expect(ids(orderFreshWords(pool, spread(pool), 5, 3))).toEqual(first)
  })

  it('separates words captured next to each other — the synonym walk that started all this', () => {
    // alpha and bravo are array neighbours, i.e. tapped one after the other;
    // the filler is spread out so the pass has somewhere legal to put them.
    const pool = [word('alpha', 9), word('bravo', 9), ...filler]
    const index = new Map<string, number>([['alpha', 0], ['bravo', 1]])
    filler.forEach((w, i) => index.set(w.id, 100 + i * 100))
    const out = ids(orderFreshWords(pool, index, 3, pool.length))
    expect(Math.abs(out.indexOf('alpha') - out.indexOf('bravo'))).toBeGreaterThan(3)
  })

  it('separates a declared synonym even when the two were added months apart', () => {
    const pool = [word('alpha', 9, { synonyms: ['Bravo'] }), word('bravo', 9), ...filler]
    // spread() puts them 100 apart, so only the declared link can catch this.
    const out = ids(orderFreshWords(pool, spread(pool), 3, pool.length))
    expect(Math.abs(out.indexOf('alpha') - out.indexOf('bravo'))).toBeGreaterThan(3)
  })

  it('separates an antonym, and a related form, the same way', () => {
    const pool = [
      word('alpha', 9, { antonyms: ['bravo'] }),
      word('bravo', 9),
      word('carol', 9, { relatedForms: [{ form: 'delta', pos: 'n.', zh: 'x' }] }),
      word('delta', 9),
      ...filler.slice(2),
    ]
    const out = ids(orderFreshWords(pool, spread(pool), 3, pool.length))
    expect(Math.abs(out.indexOf('alpha') - out.indexOf('bravo'))).toBeGreaterThan(3)
    expect(Math.abs(out.indexOf('carol') - out.indexOf('delta'))).toBeGreaterThan(3)
  })

  it('separates the same word family — resent / resentment share a stem and nothing else', () => {
    const pool = [word('resent', 9), word('resentment', 9), ...filler]
    const out = ids(orderFreshWords(pool, spread(pool), 3, pool.length))
    expect(Math.abs(out.indexOf('resent') - out.indexOf('resentment'))).toBeGreaterThan(3)
  })

  it('does not call two words a family on a short or lopsided prefix', () => {
    // "form"/"formidable" share 4, and "post"/"posthumously" leave too long a
    // tail — a rule that caught these would space half the library apart.
    const pool = [word('form', 9), word('formidable', 9), word('post', 9), word('posthumously', 9)]
    expect(ids(orderFreshWords(pool, spread(pool), 4, 4)).sort())
      .toEqual(['form', 'formidable', 'post', 'posthumously'])
  })

  it('returns every word exactly once when the constraint cannot be satisfied', () => {
    // All five are array neighbours, so every pair is related and no pick is
    // ever legal. Failing open has to still deliver a full, unduplicated queue.
    const pool = ['alpha', 'bravo', 'carol', 'delta', 'india'].map(id => word(id, 5))
    const out = ids(orderFreshWords(pool, asCaptured(pool), 5, pool.length))
    expect(out).toHaveLength(5)
    expect(new Set(out).size).toBe(5)
  })

  it('stops at the limit, and the shortened run is a prefix of the full one', () => {
    const pool = [word('alpha', 9), word('bravo', 9), ...filler]
    const full = ids(orderFreshWords(pool, asCaptured(pool), 3, pool.length))
    expect(ids(orderFreshWords(pool, asCaptured(pool), 3, 4))).toEqual(full.slice(0, 4))
  })

  it('a zero or negative limit takes nothing, and a limit past the pool takes all of it', () => {
    const pool = [word('alpha', 5), word('bravo', 5)]
    expect(orderFreshWords(pool, spread(pool), 5, 0)).toEqual([])
    expect(orderFreshWords(pool, spread(pool), 5, -1)).toEqual([])
    expect(orderFreshWords(pool, spread(pool), 5, 99)).toHaveLength(2)
  })

  it('a zero gap turns the spacing off and leaves plain score order', () => {
    const pool = [word('alpha', 9), word('bravo', 9), ...filler]
    const out = ids(orderFreshWords(pool, asCaptured(pool), 0, 2))
    expect(out).toHaveLength(2)
    expect(out).toContain('alpha')
    expect(out).toContain('bravo')
  })

  it('handles an empty pool and a single word', () => {
    expect(orderFreshWords([], new Map(), 5, 5)).toEqual([])
    const one = [word('alpha', 5)]
    expect(ids(orderFreshWords(one, spread(one), 5, 5))).toEqual(['alpha'])
  })

  it('separates two words that share a synonym — a confusable pair no declared link records', () => {
    // Neither names the other; they meet only through "dreadful", which is
    // how appalling / atrocious-style families show up in contrast.ts.
    const pool = [
      word('alpha', 9, { synonyms: ['dreadful'] }),
      word('bravo', 9, { synonyms: ['dreadful'] }),
      ...filler,
    ]
    const out = ids(orderFreshWords(pool, spread(pool), 3, pool.length))
    expect(Math.abs(out.indexOf('alpha') - out.indexOf('bravo'))).toBeGreaterThan(3)
  })

  describe('lookback over recently started words', () => {
    it('defers a word related to one started in the last few days, which no gap inside today can see', () => {
      const recent = [word('bravo', 9)]
      const pool = [word('alpha', 9, { synonyms: ['bravo'] }), ...filler.slice(0, 4)]
      const out = ids(orderFreshWords(pool, spread(pool), 5, 4, recent))
      expect(out).not.toContain('alpha')
      expect(out).toHaveLength(4)
    })

    it('reads the link from either side — the started word may be the one that declares it', () => {
      const recent = [word('bravo', 9, { antonyms: ['alpha'] })]
      const pool = [word('alpha', 9), ...filler.slice(0, 4)]
      expect(ids(orderFreshWords(pool, spread(pool), 5, 4, recent))).not.toContain('alpha')
    })

    it('counts a shared stem and a shared synonym against a started word too', () => {
      const recent = [word('resent', 9), word('bravo', 9, { synonyms: ['dreadful'] })]
      const pool = [word('resentment', 9), word('alpha', 9, { synonyms: ['dreadful'] }), ...filler.slice(0, 4)]
      const out = ids(orderFreshWords(pool, spread(pool), 5, 4, recent))
      expect(out).not.toContain('resentment')
      expect(out).not.toContain('alpha')
    })

    it('does not apply capture proximity to a started word', () => {
      // Across a capture batch that rule is mostly noise: on 2026-10-01, 28 of
      // 416 adjacent unlearned pairs were related by anything else, and
      // applied across the lookback it left nothing legal to pick.
      const recent = [word('bravo', 5)]
      const pool = [word('alpha', 9), ...filler.slice(0, 3)]
      const index = new Map<string, number>([['bravo', 0], ['alpha', 1]])
      filler.forEach((w, i) => index.set(w.id, 100 + i * 100))
      expect(ids(orderFreshWords(pool, index, 5, 4, recent))[0]).toBe('alpha')
    })

    it('a word listed as both waiting and started is not blocked by itself', () => {
      // Words and progress can disagree; a word shares its own stem, so
      // without the guard it would defer itself behind the whole lookahead.
      const alpha = word('alpha', 9)
      const pool = [alpha, ...filler.slice(0, 4)]
      expect(ids(orderFreshWords(pool, spread(pool), 5, 1, [alpha]))).toEqual(['alpha'])
    })

    it('never returns a started word, and fails open rather than shrinking the day', () => {
      const recent = [word('bravo', 9)]
      const pool = [word('alpha', 9, { synonyms: ['bravo'] }), word('carol', 9, { synonyms: ['bravo'] })]
      const out = ids(orderFreshWords(pool, spread(pool), 5, 2, recent))
      expect(out.sort()).toEqual(['alpha', 'carol'])
    })
  })

  it('a word missing from the index map is still ordered, just without the capture rule', () => {
    // Words and progress can disagree about what exists (see CLAUDE.md); a
    // missing index must not throw or drop the word.
    const pool = [word('alpha', 5), word('bravo', 9)]
    expect(ids(orderFreshWords(pool, new Map(), 5, 2))).toEqual(['bravo', 'alpha'])
  })
})
