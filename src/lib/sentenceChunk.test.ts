import { describe, expect, it } from 'vitest'
import {
  buildComposeQuestion,
  composeRatingWeight,
  gradeOrder,
  gradeWord,
  generateComposeSession,
  missedIds,
  normalizeToken,
  pickDistractor,
  promptFor,
  resolveSentence,
  usableChunks,
} from './sentenceChunk'
import type { ChunkAnnotation } from './sentenceChunk'
import type { SenseGroup } from './senseGroup'
import type { RecallSentence } from './recallSentence'
import { emptyProgress } from '../types'
import type { Progress, Word } from '../types'

/** "The new CEO abrogated the remote-work policy over a single Slack message." — 12 tokens. */
const EX0 = 'The new CEO abrogated the remote-work policy over a single Slack message.'
const EX1 = 'You cannot abrogate the lease because your roommate moved out today.'

const word = (over: Partial<Word> = {}): Word => ({
  id: 'abrogate',
  headword: 'abrogate',
  phonetic: '/x/',
  meanings: [{ pos: 'v.', en: 'repeal', zh: '废除' }],
  examples: [EX0, EX1],
  synonyms: [], antonyms: [], collocations: [], relatedForms: [],
  sourceNote: 't', addedAt: '2026-07-01',
  ...over,
})

const group = (over: Partial<SenseGroup> = {}): SenseGroup => ({
  zh: '撑了一整场会议，他最后还是没抵住茶水间剩下的蛋糕。',
  target: '没抵住',
  en: 'He held out through the whole meeting and then succumbed to the leftover cake.',
  order: ['succumb', 'capitulate'],
  why: 'because',
  ...over,
} as SenseGroup)

const ann = (over: Partial<ChunkAnnotation> = {}): ChunkAnnotation => ({
  src: 'ex', id: 'abrogate', i: 0, cuts: [3, 4, 7, 10], blank: 3, answer: 'abrogated',
  ...over,
})

const map = (ws: Word[]) => new Map(ws.map(x => [x.id, x]))

const studied = (ids: string[], over: Partial<Progress['words'][string]> = {}): Progress => {
  const p = emptyProgress()
  for (const id of ids) {
    p.words[id] = {
      state: 'review', ease: 2.5, intervalDays: 3, due: '2026-08-01',
      stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-20T00:00:00Z',
      ...over,
    }
  }
  return p
}

const seq = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}

describe('normalizeToken', () => {
  it('lowercases and strips punctuation from both ends', () => {
    expect(normalizeToken('  Abrogated,  ')).toBe('abrogated')
    expect(normalizeToken('"policy."')).toBe('policy')
  })

  it('keeps internal hyphens and apostrophes', () => {
    expect(normalizeToken('remote-work')).toBe('remote-work')
    expect(normalizeToken("Didn't")).toBe("didn't")
  })
})

describe('resolveSentence', () => {
  const words = map([word()])

  it('cuts the sentence at the annotated token indices', () => {
    const r = resolveSentence(ann(), words, [])
    expect(r?.raw).toEqual([
      'The new CEO', 'abrogated', 'the remote-work policy', 'over a single', 'Slack message.',
    ])
  })

  it('lowercases the sentence-initial capital so the first position is not given away', () => {
    expect(resolveSentence(ann(), words, [])?.chunks[0]).toBe('the new CEO')
  })

  it('keeps a mid-sentence capital', () => {
    expect(resolveSentence(ann(), words, [])?.chunks[4]).toBe('Slack message')
  })

  it('lifts sentence-final punctuation out of the last chunk', () => {
    const r = resolveSentence(ann(), words, [])
    expect(r?.tail).toBe('.')
    expect(r?.chunks[4]).toBe('Slack message')
  })

  it('renders the blank in place, keeping any punctuation riding on the token', () => {
    const r = resolveSentence(ann({ cuts: [2, 4, 7, 10], blank: 2 }), map([
      word({ examples: ['The CEO abrogated, once again, the remote-work policy over one message.'] }),
    ]), [])
    expect(r?.chunks[1]).toBe('______, once')
    expect(r?.blankChunk).toBe(1)
  })

  it('rejects an annotation whose answer no longer matches the token — the drift checksum', () => {
    expect(resolveSentence(ann({ answer: 'rescinded' }), words, [])).toBeNull()
  })

  it('rejects cuts that are not strictly increasing', () => {
    expect(resolveSentence(ann({ cuts: [3, 3, 7, 10] }), words, [])).toBeNull()
  })

  it('rejects a cut at or past the end', () => {
    expect(resolveSentence(ann({ cuts: [3, 4, 7, 12] }), words, [])).toBeNull()
  })

  it('rejects a leading cut of 0, which would make an empty first chunk', () => {
    expect(resolveSentence(ann({ cuts: [0, 4, 7, 10] }), words, [])).toBeNull()
  })

  it('rejects an ex sentence below the five-chunk floor', () => {
    expect(resolveSentence(ann({ cuts: [3, 4, 7] }), words, [])).toBeNull()
  })

  it('accepts an sg sentence at the four-chunk floor', () => {
    const g = group()
    const a = ann({ src: 'sg', id: 'succumb', i: 0, cuts: [4, 8, 10], blank: 9, answer: 'succumbed' })
    expect(resolveSentence(a, map([]), [g])?.chunks.length).toBe(4)
  })

  it('rejects an sg annotation whose group has moved under it', () => {
    const g = group({ order: ['capitulate', 'succumb'] })
    const a = ann({ src: 'sg', id: 'succumb', i: 0, cuts: [4, 8, 10], blank: 10, answer: 'succumbed' })
    expect(resolveSentence(a, map([]), [g])).toBeNull()
  })

  it('rejects a missing word or out-of-range example', () => {
    expect(resolveSentence(ann({ id: 'nope' }), words, [])).toBeNull()
    expect(resolveSentence(ann({ i: 9 }), words, [])).toBeNull()
  })
})

describe('usableChunks', () => {
  const words = map([word()])

  it('keeps annotations whose answer word is learned', () => {
    expect(usableChunks([ann()], words, [], studied(['abrogate'])).length).toBe(1)
  })

  it('drops a word still in the new state', () => {
    const p = studied(['abrogate'])
    p.words['abrogate'].state = 'new'
    expect(usableChunks([ann()], words, [], p)).toEqual([])
  })

  it('drops an annotation that no longer resolves', () => {
    expect(usableChunks([ann({ answer: 'nope' })], words, [], studied(['abrogate']))).toEqual([])
  })
})

describe('pickDistractor', () => {
  const words = map([word()])
  const a0 = ann()
  const a1 = ann({ i: 1, cuts: [2, 3, 6, 9], blank: 2, answer: 'abrogate' })
  const rng = seq(7)

  it('draws from another sentence of the same word', () => {
    const [r0, r1] = [resolveSentence(a0, words, [])!, resolveSentence(a1, words, [])!]
    const d = pickDistractor(r0, [r0, r1], rng)
    expect(d).not.toBeNull()
    expect(r1.raw).toContain(d)
  })

  it('never returns a chunk containing the target word in any form', () => {
    const [r0, r1] = [resolveSentence(a0, words, [])!, resolveSentence(a1, words, [])!]
    for (let k = 0; k < 40; k++) {
      const d = pickDistractor(r0, [r0, r1], seq(k))
      if (d !== null) expect(d.toLowerCase()).not.toContain('abrog')
    }
  })

  it('never returns a chunk this sentence already has', () => {
    // Every chunk of `twin` except its own blank is word-for-word one of r0's.
    const twin = word({ id: 'twin', headword: 'twin', examples: [EX0.replace('abrogated', 'shredded')] })
    const rt = resolveSentence(
      ann({ id: 'twin', answer: 'shredded' }), map([word(), twin]), [],
    )!
    const r0 = resolveSentence(a0, words, [])!
    for (let k = 0; k < 40; k++) {
      const d = pickDistractor(r0, [r0, rt], seq(k))
      if (d !== null) expect(r0.raw).not.toContain(d)
    }
  })

  it('returns null rather than a badly shaped chunk when nothing survives', () => {
    const r0 = resolveSentence(a0, words, [])!
    expect(pickDistractor(r0, [r0], seq(1))).toBeNull()
  })
})

describe('promptFor', () => {
  const sentences = new Map<string, RecallSentence>([
    ['abrogate:0', { id: 'abrogate', i: 0, zh: '新任总裁一条消息就废除了远程办公制度。', target: '废除' }],
  ])

  it('reads an ex prompt off the matching recall sentence', () => {
    expect(promptFor(ann(), [], sentences)?.target).toBe('废除')
  })

  it('is null when the ex sentence has no Chinese rendering', () => {
    expect(promptFor(ann({ i: 1 }), [], sentences)).toBeNull()
  })

  it('reads an sg prompt off the group', () => {
    const p = promptFor(ann({ src: 'sg', i: 0 }), [group()], sentences)
    expect(p?.zh).toContain('没抵住')
    expect(p?.target).toBe('没抵住')
  })

  it('drops a target that does not locate exactly once', () => {
    const g = group({ zh: '他没抵住，真的没抵住。', target: '没抵住' })
    expect(promptFor(ann({ src: 'sg', i: 0 }), [g], sentences)?.target).toBeUndefined()
  })
})

describe('buildComposeQuestion', () => {
  const words = map([word()])

  it('puts every reference chunk in the pool and keeps the answer key in order', () => {
    const r = resolveSentence(ann(), words, [])!
    const q = buildComposeQuestion(r, { zh: '中文' }, word(), [r], seq(5))
    expect(q.chunks).toEqual(r.chunks)
    for (const c of q.chunks) expect(q.pool).toContain(c)
    expect(q.answer).toBe('abrogated')
    expect(q.tail).toBe('.')
  })

  it('adds exactly one distractor when one is available', () => {
    const a1 = ann({ i: 1, cuts: [2, 3, 6, 9], blank: 2, answer: 'abrogate' })
    const r0 = resolveSentence(ann(), words, [])!
    const r1 = resolveSentence(a1, words, [])!
    const q = buildComposeQuestion(r0, { zh: '中文' }, word(), [r0, r1], seq(5))
    expect(q.pool.length).toBe(q.chunks.length + 1)
  })
})

describe('gradeOrder', () => {
  it('is ok only on an exact sequence', () => {
    expect(gradeOrder(['a', 'b'], ['a', 'b'])).toBe('ok')
    expect(gradeOrder(['b', 'a'], ['a', 'b'])).toBe('wrong')
  })

  it('is wrong when a distractor was placed', () => {
    expect(gradeOrder(['a', 'b', 'x'], ['a', 'b'])).toBe('wrong')
  })

  it('ignores case and internal whitespace', () => {
    expect(gradeOrder(['The  New CEO'], ['the new CEO'])).toBe('ok')
  })
})

describe('gradeWord', () => {
  const w = word({ relatedForms: [{ form: 'abrogation', pos: 'n.', zh: '废除' }] })

  it('is ok on the exact form', () => {
    expect(gradeWord(' Abrogated ', w, 'abrogated')).toBe('ok')
  })

  it('calls the headword a form miss, not a word miss', () => {
    expect(gradeWord('abrogate', w, 'abrogated')).toBe('form')
  })

  it('calls an authored related form a form miss', () => {
    expect(gradeWord('abrogation', w, 'abrogated')).toBe('form')
  })

  it('calls an unwritten inflection a form miss via the prefix rule', () => {
    expect(gradeWord('abrogates', w, 'abrogated')).toBe('form')
  })

  it('calls a different word wrong, even a near-synonym', () => {
    expect(gradeWord('abolished', w, 'abrogated')).toBe('wrong')
    expect(gradeWord('rescinded', w, 'abrogated')).toBe('wrong')
  })

  it('calls an empty answer wrong', () => {
    expect(gradeWord('   ', w, 'abrogated')).toBe('wrong')
  })
})

describe('missedIds', () => {
  it('reports only word misses — a wrong order never reaches the scheduler', () => {
    expect(missedIds([
      { id: 'a', word: 'wrong' },
      { id: 'b', word: 'form' },
      { id: 'c', word: 'ok' },
    ])).toEqual(['a'])
  })

  it('deduplicates a word missed twice in one session', () => {
    expect(missedIds([{ id: 'a', word: 'wrong' }, { id: 'a', word: 'wrong' }])).toEqual(['a'])
  })
})

describe('composeRatingWeight', () => {
  it('carries 要多考 across at full strength', () => {
    expect(composeRatingWeight({ level: 'hard', at: 'x' })).toBe(6)
  })

  it('does not carry 太简单 across — 组句 asks for strictly more than 回想', () => {
    expect(composeRatingWeight({ level: 'easy', at: 'x' })).toBe(1)
    expect(composeRatingWeight(undefined)).toBe(1)
  })
})

describe('generateComposeSession', () => {
  const words = map([word()])
  const sentences: RecallSentence[] = [
    { id: 'abrogate', i: 0, zh: '新任总裁一条消息就废除了远程办公制度。', target: '废除' },
    { id: 'abrogate', i: 1, zh: '室友搬走了你不能随便废止租约。', target: '废止' },
  ]
  const a0 = ann()
  const a1 = ann({ i: 1, cuts: [2, 3, 6, 9], blank: 2, answer: 'abrogate' })

  it('builds questions for learned words only', () => {
    const qs = generateComposeSession([a0], words, [], sentences, studied(['abrogate']), '2026-08-30', new Set(), 6, seq(1))
    expect(qs.length).toBe(1)
    expect(qs[0].id).toBe('abrogate')
  })

  it('returns nothing when no word is learned', () => {
    expect(generateComposeSession([a0], words, [], sentences, emptyProgress(), '2026-08-30', new Set(), 6, seq(1))).toEqual([])
  })

  it('skips an ex annotation with no Chinese rendering', () => {
    expect(generateComposeSession([a0], words, [], [], studied(['abrogate']), '2026-08-30', new Set(), 6, seq(1))).toEqual([])
  })

  it('allows a word to repeat, but only from distinct sentences and at most three times', () => {
    const qs = generateComposeSession([a0, a1], words, [], sentences, studied(['abrogate']), '2026-08-30', new Set(), 6, seq(1))
    expect(qs.length).toBe(2)
    expect(new Set(qs.map(q => q.prompt)).size).toBe(2)
  })

  it('prefers prompts the recency record has not shown', () => {
    const seen = new Set([sentences[0].zh])
    const qs = generateComposeSession([a0, a1], words, [], sentences, studied(['abrogate']), '2026-08-30', seen, 1, seq(1))
    expect(qs[0].prompt).toBe(sentences[1].zh)
  })

  it('never exceeds the requested count', () => {
    const qs = generateComposeSession([a0, a1], words, [], sentences, studied(['abrogate']), '2026-08-30', new Set(), 1, seq(1))
    expect(qs.length).toBe(1)
  })
})
