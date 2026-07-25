import { describe, expect, it } from 'vitest'
import { emptyProgress } from '../types'
import type { Progress, Word } from '../types'
import { distinctSourceNotes, filterWords, wordState } from './libraryFilter'

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

describe('filterWords - 搜索:大小写与命中字段', () => {
  it('大小写不敏感:大写查询命中小写词头', () => {
    const words = [mkWord({ id: 'abrogate', headword: 'abrogate' })]
    const result = filterWords(words, emptyProgress(), { query: 'ABRO', status: 'all', sourceNote: null })
    expect(ids(result)).toEqual(['abrogate'])
  })

  it('查询大小写混合也能命中释义里的大写单词', () => {
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

  it('en 释义子串命中,即使词头完全不含查询词', () => {
    const words = [
      mkWord({ id: 'abrogate', headword: 'abrogate', meanings: [{ pos: 'v.', en: 'to formally cancel a law', zh: '正式废除' }] }),
      mkWord({ id: 'unrelated', headword: 'unrelated', meanings: [{ pos: 'adj.', en: 'not connected', zh: '无关的' }] }),
    ]
    expect(ids(filterWords(words, emptyProgress(), { query: 'cancel', status: 'all', sourceNote: null }))).toEqual([
      'abrogate',
    ])
  })

  it('zh 释义子串命中,即使词头完全不含查询词', () => {
    const words = [
      mkWord({ id: 'abrogate', headword: 'abrogate', meanings: [{ pos: 'v.', en: 'to formally cancel a law', zh: '正式废除' }] }),
      mkWord({ id: 'unrelated', headword: 'unrelated', meanings: [{ pos: 'adj.', en: 'not connected', zh: '无关的' }] }),
    ]
    expect(ids(filterWords(words, emptyProgress(), { query: '废除', status: 'all', sourceNote: null }))).toEqual([
      'abrogate',
    ])
  })

  it('空查询返回全部词条,按词头字母序排列', () => {
    const words = [mkWord({ id: 'zebra', headword: 'zebra' }), mkWord({ id: 'abrogate', headword: 'abrogate' })]
    expect(ids(filterWords(words, emptyProgress(), { query: '', status: 'all', sourceNote: null }))).toEqual([
      'abrogate',
      'zebra',
    ])
  })

  it('查询词包含首尾空白会被忽略', () => {
    const words = [mkWord({ id: 'abrogate', headword: 'abrogate' })]
    expect(ids(filterWords(words, emptyProgress(), { query: '  abro  ', status: 'all', sourceNote: null }))).toEqual([
      'abrogate',
    ])
  })
})

describe('filterWords - 排序:词头前缀优先于词头子串,子串优先于释义命中', () => {
  it('三档命中顺序:词头前缀 > 词头子串 > 仅释义命中,同档内按字母序', () => {
    const words = [
      mkWord({ id: 'precancel', headword: 'precancel' }), // 词头子串(不是前缀)
      mkWord({ id: 'abrogate', headword: 'abrogate', meanings: [{ pos: 'v.', en: 'to formally cancel a law', zh: '正式废除' }] }), // 仅释义命中
      mkWord({ id: 'cancelable', headword: 'cancelable' }), // 词头前缀
    ]
    const result = filterWords(words, emptyProgress(), { query: 'cancel', status: 'all', sourceNote: null })
    expect(ids(result)).toEqual(['cancelable', 'precancel', 'abrogate'])
  })

  it('不命中的词条被排除', () => {
    const words = [mkWord({ id: 'abrogate', headword: 'abrogate' }), mkWord({ id: 'zzz', headword: 'zzz' })]
    expect(ids(filterWords(words, emptyProgress(), { query: 'abro', status: 'all', sourceNote: null }))).toEqual([
      'abrogate',
    ])
  })
})

describe('filterWords - 状态筛选', () => {
  const words = [mkWord({ id: 'a', headword: 'alpha' }), mkWord({ id: 'b', headword: 'bravo' }), mkWord({ id: 'c', headword: 'carol' })]

  it('progress 中缺失记录视为 new,匹配「未学」', () => {
    const progress: Progress = emptyProgress()
    progress.words['b'] = { state: 'learning', ease: 2.5, intervalDays: 0, due: '2026-07-25', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-25T00:00:00Z' }
    expect(ids(filterWords(words, progress, { query: '', status: 'new', sourceNote: null }))).toEqual(['a', 'c'])
  })

  it('learning / review 精确匹配 progress.state', () => {
    const progress: Progress = emptyProgress()
    progress.words['b'] = { state: 'learning', ease: 2.5, intervalDays: 0, due: '2026-07-25', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-25T00:00:00Z' }
    progress.words['c'] = { state: 'review', ease: 2.5, intervalDays: 10, due: '2026-08-01', stepIndex: 0, reps: 3, lapses: 0, lastReviewedAt: '2026-07-25T00:00:00Z' }
    expect(ids(filterWords(words, progress, { query: '', status: 'learning', sourceNote: null }))).toEqual(['b'])
    expect(ids(filterWords(words, progress, { query: '', status: 'review', sourceNote: null }))).toEqual(['c'])
  })

  it('status:"all" 不做任何状态过滤', () => {
    expect(ids(filterWords(words, emptyProgress(), { query: '', status: 'all', sourceNote: null }))).toEqual([
      'a',
      'b',
      'c',
    ])
  })
})

describe('filterWords - sourceNote 筛选', () => {
  const words = [
    mkWord({ id: 'a', headword: 'alpha', sourceNote: '8-11' }),
    mkWord({ id: 'b', headword: 'bravo', sourceNote: '12-15' }),
    mkWord({ id: 'c', headword: 'carol', sourceNote: '8-11' }),
  ]

  it('sourceNote 为 null 时不过滤', () => {
    expect(ids(filterWords(words, emptyProgress(), { query: '', status: 'all', sourceNote: null }))).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('指定 sourceNote 时只保留精确匹配的词条', () => {
    expect(ids(filterWords(words, emptyProgress(), { query: '', status: 'all', sourceNote: '8-11' }))).toEqual([
      'a',
      'c',
    ])
  })
})

describe('filterWords - 两组筛选按 AND 组合', () => {
  it('状态筛选与 sourceNote 筛选同时生效,必须都满足才保留', () => {
    const words = [
      mkWord({ id: 'a', headword: 'alpha', sourceNote: '8-11' }),
      mkWord({ id: 'b', headword: 'bravo', sourceNote: '8-11' }),
      mkWord({ id: 'c', headword: 'carol', sourceNote: '12-15' }),
    ]
    const progress: Progress = emptyProgress()
    progress.words['a'] = { state: 'review', ease: 2.5, intervalDays: 10, due: '2026-08-01', stepIndex: 0, reps: 3, lapses: 0, lastReviewedAt: '2026-07-25T00:00:00Z' }
    progress.words['c'] = { state: 'review', ease: 2.5, intervalDays: 10, due: '2026-08-01', stepIndex: 0, reps: 3, lapses: 0, lastReviewedAt: '2026-07-25T00:00:00Z' }
    // b: sourceNote 命中但状态是 new,不满足「已掌握」;c: 状态命中但 sourceNote 不对
    // 只有 a 同时满足两个条件
    expect(ids(filterWords(words, progress, { query: '', status: 'review', sourceNote: '8-11' }))).toEqual(['a'])
  })

  it('搜索与筛选 chips 也按 AND 组合', () => {
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
  it('progress.words 中没有该词条的记录时视为 "new"', () => {
    expect(wordState(mkWord({ id: 'a' }), emptyProgress())).toBe('new')
  })

  it('有记录时返回记录里的 state', () => {
    const progress: Progress = emptyProgress()
    progress.words['a'] = { state: 'review', ease: 2.5, intervalDays: 10, due: '2026-08-01', stepIndex: 0, reps: 3, lapses: 0, lastReviewedAt: '2026-07-25T00:00:00Z' }
    expect(wordState(mkWord({ id: 'a' }), progress)).toBe('review')
  })
})

describe('distinctSourceNotes', () => {
  it('去重并按数值区间升序排列(而非字符串字典序)', () => {
    const words = [
      mkWord({ id: 'a', sourceNote: '12-15' }),
      mkWord({ id: 'b', sourceNote: '8-11' }),
      mkWord({ id: 'c', sourceNote: '8-11' }),
      mkWord({ id: 'd', sourceNote: '104-106' }),
    ]
    // 纯字符串排序会把 "104-106" 排在 "12-15" 和 "8-11" 之前(字典序 '1' < '8'),
    // 这里要求按区间起始数值排序,"8-11" 应排在 "12-15" 之前
    expect(distinctSourceNotes(words)).toEqual(['8-11', '12-15', '104-106'])
  })

  it('非数值前缀的 sourceNote(如手动添加的 "manual")落在末尾,按字母序', () => {
    const words = [mkWord({ id: 'a', sourceNote: 'manual' }), mkWord({ id: 'b', sourceNote: '8-11' })]
    expect(distinctSourceNotes(words)).toEqual(['8-11', 'manual'])
  })
})
