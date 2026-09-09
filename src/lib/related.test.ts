import { describe, expect, it } from 'vitest'
import { declaredLinks, isRelated, sharesStem, spaceApart } from './related'
import type { Word } from '../types'

const word = (id: string, over: Partial<Word> = {}): Word => ({
  id, headword: id, phonetic: '/x/', meanings: [{ pos: 'n.', en: 'x', zh: 'x' }],
  examples: ['a', 'b'], synonyms: [], antonyms: [], collocations: [], relatedForms: [],
  sourceNote: 't', addedAt: '2026-07-01', usageScore: 5,
  ...over,
})

describe('sharesStem', () => {
  it('catches the word families it exists for', () => {
    expect(sharesStem('resent', 'resentful')).toBe(true)
    expect(sharesStem('resentful', 'resentment')).toBe(true)
    expect(sharesStem('deceive', 'deceit')).toBe(true)
    expect(sharesStem('advocate', 'advocacy')).toBe(true)
    expect(sharesStem('discontent', 'discontented')).toBe(true)
  })

  it('needs five shared characters, so short coincidences do not fire', () => {
    expect(sharesStem('deft', 'defame')).toBe(false)
    expect(sharesStem('inept', 'inert')).toBe(false)
  })

  it('needs a short tail, so a long word is not swallowed by a shared prefix', () => {
    expect(sharesStem('interchange', 'intercession')).toBe(false)
  })

  it('accepts its known false positives — a wrong pairing costs a day, not a memory', () => {
    // Documented in the intake spec as ~5 of 75 hits. Pinned rather than
    // fixed: tightening the rule to exclude them would cost real families.
    expect(sharesStem('impasse', 'impassive')).toBe(true)
    expect(sharesStem('underhand', 'undermine')).toBe(true)
  })

  it('is symmetric', () => {
    expect(sharesStem('renown', 'renowned')).toBe(sharesStem('renowned', 'renown'))
  })
})

describe('declaredLinks', () => {
  it('links both directions from a one-way synonym pointer', () => {
    const pool = [word('alpha', { synonyms: ['bravo'] }), word('bravo')]
    const links = declaredLinks(pool)
    expect(links.get('alpha')!.has('bravo')).toBe(true)
    expect(links.get('bravo')!.has('alpha')).toBe(true)
  })

  it('reads antonyms and related forms too, not just synonyms', () => {
    const pool = [
      word('alpha', { antonyms: ['bravo'], relatedForms: [{ form: 'carol', pos: 'n.', zh: 'x' }] }),
      word('bravo'), word('carol'),
    ]
    const links = declaredLinks(pool)
    expect(links.get('alpha')!.has('bravo')).toBe(true)
    expect(links.get('alpha')!.has('carol')).toBe(true)
  })

  it('ignores pointers at words outside the pool — only relations between two ordered words matter', () => {
    const pool = [word('alpha', { synonyms: ['nowhere'] })]
    expect(declaredLinks(pool).get('alpha')!.size).toBe(0)
  })

  it('ignores a word pointing at itself', () => {
    const pool = [word('alpha', { synonyms: ['alpha'] })]
    expect(declaredLinks(pool).get('alpha')!.has('alpha')).toBe(false)
  })

  it('matches case-insensitively, since the pointer is prose and the id is not', () => {
    const pool = [word('alpha', { synonyms: ['BRAVO'] }), word('bravo')]
    expect(declaredLinks(pool).get('bravo')!.has('alpha')).toBe(true)
  })
})

describe('isRelated', () => {
  it('fires on a declared link', () => {
    const links = declaredLinks([word('alpha', { synonyms: ['bravo'] }), word('bravo')])
    expect(isRelated('alpha', 'bravo', links)).toBe(true)
  })

  it('fires on a shared stem with no declared link at all', () => {
    const links = declaredLinks([word('resent'), word('resentment')])
    expect(isRelated('resent', 'resentment', links)).toBe(true)
  })

  it('does not fire on capture-order adjacency — that rule belongs to the intake pool only', () => {
    // angular and canonicalization are neighbours in words.json and share a
    // due date; over the review population that proxy is noise (64 of 80).
    const links = declaredLinks([word('angular'), word('canonicalization')])
    expect(isRelated('angular', 'canonicalization', links)).toBe(false)
  })
})

describe('spaceApart', () => {
  const related = (a: string, b: string) => a[0] === b[0]

  it('is a permutation of its input — never drops, never duplicates', () => {
    const input = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2']
    const out = spaceApart(input, related, 2)
    expect([...out].sort()).toEqual([...input].sort())
  })

  it('leaves an order alone when nothing in it is related', () => {
    const input = ['a1', 'b1', 'c1', 'd1']
    expect(spaceApart(input, related, 3)).toEqual(input)
  })

  it('separates the related pair the sort put back to back', () => {
    const out = spaceApart(['a1', 'a2', 'b1', 'c1', 'd1'], related, 2)
    expect(Math.abs(out.indexOf('a1') - out.indexOf('a2'))).toBeGreaterThan(2)
  })

  it('fails open rather than looping when everything left is related', () => {
    const input = ['a1', 'a2', 'a3']
    expect(spaceApart(input, related, 2)).toEqual(input)
  })

  it('does nothing at gap 0, so the feature can be turned off by a number', () => {
    const input = ['a1', 'a2', 'b1']
    expect(spaceApart(input, related, 0)).toEqual(input)
  })

  it('handles an empty list', () => {
    expect(spaceApart([], related, 5)).toEqual([])
  })
})
