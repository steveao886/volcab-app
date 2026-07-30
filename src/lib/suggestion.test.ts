import { describe, expect, it } from 'vitest'
import { availableSuggestions, rankSuggestions } from './suggestion'
import type { Suggestion } from './suggestion'
import type { StagingItem, Word } from '../types'

const sug = (id: string, over: Partial<Suggestion> = {}): Suggestion => ({
  id, headword: id.replace(/-/g, ' '), kind: 'phrasal',
  zh: 'x', en: 'x', usageScore: 5, example: 'x', ...over,
})

const word = (id: string, headword = id): Word => ({
  id, headword, phonetic: '/x/', meanings: [{ pos: 'v.', en: 'x', zh: 'x' }],
  examples: ['a', 'b'], synonyms: [], antonyms: [], collocations: [],
  relatedForms: [], sourceNote: 'manual', addedAt: '2026-07-01',
})

const staged = (headword: string): StagingItem => ({ headword, addedAt: '2026-07-01' })
const empty = { words: [], staging: [], dismissed: [] }
const ids = (xs: Suggestion[]) => xs.map(s => s.id)

describe('availableSuggestions', () => {
  it('offers everything when nothing has been settled yet', () => {
    expect(ids(availableSuggestions([sug('put-off'), sug('call-off')], empty))).toEqual(['put-off', 'call-off'])
  })

  it('drops what is already in the library', () => {
    const pool = [sug('put-off'), sug('call-off')]
    expect(ids(availableSuggestions(pool, { ...empty, words: [word('put-off', 'put off')] }))).toEqual(['call-off'])
  })

  it('drops what is already staged — accepted but not yet enriched, which can take until the next session', () => {
    const pool = [sug('put-off'), sug('call-off')]
    expect(ids(availableSuggestions(pool, { ...empty, staging: [staged('put off')] }))).toEqual(['call-off'])
  })

  it('drops what was dismissed — being asked again is the whole thing this prevents', () => {
    const pool = [sug('put-off'), sug('call-off')]
    expect(ids(availableSuggestions(pool, { ...empty, dismissed: ['put-off'] }))).toEqual(['call-off'])
  })

  it('matches on the headword too, not just the id', () => {
    // A word added through the manual /add form derives its own id, and
    // nothing guarantees that derivation matches the pool's id for the same
    // phrase — so an id-only check would re-offer a word the user owns.
    const pool = [sug('put-off', { headword: 'put off' })]
    expect(availableSuggestions(pool, { ...empty, words: [word('putoff', 'put off')] })).toEqual([])
  })

  it('ignores case and stray whitespace on both sides', () => {
    const pool = [sug('put-off', { headword: 'put off' })]
    expect(availableSuggestions(pool, { ...empty, staging: [staged('  Put   Off ')] })).toEqual([])
  })

  it('an empty pool is not an error', () => {
    expect(availableSuggestions([], { ...empty, dismissed: ['x'] })).toEqual([])
  })
})

describe('rankSuggestions', () => {
  it('most likely to be met comes first', () => {
    const pool = [sug('rare', { usageScore: 3 }), sug('common', { usageScore: 9 }), sug('mid', { usageScore: 6 })]
    expect(ids(rankSuggestions(pool))).toEqual(['common', 'mid', 'rare'])
  })

  it('ties break on id, so the order never shifts between renders', () => {
    const pool = [sug('b', { usageScore: 7 }), sug('a', { usageScore: 7 })]
    expect(ids(rankSuggestions(pool))).toEqual(['a', 'b'])
  })

  it('does not mutate its input', () => {
    const pool = [sug('b', { usageScore: 1 }), sug('a', { usageScore: 9 })]
    rankSuggestions(pool)
    expect(ids(pool)).toEqual(['b', 'a'])
  })
})
