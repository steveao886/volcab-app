import { describe, expect, it } from 'vitest'
import { buildItems, classify, requestBody, CONFIDENT } from './check-senses'
import type { Word } from '../src/types'
import type { RecallSentence } from '../src/lib/recallSentence'

const word = (id: string, senses: number, examples: unknown[] = ['e0', 'e1', 'e2', 'e3', 'e4']): Word =>
  ({
    id,
    headword: id,
    meanings: Array.from({ length: senses }, (_, k) => ({ pos: k ? 'n.' : 'v.', en: `sense ${k}`, zh: `义${k}` })),
    examples,
  }) as unknown as Word

const rendering = (id: string, i: number, sense?: number): RecallSentence =>
  ({ id, i, zh: '句', target: '句', ...(sense === undefined ? {} : { sense }) })

describe('buildItems', () => {
  const words = [word('poly', 2), word('mono', 1), word('gappy', 3, ['e0', { en: 'not a string' }])]
  const sentences = [
    rendering('poly', 0),
    rendering('poly', 1, 1),
    rendering('mono', 0),
    rendering('gone', 0),
    rendering('gappy', 1),
    rendering('gappy', 0, 2),
  ]

  it('takes renderings on polysemous words only, with the tag defaulting to 0', () => {
    expect(buildItems(words, sentences).map((it) => [it.key, it.tag])).toEqual([
      ['poly#0', 0],
      ['poly#1', 1],
      ['gappy#0', 2],
    ])
  })
  it('skips a rendering whose word or example is missing instead of throwing', () => {
    const keys = buildItems(words, sentences).map((it) => it.key)
    expect(keys).not.toContain('gone#0')
    expect(keys).not.toContain('gappy#1')
  })
  it('narrows to the given ids', () => {
    expect(buildItems(words, sentences, new Set(['gappy'])).map((it) => it.key)).toEqual(['gappy#0'])
  })
})

describe('requestBody', () => {
  it('asks one choice question over every sense, with its part of speech, on a pinned model', () => {
    const [item] = buildItems([word('poly', 2)], [rendering('poly', 0)])
    const body = requestBody(item)
    expect(body.model).toBe('jev-1.13.0')
    expect(body.state).toBe('e0')
    expect(body.questions.sense).toEqual({
      type: 'choice',
      instructions: 'Which meaning of the word "poly" is used in this sentence?',
      criteria: { s0: '(v.) sense 0', s1: '(n.) sense 1' },
    })
  })
})

describe('classify', () => {
  const answer = (choice: string, confidence: number) => ({ answers: { sense: { choice, confidence } } })

  it('agrees when Jev picks the tagged sense confidently', () => {
    expect(classify(1, answer('s1', CONFIDENT))).toEqual({ pick: 1, confidence: CONFIDENT, verdict: 'agree' })
  })
  it('still sends an unsure agreement to be read — 3 of 93 were wrong tags', () => {
    expect(classify(1, answer('s1', CONFIDENT - 0.01)).verdict).toBe('unsure')
  })
  it('calls a confident disagreement a likely wrong tag', () => {
    expect(classify(0, answer('s1', CONFIDENT)).verdict).toBe('retag')
  })
  it('sends a doubtful disagreement to be read', () => {
    expect(classify(0, answer('s1', CONFIDENT - 0.01)).verdict).toBe('read')
  })
  it('sends a malformed answer to be read rather than counting it as agreement', () => {
    expect(classify(0, { answers: {} }).verdict).toBe('read')
    expect(classify(0, answer('banana', 1)).verdict).toBe('read')
    expect(classify(0, null).verdict).toBe('read')
  })
})
