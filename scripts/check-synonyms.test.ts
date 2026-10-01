import { describe, expect, it } from 'vitest'
import { DIFFERENT, UNRELATED, groupByHub, judge, requestBody, sharedOnlyPairs } from './check-synonyms'
import type { Word } from '../src/types'

const word = (id: string, synonyms: string[], en = `${id} sense`): Word =>
  ({ id, headword: id, meanings: [{ pos: 'adj.', en, zh: `${id}义` }], synonyms, examples: [] }) as unknown as Word

describe('sharedOnlyPairs', () => {
  // gamma lists beta's headword *and* shares 'still' with it: a direct pair
  // that also has a shared synonym, which is the case the filter must drop.
  const words = [word('alpha', ['still']), word('beta', ['still']), word('gamma', ['beta', 'still']), word('delta', ['still'])]
  const keys = (ps: { a: string; b: string }[]) => ps.map((p) => `${p.a}|${p.b}`).sort()

  it('keeps pairs joined only through a shared synonym, not direct ones', () => {
    expect(keys(sharedOnlyPairs(words))).toEqual(['alpha|beta', 'alpha|delta', 'alpha|gamma', 'beta|delta', 'delta|gamma'])
  })
  it('narrows to pairs touching the given ids', () => {
    expect(keys(sharedOnlyPairs(words, new Set(['delta'])))).toEqual(['alpha|delta', 'beta|delta', 'delta|gamma'])
  })
})

describe('requestBody', () => {
  it('shows both words with every sense and names the shared synonym in both questions', () => {
    const byId = new Map([word('alpha', ['still'], 'motionless'), word('beta', ['still'], 'nevertheless')].map((w) => [w.id, w]))
    const body = requestBody({ a: 'alpha', b: 'beta', shared: ['still'] }, byId)
    expect(body.model).toBe('jev-1.13.0')
    expect(body.state).toBe("Word A: alpha — (adj.) motionless\nWord B: beta — (adj.) nevertheless\nBoth list 'still' as a synonym.")
    expect(body.questions.same_sense.instructions).toContain("'still'")
    expect(Object.keys(body.questions.same_sense.criteria)).toEqual(['same', 'different'])
    expect(Object.keys(body.questions.confusable.criteria)).toEqual(['close', 'unrelated'])
  })
})

describe('judge', () => {
  const answer = (different: number, unrelated: number) => ({
    answers: {
      same_sense: { probabilities: { same: 1 - different, different } },
      confusable: { probabilities: { close: 1 - unrelated, unrelated } },
    },
  })

  it('flags a pair whose synonym reads two ways, at the measured threshold', () => {
    expect(judge(answer(DIFFERENT, 0)).flagged).toBe(true)
    expect(judge(answer(DIFFERENT - 0.01, 0)).flagged).toBe(false)
  })
  it('flags a pair whose words are unrelated, at the measured threshold', () => {
    expect(judge(answer(0, UNRELATED)).flagged).toBe(true)
    expect(judge(answer(0, UNRELATED - 0.01)).flagged).toBe(false)
  })
  it('flags a malformed answer so it is read rather than passed', () => {
    expect(judge(null).flagged).toBe(true)
    expect(judge({ answers: { same_sense: {} } }).flagged).toBe(true)
  })
})

describe('groupByHub', () => {
  it('groups flagged pairs under each shared synonym, biggest hub first, listing every word that carries it', () => {
    const words = [word('alpha', ['still']), word('beta', ['still', 'calm']), word('gamma', ['calm']), word('delta', ['still'])]
    const hubs = groupByHub(
      [
        { a: 'alpha', b: 'beta', shared: ['still'] },
        { a: 'alpha', b: 'delta', shared: ['still'] },
        { a: 'beta', b: 'gamma', shared: ['calm'] },
      ],
      words,
    )
    expect(hubs.map((h) => [h.synonym, h.pairs.length, h.carriers])).toEqual([
      ['still', 2, ['alpha', 'beta', 'delta']],
      ['calm', 1, ['beta', 'gamma']],
    ])
  })
})
