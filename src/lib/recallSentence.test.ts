import { describe, expect, it } from 'vitest'
import { confusableIndex } from './contrast'
import { buildSentenceQuestion, usableSentences } from './recallSentence'
import { emptyProgress } from '../types'
import type { Progress, Word } from '../types'

const w = (id: string, pos = 'v.', synonyms: string[] = []): Word => ({
  id, headword: id, phonetic: `/${id}/`,
  meanings: [{ pos, en: `def of ${id}`, zh: `${id}义` }],
  examples: [`We ${id} things daily.`, `They ${id} it again.`, `A third ${id} sentence.`],
  synonyms, antonyms: [], collocations: [], relatedForms: [],
  sourceNote: 't', addedAt: '2026-07-01',
})

const studied = (ws: Word[]): Progress => {
  const p = emptyProgress()
  for (const x of ws) {
    p.words[x.id] = { state: 'review', ease: 2.5, intervalDays: 3, due: '2026-08-01', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-20T00:00:00Z' }
  }
  return p
}

const map = (ws: Word[]) => new Map(ws.map(x => [x.id, x]))
const s = (id: string, i: number, zh: string, target: string) => ({ id, i, zh, target })
const seq = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}

describe('usableSentences', () => {
  const ws = [w('alpha'), w('bravo')]

  it('keeps a sentence whose word is learned', () => {
    expect(usableSentences([s('alpha', 0, '我们每天都在处理这些事。', '处理')], map(ws), studied(ws))).toHaveLength(1)
  })

  it('drops a sentence whose word left the library — the two copies have diverged before', () => {
    expect(usableSentences([s('nowhere', 0, '句子。', '句')], map(ws), studied(ws))).toEqual([])
  })

  it('drops a sentence whose word has not been learned yet', () => {
    expect(usableSentences([s('bravo', 0, '句子。', '句')], map(ws), studied([ws[0]]))).toEqual([])
  })

  it('drops a sentence whose example index no longer exists', () => {
    expect(usableSentences([s('alpha', 9, '句子。', '句')], map(ws), studied(ws))).toEqual([])
  })
})

describe('buildSentenceQuestion', () => {
  const answer = w('alpha')
  const fillers = [w('bravo'), w('carol'), w('delta'), w('echo')]
  const ws = [answer, ...fillers]
  const idx = confusableIndex(ws)

  it('asks the Chinese sentence and offers four same-POS headwords', () => {
    const q = buildSentenceQuestion(s('alpha', 0, '我们每天都在处理这些事。', '处理'), map(ws), fillers, idx, seq(3))
    expect(q).not.toBeNull()
    expect(q!.kind).toBe('recall')
    expect(q!.prompt).toBe('我们每天都在处理这些事。')
    expect(q!.target).toBe('处理')
    expect(q!.options).toHaveLength(4)
    expect(q!.options).toContain('alpha')
    expect(q!.answer).toEqual(['alpha'])
  })

  it('reveals the English original rather than storing a second copy of it', () => {
    const q = buildSentenceQuestion(s('alpha', 1, '他们又做了一次。', '做'), map(ws), fillers, idx, seq(3))
    expect(q!.en).toBe(answer.examples[1])
  })

  it('offers the definition as the hint after 想不起来', () => {
    const q = buildSentenceQuestion(s('alpha', 0, '我们每天都在处理这些事。', '处理'), map(ws), fillers, idx, seq(3))
    expect(q!.hint).toBe('def of alpha')
  })

  /**
   * The inverse of the sense-group rule, and the reason the spec spends a
   * section on it: a group wants its confusable members as wrong options
   * because its scenario was authored to make one clearly best. A translated
   * example was written to show the word in use, so a confusable twin there
   * produces "either one fits" with no ranking to absorb the near-miss.
   */
  it('never offers a word confusable with the answer', () => {
    const near = { ...w('bravo'), synonyms: ['shared'] }
    const ans = { ...w('alpha'), synonyms: ['shared'] }
    const pool = [near, w('carol'), w('delta'), w('echo'), w('fox')]
    const all = [ans, ...pool]
    for (let seed = 1; seed < 25; seed++) {
      const q = buildSentenceQuestion(s('alpha', 0, '我们每天都在处理这些事。', '处理'), map(all), pool, confusableIndex(all), seq(seed))
      expect(q!.options).not.toContain('bravo')
    }
  })

  it('all four options share a part of speech', () => {
    const mixed = [w('bravo'), w('carol'), w('delta'), w('mango', 'adj.'), w('nut', 'adj.')]
    const all = [answer, ...mixed]
    for (let seed = 1; seed < 15; seed++) {
      const q = buildSentenceQuestion(s('alpha', 0, '我们每天都在处理这些事。', '处理'), map(all), mixed, confusableIndex(all), seq(seed))
      expect(q!.options.every(o => o === 'alpha' || ['bravo', 'carol', 'delta'].includes(o))).toBe(true)
    }
  })

  it('returns null rather than a three-option question when the pool is too thin', () => {
    const thin = [w('bravo'), w('carol')]
    const all = [answer, ...thin]
    expect(buildSentenceQuestion(s('alpha', 0, '句子在这里。', '句子'), map(all), thin, confusableIndex(all), seq(3))).toBeNull()
  })

  /**
   * Read side lenient, matching senseGroup's usableTarget: a target that
   * cannot be located renders the plain sentence rather than dropping the
   * question. A wrong highlight, or one on two places at once, is worse
   * than none — but no highlight still leaves an answerable question.
   */
  it('drops an unlocatable target instead of the question', () => {
    const q = buildSentenceQuestion(s('alpha', 0, '我们每天都在处理这些事。', '不存在'), map(ws), fillers, idx, seq(3))
    expect(q).not.toBeNull()
    expect(q!.target).toBeUndefined()
  })

  it('drops a target that appears twice — it would point at two places', () => {
    const q = buildSentenceQuestion(s('alpha', 0, '处理完再处理一次。', '处理'), map(ws), fillers, idx, seq(3))
    expect(q!.target).toBeUndefined()
  })

  it('marks only the answer on a miss — orderIds carries no filler', () => {
    const q = buildSentenceQuestion(s('alpha', 0, '我们每天都在处理这些事。', '处理'), map(ws), fillers, idx, seq(3))
    expect(q!.orderIds).toEqual(['alpha'])
    expect(q!.memberHeadwords).toEqual(['alpha'])
  })

  it('carries no why — a retrieval question has no ranking to explain', () => {
    const q = buildSentenceQuestion(s('alpha', 0, '我们每天都在处理这些事。', '处理'), map(ws), fillers, idx, seq(3))
    expect(q!.why).toBeUndefined()
  })

  it('the same seed reproduces the same question', () => {
    const one = s('alpha', 0, '我们每天都在处理这些事。', '处理')
    expect(buildSentenceQuestion(one, map(ws), fillers, idx, seq(7)))
      .toEqual(buildSentenceQuestion(one, map(ws), fillers, idx, seq(7)))
  })
})
