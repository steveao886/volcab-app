import { describe, expect, it } from 'vitest'
import { antonymIndex, buildAntonymPairs } from './antonym'
import type { Word } from '../types'

const w = (id: string, antonyms: string[], pos = 'adj.'): Word => ({
  id, headword: id, phonetic: `/${id}/`,
  meanings: [{ pos, en: `def of ${id}`, zh: `${id}义` }],
  examples: [`We saw something ${id} today.`, `It felt ${id} again.`],
  synonyms: [`${id}-syn`], antonyms, collocations: [`${id} thing`],
  relatedForms: [], sourceNote: 't', addedAt: '2026-07-01',
})

const has = (pairs: ReturnType<typeof buildAntonymPairs>, x: string, y: string) => {
  const [a, b] = x < y ? [x, y] : [y, x]
  return pairs.some(p => p.a === a && p.b === b)
}

describe('buildAntonymPairs', () => {
  it('one side naming the other is enough — 52 of the library\'s 69 pairs are authored on one side only', () => {
    const pairs = buildAntonymPairs([w('alpha', ['bravo']), w('bravo', [])])
    expect(pairs).toHaveLength(1)
    expect(has(pairs, 'alpha', 'bravo')).toBe(true)
  })

  it('mutual naming yields one pair, not two', () => {
    const pairs = buildAntonymPairs([w('alpha', ['bravo']), w('bravo', ['alpha'])])
    expect(pairs).toHaveLength(1)
  })

  it('a pair is normalized to lexical order, so the same pair never appears twice', () => {
    const pairs = buildAntonymPairs([w('zulu', ['alpha']), w('alpha', ['zulu'])])
    expect(pairs).toEqual([{ a: 'alpha', b: 'zulu' }])
  })

  it('an antonym that is not a library headword is skipped rather than invented', () => {
    expect(buildAntonymPairs([w('alpha', ['nowhere-word']), w('bravo', [])])).toEqual([])
  })

  it('matching is case- and whitespace-insensitive, the way contrast.ts normalizes', () => {
    expect(has(buildAntonymPairs([w('alpha', ['  BRAVO ']), w('bravo', [])]), 'alpha', 'bravo')).toBe(true)
  })

  /**
   * The empty-string trap contrast.ts documents one file over: without this
   * guard every word carrying a blank antonym entry would pair with every
   * other one via "both name the empty headword".
   */
  it('blank antonym entries pair with nothing', () => {
    expect(buildAntonymPairs([w('alpha', ['', '   ']), w('bravo', ['  '])])).toEqual([])
  })

  it('a multi-word headword matches on its written form', () => {
    const adHoc = { ...w('ad-hoc', []), headword: 'ad hoc' }
    expect(has(buildAntonymPairs([w('alpha', ['ad hoc']), adHoc]), 'alpha', 'ad-hoc')).toBe(true)
  })
})

describe('antonymIndex', () => {
  it('is symmetric even when the authoring is one-sided', () => {
    const idx = antonymIndex([w('alpha', ['bravo']), w('bravo', [])])
    expect([...(idx.get('alpha') ?? [])]).toEqual(['bravo'])
    expect([...(idx.get('bravo') ?? [])]).toEqual(['alpha'])
  })

  /**
   * The reason this returns a set per word rather than the answer alone:
   * 25 of the library's 106 antonym-paired words carry more than one
   * opposite (antagonize and agreeable have four each), and every one of
   * them has to be kept out of the distractors or the question ships with
   * two correct answers.
   */
  it('collects every opposite a word has, not just the first', () => {
    const idx = antonymIndex([
      w('antagonize', ['placate', 'conciliate', 'appease']),
      w('placate', []), w('conciliate', []), w('appease', []),
    ])
    expect([...(idx.get('antagonize') ?? [])].sort()).toEqual(['appease', 'conciliate', 'placate'])
  })

  it('a word with no library antonym is absent rather than mapped to an empty set', () => {
    expect(antonymIndex([w('alpha', ['nowhere-word'])]).has('alpha')).toBe(false)
  })
})
