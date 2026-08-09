import { describe, expect, it } from 'vitest'
import { emptyProgress } from '../types'
import type { Progress, Word } from '../types'
import { ALL_WORDS, distinctSourceNotes, filterToParams, filterWords, paramsToFilter, wordState } from './libraryFilter'
import type { LibraryFilterOptions } from './libraryFilter'

function mkWord(overrides: Partial<Word> & { id: string }): Word {
  return {
    headword: overrides.id,
    phonetic: '/x/',
    meanings: [{ pos: 'v.', en: 'to do something', zh: '做某事' }],
    examples: [],
    synonyms: [],
    antonyms: [],
    collocations: [],
    relatedForms: [],
    sourceNote: 'manual',
    addedAt: '2026-07-01',
    ...overrides,
  }
}

const ids = (words: Word[]) => words.map(w => w.id)

describe('filterWords - search: case sensitivity and matched fields', () => {
  it('case-insensitive: an uppercase query matches a lowercase headword', () => {
    const words = [mkWord({ id: 'abrogate', headword: 'abrogate' })]
    const result = filterWords(words, emptyProgress(), { query: 'ABRO', status: 'all', sourceNote: null })
    expect(ids(result)).toEqual(['abrogate'])
  })

  it('a mixed-case query also matches an uppercase word inside a meaning', () => {
    const words = [
      mkWord({
        id: 'nasa-related',
        headword: 'orbit',
        meanings: [{ pos: 'n.', en: 'a path around NASA facilities', zh: '轨道' }],
      }),
    ]
    expect(ids(filterWords(words, emptyProgress(), { query: 'nasa', status: 'all', sourceNote: null }))).toEqual([
      'nasa-related',
    ])
  })

  it('Latin letters inside a zh meaning are likewise case-insensitive', () => {
    // Chinese meanings commonly mix in English abbreviations (AI, CEO,
    // DNA...). The query is lowercased; if zh weren't lowercased too,
    // matching against these words would become case-sensitive — this
    // test is exactly what guards against that regression.
    const words = [
      mkWord({
        id: 'algorithm',
        headword: 'algorithm',
        meanings: [{ pos: 'n.', en: 'a set of rules', zh: 'AI 系统里的算法' }],
      }),
    ]
    expect(ids(filterWords(words, emptyProgress(), { query: 'ai', status: 'all', sourceNote: null }))).toEqual([
      'algorithm',
    ])
  })

  it('a match landing on the second or later meaning still counts', () => {
    // Search must iterate every meaning, not just look at the first one.
    const words = [
      mkWord({
        id: 'concoct',
        headword: 'concoct',
        meanings: [
          { pos: 'v.', en: 'to make up a story', zh: '编造' },
          { pos: 'v.', en: 'to prepare a drink', zh: '调制饮料' },
        ],
      }),
    ]
    expect(ids(filterWords(words, emptyProgress(), { query: 'drink', status: 'all', sourceNote: null }))).toEqual([
      'concoct',
    ])
    expect(ids(filterWords(words, emptyProgress(), { query: '调制', status: 'all', sourceNote: null }))).toEqual([
      'concoct',
    ])
  })

  it('en meaning substring match, even when the headword contains none of the query', () => {
    const words = [
      mkWord({ id: 'abrogate', headword: 'abrogate', meanings: [{ pos: 'v.', en: 'to formally cancel a law', zh: '正式废除' }] }),
      mkWord({ id: 'unrelated', headword: 'unrelated', meanings: [{ pos: 'adj.', en: 'not connected', zh: '无关的' }] }),
    ]
    expect(ids(filterWords(words, emptyProgress(), { query: 'cancel', status: 'all', sourceNote: null }))).toEqual([
      'abrogate',
    ])
  })

  it('zh meaning substring match, even when the headword contains none of the query', () => {
    const words = [
      mkWord({ id: 'abrogate', headword: 'abrogate', meanings: [{ pos: 'v.', en: 'to formally cancel a law', zh: '正式废除' }] }),
      mkWord({ id: 'unrelated', headword: 'unrelated', meanings: [{ pos: 'adj.', en: 'not connected', zh: '无关的' }] }),
    ]
    expect(ids(filterWords(words, emptyProgress(), { query: '废除', status: 'all', sourceNote: null }))).toEqual([
      'abrogate',
    ])
  })

  it('an empty query returns every entry, sorted alphabetically by headword', () => {
    const words = [mkWord({ id: 'zebra', headword: 'zebra' }), mkWord({ id: 'abrogate', headword: 'abrogate' })]
    expect(ids(filterWords(words, emptyProgress(), { query: '', status: 'all', sourceNote: null }))).toEqual([
      'abrogate',
      'zebra',
    ])
  })

  it('leading/trailing whitespace on the query is ignored', () => {
    const words = [mkWord({ id: 'abrogate', headword: 'abrogate' })]
    expect(ids(filterWords(words, emptyProgress(), { query: '  abro  ', status: 'all', sourceNote: null }))).toEqual([
      'abrogate',
    ])
  })
})

describe('filterWords - sorting: headword prefix beats headword substring, substring beats meaning match', () => {
  it('three-tier match order: headword prefix > headword substring > meaning-only match, alphabetical within a tier', () => {
    const words = [
      mkWord({ id: 'precancel', headword: 'precancel' }), // headword substring (not a prefix)
      mkWord({ id: 'abrogate', headword: 'abrogate', meanings: [{ pos: 'v.', en: 'to formally cancel a law', zh: '正式废除' }] }), // meaning-only match
      mkWord({ id: 'cancelable', headword: 'cancelable' }), // headword prefix
    ]
    const result = filterWords(words, emptyProgress(), { query: 'cancel', status: 'all', sourceNote: null })
    expect(ids(result)).toEqual(['cancelable', 'precancel', 'abrogate'])
  })

  it('non-matching entries are excluded', () => {
    const words = [mkWord({ id: 'abrogate', headword: 'abrogate' }), mkWord({ id: 'zzz', headword: 'zzz' })]
    expect(ids(filterWords(words, emptyProgress(), { query: 'abro', status: 'all', sourceNote: null }))).toEqual([
      'abrogate',
    ])
  })
})

describe('filterWords - status filter', () => {
  const words = [mkWord({ id: 'a', headword: 'alpha' }), mkWord({ id: 'b', headword: 'bravo' }), mkWord({ id: 'c', headword: 'carol' })]

  it('a missing record in progress is treated as new, matching "not yet learned"', () => {
    const progress: Progress = emptyProgress()
    progress.words['b'] = { state: 'learning', ease: 2.5, intervalDays: 0, due: '2026-07-25', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-25T00:00:00Z' }
    expect(ids(filterWords(words, progress, { query: '', status: 'new', sourceNote: null }))).toEqual(['a', 'c'])
  })

  it('learning / review match progress.state exactly', () => {
    const progress: Progress = emptyProgress()
    progress.words['b'] = { state: 'learning', ease: 2.5, intervalDays: 0, due: '2026-07-25', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-25T00:00:00Z' }
    progress.words['c'] = { state: 'review', ease: 2.5, intervalDays: 10, due: '2026-08-01', stepIndex: 0, reps: 3, lapses: 0, lastReviewedAt: '2026-07-25T00:00:00Z' }
    expect(ids(filterWords(words, progress, { query: '', status: 'learning', sourceNote: null }))).toEqual(['b'])
    expect(ids(filterWords(words, progress, { query: '', status: 'review', sourceNote: null }))).toEqual(['c'])
  })

  it('status:"all" applies no status filtering at all', () => {
    expect(ids(filterWords(words, emptyProgress(), { query: '', status: 'all', sourceNote: null }))).toEqual([
      'a',
      'b',
      'c',
    ])
  })
})

describe('filterWords - sourceNote filter', () => {
  const words = [
    mkWord({ id: 'a', headword: 'alpha', sourceNote: '8-11' }),
    mkWord({ id: 'b', headword: 'bravo', sourceNote: '12-15' }),
    mkWord({ id: 'c', headword: 'carol', sourceNote: '8-11' }),
  ]

  it('no filtering when sourceNote is null', () => {
    expect(ids(filterWords(words, emptyProgress(), { query: '', status: 'all', sourceNote: null }))).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('only entries matching exactly are kept when sourceNote is specified', () => {
    expect(ids(filterWords(words, emptyProgress(), { query: '', status: 'all', sourceNote: '8-11' }))).toEqual([
      'a',
      'c',
    ])
  })
})

describe('filterWords - the two filter groups are ANDed together', () => {
  it('status filter and sourceNote filter both apply at once, and both must be satisfied to keep an entry', () => {
    const words = [
      mkWord({ id: 'a', headword: 'alpha', sourceNote: '8-11' }),
      mkWord({ id: 'b', headword: 'bravo', sourceNote: '8-11' }),
      mkWord({ id: 'c', headword: 'carol', sourceNote: '12-15' }),
    ]
    const progress: Progress = emptyProgress()
    progress.words['a'] = { state: 'review', ease: 2.5, intervalDays: 10, due: '2026-08-01', stepIndex: 0, reps: 3, lapses: 0, lastReviewedAt: '2026-07-25T00:00:00Z' }
    progress.words['c'] = { state: 'review', ease: 2.5, intervalDays: 10, due: '2026-08-01', stepIndex: 0, reps: 3, lapses: 0, lastReviewedAt: '2026-07-25T00:00:00Z' }
    // b: sourceNote matches but its status is new, so it fails "mastered";
    // c: status matches but sourceNote doesn't — only a satisfies both conditions
    expect(ids(filterWords(words, progress, { query: '', status: 'review', sourceNote: '8-11' }))).toEqual(['a'])
  })

  it('search and filter chips are also ANDed together', () => {
    const words = [
      mkWord({ id: 'alpha', headword: 'alpha', sourceNote: '8-11' }),
      mkWord({ id: 'albatross', headword: 'albatross', sourceNote: '12-15' }),
    ]
    expect(ids(filterWords(words, emptyProgress(), { query: 'al', status: 'all', sourceNote: '8-11' }))).toEqual([
      'alpha',
    ])
  })
})

describe('wordState', () => {
  it('is treated as "new" when there\'s no record for the entry in progress.words', () => {
    expect(wordState(mkWord({ id: 'a' }), emptyProgress())).toBe('new')
  })

  it('returns the state from the record when one exists', () => {
    const progress: Progress = emptyProgress()
    progress.words['a'] = { state: 'review', ease: 2.5, intervalDays: 10, due: '2026-08-01', stepIndex: 0, reps: 3, lapses: 0, lastReviewedAt: '2026-07-25T00:00:00Z' }
    expect(wordState(mkWord({ id: 'a' }), progress)).toBe('review')
  })
})

describe('distinctSourceNotes', () => {
  it('deduplicates and sorts by numeric range ascending (not string dictionary order)', () => {
    const words = [
      mkWord({ id: 'a', sourceNote: '12-15' }),
      mkWord({ id: 'b', sourceNote: '8-11' }),
      mkWord({ id: 'c', sourceNote: '8-11' }),
      mkWord({ id: 'd', sourceNote: '104-106' }),
    ]
    // Plain string sorting would put "104-106" before "12-15" and "8-11"
    // (dictionary order: '1' < '8'); this requires sorting by the range's
    // starting number instead, so "8-11" should sort before "12-15"
    expect(distinctSourceNotes(words)).toEqual(['8-11', '12-15', '104-106'])
  })

  it('a sourceNote with a non-numeric prefix (like manually-added "manual") sorts to the end, alphabetically', () => {
    const words = [mkWord({ id: 'a', sourceNote: 'manual' }), mkWord({ id: 'b', sourceNote: '8-11' })]
    expect(distinctSourceNotes(words)).toEqual(['8-11', 'manual'])
  })
})

describe('filterToParams / paramsToFilter', () => {
  const roundTrip = (f: LibraryFilterOptions) => paramsToFilter(new URLSearchParams(filterToParams(f)))

  it('an unfiltered library produces an empty query string, not q=&status=all', () => {
    expect(filterToParams(ALL_WORDS)).toBe('')
  })

  it('no parameters at all means no restriction — the two spellings name the same set', () => {
    expect(paramsToFilter(new URLSearchParams(''))).toEqual(ALL_WORDS)
  })

  it('omits each default independently rather than all-or-nothing', () => {
    expect(filterToParams({ query: '', status: 'review', sourceNote: null })).toBe('status=review')
    expect(filterToParams({ query: 'ab', status: 'all', sourceNote: null })).toBe('q=ab')
    expect(filterToParams({ query: '', status: 'all', sourceNote: '8-11' })).toBe('src=8-11')
  })

  it('round-trips every combination unchanged — the two pages must agree on the encoding', () => {
    const cases: LibraryFilterOptions[] = [
      ALL_WORDS,
      { query: 'ab', status: 'new', sourceNote: '8-11' },
      { query: 'per se', status: 'learning', sourceNote: 'manual' },
      { query: '', status: 'review', sourceNote: null },
    ]
    for (const c of cases) expect(roundTrip(c)).toEqual(c)
  })

  it('a query needing escaping survives the trip', () => {
    expect(roundTrip({ query: 'a&b=c d', status: 'all', sourceNote: null }).query).toBe('a&b=c d')
  })

  it('trims the query on the way out, so a stray space does not become a filter', () => {
    expect(filterToParams({ query: '  ', status: 'all', sourceNote: null })).toBe('')
    expect(filterToParams({ query: ' ab ', status: 'all', sourceNote: null })).toBe('q=ab')
  })

  it('an unknown status falls back to all rather than matching nothing — read side lenient', () => {
    expect(paramsToFilter(new URLSearchParams('status=bogus')).status).toBe('all')
    expect(paramsToFilter(new URLSearchParams('status=')).status).toBe('all')
  })
})
