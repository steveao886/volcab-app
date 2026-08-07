import { describe, expect, it } from 'vitest'
import {
  buildOrderQuestion, buildRecallQuestion, eligibleGroups, generateRecallSession,
  isRankable, orderCorrect, wrongIdsFor,
} from './senseGroup'
import type { RecallQuestion, SenseGroup } from './senseGroup'
import { emptyProgress } from '../types'
import type { Progress, Word } from '../types'

const mkWord = (id: string, pos = 'v.'): Word => ({
  id,
  headword: id,
  phonetic: `/${id}/`,
  meanings: [{ pos, en: id, zh: `${id} 的意思` }],
  examples: [],
  synonyms: [],
  antonyms: [],
  collocations: [],
  relatedForms: [],
  sourceNote: 'manual',
  addedAt: '2026-01-01',
})

const learned = (ids: string[]): Progress => {
  const p = emptyProgress()
  for (const id of ids) {
    p.words[id] = {
      state: 'review', ease: 2.5, intervalDays: 3, due: '2026-08-01',
      stepIndex: 0, reps: 3, lapses: 0, lastReviewedAt: '2026-08-01T00:00:00Z',
    }
  }
  return p
}

const wordsMap = (ws: Word[]) => new Map(ws.map(w => [w.id, w]))

const G: SenseGroup = {
  zh: '烧焦的爆米花味弥漫了整个办公室',
  target: '弥漫',
  order: ['pervade', 'permeate', 'suffuse'],
  why: 'pervade 指充满整个空间。',
}

const LIB = [mkWord('pervade'), mkWord('permeate'), mkWord('suffuse'), mkWord('saturate'), mkWord('drench')]

// A deterministic rng that walks a fixed sequence; enough to exercise shuffles.
const seqRng = (seq: number[]) => {
  let i = 0
  return () => seq[i++ % seq.length]
}

describe('eligibleGroups', () => {
  const words = wordsMap(LIB)
  const all = learned(LIB.map(w => w.id))

  it('needs only the answer learned — requiring all three strangled the pool to 11 groups', () => {
    expect(eligibleGroups([G], words, all)).toHaveLength(1)
    // Answer learned, the two distractors never met: still a fair question,
    // because "produce this word from this meaning" does not depend on
    // knowing what sits next to it.
    expect(eligibleGroups([G], words, learned(['pervade']))).toHaveLength(1)
  })

  it('drops the group when the answer itself is unlearned', () => {
    expect(eligibleGroups([G], words, learned(['permeate', 'suffuse']))).toHaveLength(0)
  })

  it('drops the group when any member is missing from the library, learned or not', () => {
    // The repo copy and the live library have diverged before; a hole in the
    // options is not something to paper over.
    const missing = wordsMap(LIB.filter(w => w.id !== 'suffuse'))
    expect(eligibleGroups([G], missing, all)).toHaveLength(0)
  })

  it('rejects groups smaller than a pair', () => {
    expect(eligibleGroups([{ ...G, order: ['pervade'] }], words, all)).toHaveLength(0)
  })
})

describe('isRankable', () => {
  it('demands every member learned — ordering a stranger is not discrimination practice', () => {
    expect(isRankable(G, learned(['pervade', 'permeate', 'suffuse']))).toBe(true)
    expect(isRankable(G, learned(['pervade', 'permeate']))).toBe(false)
    expect(isRankable(G, learned(['pervade']))).toBe(false)
  })
})

describe('buildRecallQuestion', () => {
  const words = wordsMap(LIB)

  it('answers with order[0] and includes every member among the options', () => {
    const q = buildRecallQuestion(G, words, LIB, seqRng([0.1, 0.5, 0.9, 0.3]))
    expect(q).not.toBeNull()
    expect(q!.answer).toEqual(['pervade'])
    expect(q!.options).toHaveLength(4)
    expect(new Set(q!.options).size).toBe(4)
    for (const m of ['pervade', 'permeate', 'suffuse']) expect(q!.options).toContain(m)
  })

  it('fills only with same-POS words', () => {
    const lib = [...LIB.slice(0, 3), mkWord('noun-filler', 'n.'), mkWord('verb-filler', 'v.')]
    const q = buildRecallQuestion(G, wordsMap(lib), lib, seqRng([0.2, 0.7]))
    expect(q).not.toBeNull()
    expect(q!.options).not.toContain('noun-filler')
    expect(q!.options).toContain('verb-filler')
  })

  it('returns null rather than shipping fewer than four options', () => {
    const three = LIB.slice(0, 3)
    expect(buildRecallQuestion(G, wordsMap(three), three, seqRng([0.4]))).toBeNull()
  })

  it('returns null when a member is missing from the library', () => {
    const missing = wordsMap(LIB.filter(w => w.id !== 'permeate'))
    expect(buildRecallQuestion(G, missing, LIB, seqRng([0.4]))).toBeNull()
  })

  it('carries the target through, and drops one that cannot be located — a wrong highlight is worse than none', () => {
    const q = buildRecallQuestion(G, words, LIB, seqRng([0.1, 0.5, 0.9]))
    expect(q!.target).toBe('弥漫')
    // Missing, blank, absent-from-zh, and appearing-twice all degrade to
    // "no highlight", never to a thrown error or a mislocated mark.
    for (const target of [undefined, ' ', '厨房', '办']) {
      const g = { ...G, zh: '办公室里的办事处', target }
      const built = buildRecallQuestion(g, words, LIB, seqRng([0.2, 0.6]))
      expect(built!.target).toBeUndefined()
    }
  })
})

describe('buildOrderQuestion', () => {
  const words = wordsMap(LIB)

  it('offers exactly the members, keyed to the authored order', () => {
    const q = buildOrderQuestion(G, words, seqRng([0.8, 0.2, 0.6]))
    expect(q).not.toBeNull()
    expect(q!.answer).toEqual(['pervade', 'permeate', 'suffuse'])
    expect([...q!.options].sort()).toEqual(['permeate', 'pervade', 'suffuse'])
  })

  it('refuses pairs — ranking two items is the same act as picking one', () => {
    expect(buildOrderQuestion({ ...G, order: ['pervade', 'permeate'] }, words, seqRng([0.5]))).toBeNull()
  })
})

describe('orderCorrect', () => {
  it('accepts only the exact authored order', () => {
    const key = ['a', 'b', 'c']
    expect(orderCorrect(['a', 'b', 'c'], key)).toBe(true)
    expect(orderCorrect(['a', 'c', 'b'], key)).toBe(false)
    expect(orderCorrect(['a', 'b'], key)).toBe(false)
    expect(orderCorrect([], key)).toBe(false)
  })
})

describe('wrongIdsFor', () => {
  const recallQ: RecallQuestion = {
    kind: 'recall',
    prompt: G.zh,
    why: G.why,
    orderIds: ['pervade', 'permeate', 'suffuse'],
    memberHeadwords: ['pervade', 'permeate', 'suffuse'],
    options: ['saturate', 'pervade', 'suffuse', 'permeate'],
    answer: ['pervade'],
  }
  const orderQ: RecallQuestion = {
    ...recallQ,
    kind: 'order',
    options: ['suffuse', 'pervade', 'permeate'],
    answer: ['pervade', 'permeate', 'suffuse'],
  }

  it('想不起来 marks only the answer, whichever kind the card was about to become', () => {
    expect(wrongIdsFor(recallQ, null)).toEqual(['pervade'])
    expect(wrongIdsFor(orderQ, null)).toEqual(['pervade'])
  })

  it('a wrong 唤词 pick marks the answer and the member picked', () => {
    expect(wrongIdsFor(recallQ, ['suffuse']).sort()).toEqual(['pervade', 'suffuse'])
  })

  it('a filler pick marks only the answer — scenery is not a confusable', () => {
    expect(wrongIdsFor(recallQ, ['saturate'])).toEqual(['pervade'])
  })

  it('排序 marks exactly the misplaced members', () => {
    // Second and third swapped: first was placed right and stays unmarked.
    expect(wrongIdsFor(orderQ, ['pervade', 'suffuse', 'permeate']).sort())
      .toEqual(['permeate', 'suffuse'])
    // Everything misplaced marks everything.
    expect(wrongIdsFor(orderQ, ['suffuse', 'pervade', 'permeate'])).toHaveLength(3)
  })

  it('a correct answer marks nothing (排序) and the answer never doubles (唤词)', () => {
    expect(wrongIdsFor(orderQ, ['pervade', 'permeate', 'suffuse'])).toEqual([])
    expect(wrongIdsFor(recallQ, ['pervade'])).toEqual(['pervade'])
  })
})

describe('generateRecallSession', () => {
  const groups: SenseGroup[] = [
    G,
    { zh: '他终于向孩子的哭闹妥协了', order: ['capitulate', 'succumb', 'acquiesce'], why: 'why-2' },
    { zh: '市中心的拥堵已经积重难返', order: ['intractable', 'refractory', 'obstinate'], why: 'why-3' },
  ]
  const lib = [
    ...LIB,
    mkWord('capitulate'), mkWord('succumb'), mkWord('acquiesce'),
    mkWord('intractable', 'adj.'), mkWord('refractory', 'adj.'), mkWord('obstinate', 'adj.'),
    mkWord('stubborn', 'adj.'), mkWord('yield'),
  ]
  const words = wordsMap(lib)
  const all = learned(lib.map(w => w.id))

  it('drops a group whose answer is unlearned, and never exceeds count', () => {
    // capitulate is order[0] of group 2 — without it that group cannot be asked at all.
    const partial = learned(lib.filter(w => w.id !== 'capitulate').map(w => w.id))
    const qs = generateRecallSession(groups, words, partial, new Set(), new Set(), 10, seqRng([0.3, 0.7, 0.1, 0.9, 0.5]))
    expect(qs.length).toBe(2)
    for (const q of qs) expect(q.orderIds[0]).not.toBe('capitulate')
  })

  it('an unlearned distractor still yields a 唤词 question, never a 排序 one', () => {
    // succumb is a distractor in group 2. The group stays playable — you can
    // be asked to produce capitulate without knowing what sits beside it —
    // but it must never be handed over for ranking.
    const partial = learned(lib.filter(w => w.id !== 'succumb').map(w => w.id))
    const qs = generateRecallSession(groups, words, partial, new Set(), new Set(), 10, seqRng([0.3, 0.7, 0.1, 0.9, 0.5]))
    const g2 = qs.filter(q => q.orderIds.includes('succumb'))
    expect(g2.length).toBe(1)
    expect(g2[0].kind).toBe('recall')
  })

  it('surfaces unseen prompts before recently seen ones', () => {
    const seen = new Set([groups[0].zh, groups[2].zh])
    // Whatever the rng does, the single unseen prompt must come first.
    const qs = generateRecallSession(groups, words, all, seen, new Set(), 3, seqRng([0.42, 0.17, 0.88, 0.61]))
    expect(qs[0].prompt).toBe(groups[1].zh)
  })

  it('a fully seen pool still yields questions — degraded, not empty', () => {
    const seen = new Set(groups.map(g => g.zh))
    const qs = generateRecallSession(groups, words, all, seen, new Set(), 3, seqRng([0.5, 0.2, 0.8]))
    expect(qs.length).toBe(3)
  })

  it('a 巩固-marked prompt opens the next session, ahead of even the unseen ones', () => {
    // 巩固 is the only mechanism that re-practises the *direction* that
    // failed — pulling the word's due date forward sends it to /review,
    // which asks headword→meaning, the opposite way round.
    const debt = new Set([groups[2].zh])
    const seen = new Set([groups[2].zh])   // seen AND owed: the debt must win
    for (const r of [seqRng([0.3, 0.9, 0.1]), seqRng([0.8, 0.2, 0.6])]) {
      const qs = generateRecallSession(groups, words, all, seen, debt, 3, r)
      expect(qs[0].prompt).toBe(groups[2].zh)
    }
  })

  it('alternates the two kinds when groups qualify for both', () => {
    const qs = generateRecallSession(groups, words, all, new Set(), new Set(), 3, seqRng([0.3, 0.6, 0.1, 0.8, 0.4]))
    expect(qs.map(q => q.kind)).toEqual(['recall', 'order', 'recall'])
  })
})
