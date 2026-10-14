import { describe, expect, it } from 'vitest'
import { glossTerms, judge, missingLinks, requestBody } from './check-links'
import type { Word } from '../src/types'

const word = (id: string, zh: string, synonyms: string[] = [], pos = 'adj.', antonyms: string[] = []): Word =>
  ({ id, headword: id, meanings: [{ pos, en: `${id} sense`, zh }], synonyms, antonyms, examples: [] }) as unknown as Word

describe('glossTerms', () => {
  it('keeps CJK-only terms of two or more characters, keyed by part of speech, because verb and noun glosses run two', () => {
    expect([...glossTerms(word('alpha', '激怒;使恼火;A级', [], 'v.'))]).toEqual(['v.\t激怒', 'v.\t使恼火'])
  })
  it('drops one-character terms and parenthetical usage labels', () => {
    // （情绪等） paired oscillate with percolate before parentheticals were dropped
    expect([...glossTerms(word('alpha', '怒;(情绪等)波动不定的;（价格）上涨'))]).toEqual(['adj.\t波动不定的', 'adj.\t上涨'])
  })
  it('narrows to longer terms when asked', () => {
    expect([...glossTerms(word('alpha', '激怒;使恼火', [], 'v.'), 3)]).toEqual(['v.\t使恼火'])
  })
  it('splits on full-width separators as well as half-width ones', () => {
    expect([...glossTerms(word('alpha', '令人作呕的；令人厌恶的，可憎的、讨厌的'))]).toEqual(['adj.\t令人作呕的', 'adj.\t令人厌恶的', 'adj.\t可憎的', 'adj.\t讨厌的'])
  })
})

describe('missingLinks', () => {
  const keys = (cs: { a: string; b: string }[]) => cs.map((c) => `${c.a}|${c.b}`)

  it('pairs words sharing a gloss term that nothing joins', () => {
    const words = [word('beta', '迷人的'), word('alpha', '迷人的;诱人的'), word('gamma', '无关的')]
    expect(missingLinks(words)).toEqual([{ a: 'alpha', b: 'beta', terms: ['adj. 迷人的'] }])
  })
  it('skips pairs the contrast graph already joins, directly or through a shared synonym', () => {
    const words = [word('alpha', '迷人的', ['beta']), word('beta', '迷人的'), word('gamma', '迷人的', ['lovely']), word('delta', '迷人的', ['lovely'])]
    expect(keys(missingLinks(words))).toEqual(['alpha|delta', 'alpha|gamma', 'beta|delta', 'beta|gamma'])
  })
  it('skips pairs the antonym graph joins', () => {
    const words = [word('alpha', '无所谓的', [], 'adj.', ['beta']), word('beta', '无所谓的')]
    expect(missingLinks(words)).toEqual([])
  })
  it('never pairs a term across parts of speech', () => {
    expect(missingLinks([word('alpha', '使恼火', [], 'v.'), word('beta', '使恼火', [], 'adj.')])).toEqual([])
  })
  it('narrows to pairs touching the given ids', () => {
    const words = [word('alpha', '迷人的'), word('beta', '迷人的'), word('gamma', '迷人的')]
    expect(keys(missingLinks(words, new Set(['gamma'])))).toEqual(['alpha|gamma', 'beta|gamma'])
  })
})

describe('requestBody', () => {
  it('shows both words with every sense and asks the one question', () => {
    const byId = new Map([word('alpha', '迷人的'), word('beta', '迷人的')].map((w) => [w.id, w]))
    const body = requestBody({ a: 'alpha', b: 'beta', terms: ['adj. 迷人的'] }, byId)
    expect(body.model).toBe('jev-1.13.0')
    expect(body.state).toBe('Word A: alpha — (adj.) alpha sense\nWord B: beta — (adj.) beta sense')
    expect(Object.keys(body.questions.interchangeable.criteria)).toEqual(['interchangeable', 'distinct'])
  })
})

describe('judge', () => {
  it('reads P(interchangeable)', () => {
    expect(judge({ answers: { interchangeable: { probabilities: { interchangeable: 0.9, distinct: 0.1 } } } })).toBe(0.9)
  })
  it('returns NaN on a malformed answer, so it sorts first and is read', () => {
    expect(judge(null)).toBeNaN()
    expect(judge({ answers: {} })).toBeNaN()
  })
})
