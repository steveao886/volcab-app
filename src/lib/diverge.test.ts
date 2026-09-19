import { describe, expect, it } from 'vitest'
import {
  buildConceptIndex,
  buildQuestion,
  conceptMembers,
  gradeInput,
  generateDivergeSession,
  DIVERGE_AXES,
} from './diverge'
import type { Concept, DivergeAxis } from './diverge'
import type { Progress, ProgressEntry, Word } from '../types'

const word = (id: string, over: Partial<Word> = {}): Word => ({
  id,
  headword: id,
  phonetic: `/${id}/`,
  meanings: [{ pos: 'adj.', en: id, zh: id }],
  examples: [],
  synonyms: [],
  antonyms: [],
  collocations: [],
  relatedForms: [],
  sourceNote: 'test',
  addedAt: '2026-01-01',
  ...over,
})

const entry = (over: Partial<ProgressEntry> = {}): ProgressEntry => ({
  state: 'review',
  ease: 2.5,
  intervalDays: 10,
  due: '2026-01-01',
  stepIndex: 0,
  reps: 3,
  lapses: 0,
  lastReviewedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const progressOf = (ids: string[]): Progress => ({
  version: 1,
  settings: { newPerDay: 5 },
  words: Object.fromEntries(ids.map(id => [id, entry()])),
  dailyStats: {},
})

/**
 * A miniature library shaped like the real one: four adjectives sharing the
 * anchor keys, noun forms reachable only through relatedForms, three
 * opposites spread across both authoring directions, and `obdurates` — a real
 * entry that is simultaneously one edit from an answer and an inflection of
 * it, which is what grading rule 2 has to survive.
 */
const WORDS: Word[] = [
  word('obstinate', {
    synonyms: ['stubborn', 'unyielding'],
    antonyms: ['compliant'],
    relatedForms: [{ form: 'obstinacy', pos: 'n.', zh: '固执' }],
  }),
  word('obdurate', {
    synonyms: ['stubborn'],
    relatedForms: [{ form: 'obduracy', pos: 'n.', zh: '顽固' }],
  }),
  word('intractable', {
    synonyms: ['stubborn', 'unyielding'],
    antonyms: ['compliant'],
    relatedForms: [{ form: 'intractability', pos: 'n.', zh: '难对付' }],
  }),
  word('intransigent', { synonyms: ['unyielding'] }),
  word('implacable', { synonyms: ['unyielding'] }),
  word('compliant', { synonyms: ['docile'], antonyms: ['obstinate'] }),
  word('docile', { synonyms: ['compliant'] }),
  word('amenable', { synonyms: ['docile'], antonyms: ['intractable'] }),
  word('tractable', { antonyms: ['obdurate'] }),
  word('obdurates', {}),
]

const CONCEPT: Concept = {
  id: 'stubborn',
  zh: '固执、不肯改变主意',
  anchors: ['stubborn', 'unyielding'],
  negations: ['implacable', 'intractable', 'intransigent'],
}

const ALL = WORDS.map(w => w.id)
const INDEX = buildConceptIndex(WORDS)

const ask = (axis: DivergeAxis, learned: string[] = ALL, concept: Concept = CONCEPT) =>
  buildQuestion(concept, axis, INDEX, progressOf(learned))

describe('conceptMembers', () => {
  it('unions every anchor bucket', () => {
    expect(conceptMembers(CONCEPT, INDEX, new Set(ALL)))
      .toEqual(['implacable', 'intractable', 'intransigent', 'obdurate', 'obstinate'])
  })

  it('drops words that are not learned, so the set grows with the library', () => {
    expect(conceptMembers(CONCEPT, INDEX, new Set(['obstinate', 'obdurate'])))
      .toEqual(['obdurate', 'obstinate'])
  })

  it('honours the authored exclusion list', () => {
    expect(conceptMembers({ ...CONCEPT, exclude: ['obdurate'] }, INDEX, new Set(ALL)))
      .not.toContain('obdurate')
  })

  it('includes an anchor that is itself a library entry', () => {
    // A word never lists itself in `synonyms`, so without the headword lookup
    // the anchor word is the one member missing from its own question.
    // compliant and amenable both list `docile`; `docile` itself is reached
    // only by the headword lookup.
    expect(conceptMembers({ ...CONCEPT, anchors: ['docile'] }, INDEX, new Set(ALL)))
      .toEqual(['amenable', 'compliant', 'docile'])
  })

  it('tolerates an anchor that matches nothing and an excluded id that is gone', () => {
    expect(conceptMembers({ ...CONCEPT, anchors: ['nonesuch'], exclude: ['deleted'] }, INDEX, new Set(ALL)))
      .toEqual([])
  })
})

describe('buildQuestion', () => {
  it('近义 answers are the members themselves', () => {
    expect(ask('synonym')?.answers.map(a => a.form))
      .toEqual(['implacable', 'intractable', 'intransigent', 'obdurate', 'obstinate'])
  })

  it('反面 collects the members’ opposites in both authoring directions', () => {
    // compliant is named by obstinate and intractable; amenable and tractable
    // name members themselves. A one-way pair is authoring, not meaning.
    expect(ask('opposite')?.answers.map(a => a.form)).toEqual(['amenable', 'compliant', 'tractable'])
  })

  it('反面 never answers with a member of its own concept', () => {
    const members = new Set(['obstinate', 'obdurate', 'intractable', 'intransigent', 'implacable'])
    expect(ask('opposite')?.answers.some(a => members.has(a.wordId))).toBe(false)
  })

  it('换词性 grades against relatedForms that are not library entries', () => {
    const q = ask('pos')
    expect(q?.pos).toBe('n.')
    expect(q?.answers.map(a => a.form)).toEqual(['intractability', 'obduracy', 'obstinacy'])
    expect(q?.answers.every(a => a.derived)).toBe(true)
  })

  it('换词性 never asks for an adverb, even when adverbs would otherwise win', () => {
    // Three adverbs against three nouns: without the guard the tie breaks
    // alphabetically and `adv.` takes it. Producing `implacably` from
    // `implacable` is a suffix, not a retrieval.
    const adverbial = WORDS.map(w => {
      if (w.id === 'implacable') return { ...w, relatedForms: [{ form: 'implacably', pos: 'adv.', zh: '不为所动地' }] }
      if (w.id === 'intransigent') return { ...w, relatedForms: [{ form: 'intransigently', pos: 'adv.', zh: '不妥协地' }] }
      if (w.id === 'obdurate') return { ...w, relatedForms: [...w.relatedForms, { form: 'obdurately', pos: 'adv.', zh: '顽固地' }] }
      return w
    })
    const q = buildQuestion(CONCEPT, 'pos', buildConceptIndex(adverbial), progressOf(ALL))
    expect(q?.pos).toBe('n.')
    expect(q?.answers.some(a => a.form.endsWith('ly'))).toBe(false)
  })

  it('加否定 answers only what the author annotated', () => {
    const q = ask('negation')
    expect(q?.answers.map(a => a.form)).toEqual(['implacable', 'intractable', 'intransigent'])
    expect(q?.answers.every(a => a.negated)).toBe(true)
  })

  it('fails closed below three answers rather than asking a thin question', () => {
    expect(ask('synonym', ['obstinate', 'obdurate'])).toBeNull()
    expect(ask('opposite')).not.toBeNull()
  })

  it('marks a negation-list member as negated on every axis, not just 加否定', () => {
    const q = ask('synonym')
    expect(q?.answers.find(a => a.form === 'intractable')?.negated).toBe(true)
    expect(q?.answers.find(a => a.form === 'obstinate')?.negated).toBe(false)
  })

  it('skips an authored id that no longer exists instead of throwing', () => {
    const q = buildQuestion({ ...CONCEPT, negations: ['implacable', 'intractable', 'intransigent', 'deleted'] }, 'negation', INDEX, progressOf([...ALL, 'deleted']))
    expect(q?.answers.map(a => a.form)).toEqual(['implacable', 'intractable', 'intransigent'])
  })
})

describe('gradeInput', () => {
  const q = ask('synonym')!
  const grade = (raw: string, found: string[] = []) => gradeInput(raw, q, INDEX, new Set(found))

  it('rule 1: an exact answer is a hit', () => {
    expect(grade('obdurate')).toEqual({ kind: 'hit', form: 'obdurate', wordId: 'obdurate', typo: false })
  })

  it('rule 1: case and surrounding space do not matter', () => {
    expect(grade('  ObDurate ')).toMatchObject({ kind: 'hit', form: 'obdurate' })
  })

  it('reports an answer already produced rather than counting it twice', () => {
    expect(grade('obdurate', ['obdurate'])).toEqual({ kind: 'already', form: 'obdurate' })
  })

  it('rule 2: a library headword is never read as a typo of an answer', () => {
    // `obdurates` is one edit from the answer `obdurate` AND an inflection of
    // it, and is still its own entry. This is the live `nuance`/`nuanced`,
    // `entreat`/`entreaty` case — 14 such pairs in the real library.
    expect(grade('obdurates')).toEqual({ kind: 'otherWord', wordId: 'obdurates' })
  })

  it('rule 2: an unrelated library word is neutral, not wrong', () => {
    expect(grade('docile')).toEqual({ kind: 'otherWord', wordId: 'docile' })
  })

  it('rule 3: an inflection of an answer counts', () => {
    expect(grade('obstinately')).toMatchObject({ kind: 'hit', form: 'obstinate', typo: false })
  })

  it('rule 4: a wrong negation prefix is reported, never forgiven as a typo', () => {
    // One edit from `intractable`; rule 5 would swallow it and delete the only
    // thing 加否定 tests.
    expect(grade('imtractable')).toEqual({ kind: 'prefix', form: 'intractable', wordId: 'intractable' })
  })

  it('rule 4 fires even when the prefix swap is more than one edit away', () => {
    expect(grade('untractable')).toEqual({ kind: 'prefix', form: 'intractable', wordId: 'intractable' })
  })

  it('rule 4 does not fire on a word the author never marked as negated', () => {
    const plain = ask('synonym', ALL, { ...CONCEPT, negations: [] })!
    expect(gradeInput('imtractable', plain, INDEX, new Set())).toEqual({ kind: 'hit', form: 'intractable', wordId: 'intractable', typo: true })
  })

  it('rule 5: one wrong letter is a hit, flagged as a near miss', () => {
    expect(grade('obdurrate')).toEqual({ kind: 'hit', form: 'obdurate', wordId: 'obdurate', typo: true })
  })

  it('rule 5: two swapped letters are one edit, not two', () => {
    // `grumbel` for `grumble` — the commonest slip there is, and plain
    // Levenshtein scores it as a delete plus an insert. Measured over the
    // library, counting it as one edit adds no colliding pair at all.
    expect(grade('obdurtae')).toEqual({ kind: 'hit', form: 'obdurate', wordId: 'obdurate', typo: true })
  })

  it('rule 5 stops at distance 1', () => {
    expect(grade('obdrrrate')).toEqual({ kind: 'outside' })
  })

  it('rule 5 does not take two separate substitutions for a swap', () => {
    // o-b-d-u-r-a-t-e with positions 2 and 5 both wrong is two edits, however
    // much it looks like one mangled word.
    expect(grade('obxurbte')).toEqual({ kind: 'outside' })
  })

  it('rule 5 does not take a non-adjacent swap for one edit', () => {
    expect(grade('obturade')).toEqual({ kind: 'outside' })
  })

  it('rule 5 reports an already-found word rather than a fresh hit', () => {
    expect(grade('obdurrate', ['obdurate'])).toEqual({ kind: 'already', form: 'obdurate' })
  })

  it('rule 6: an English word outside the set and outside the library is neutral', () => {
    expect(grade('pigheaded')).toEqual({ kind: 'outside' })
  })

  it('blank input is neutral, never a hit', () => {
    expect(grade('   ')).toEqual({ kind: 'outside' })
  })

  it('grades a 换词性 answer that is not a library word', () => {
    const posQ = ask('pos')!
    expect(gradeInput('obduracy', posQ, INDEX, new Set())).toMatchObject({ kind: 'hit', form: 'obduracy' })
  })
})

describe('generateDivergeSession', () => {
  const concepts: Concept[] = [CONCEPT, { ...CONCEPT, id: 'second', zh: '第二个概念' }]

  it('mixes axes rather than serving one path', () => {
    const s = generateDivergeSession(concepts, WORDS, progressOf(ALL), 8, () => 0.5)
    expect(new Set(s.map(q => q.axis)).size).toBeGreaterThan(1)
  })

  it('never repeats the same concept and axis inside one round', () => {
    const s = generateDivergeSession(concepts, WORDS, progressOf(ALL), 8, () => 0.5)
    const keys = s.map(q => `${q.conceptId}|${q.axis}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('is deterministic under an injected rng', () => {
    const key = (qs: { conceptId: string; axis: string }[]) => qs.map(q => `${q.conceptId}|${q.axis}`)
    expect(key(generateDivergeSession(concepts, WORDS, progressOf(ALL), 8, () => 0.3)))
      .toEqual(key(generateDivergeSession(concepts, WORDS, progressOf(ALL), 8, () => 0.3)))
  })

  it('gives every askable axis at least one slot', () => {
    const s = generateDivergeSession(concepts, WORDS, progressOf(ALL), 8, () => 0.5)
    const axes = new Set(s.map(q => q.axis))
    // All four are askable for this fixture, and a thin pool must not be
    // crowded out by a fat one.
    expect([...axes].sort()).toEqual(['negation', 'opposite', 'pos', 'synonym'])
  })

  it('spends the slots left over on the bigger pools', () => {
    // `docile` resolves to amenable/compliant/docile, which between them have
    // only two library opposites, no relatedForms and no negations — so a
    // clone of it can ask 近义 and nothing else. Six of those beside six
    // four-axis concepts make the pools 12 / 6 / 6 / 6, and **every axis still
    // has room**, so the split is decided by proportionality and not by one
    // axis running out. A flat rotation would hand out 3 / 3 / 3 / 3.
    const full = Array.from({ length: 6 }, (_, i) => ({ ...CONCEPT, id: `f${i}` }))
    const synonymOnly = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, zh: '温顺', anchors: ['docile'] }))
    const s = generateDivergeSession([...full, ...synonymOnly], WORDS, progressOf(ALL), 12, () => 0.5)
    const n = (a: string) => s.filter(q => q.axis === a).length
    expect([n('synonym'), n('opposite'), n('pos'), n('negation')]).toEqual([6, 2, 2, 2])
  })

  it('alternates axes question to question rather than serving them in blocks', () => {
    // Equal pools and 8 questions means two slots per axis, so a round that
    // interleaves opens with all four axes before repeating any. Serving them
    // in blocks would put two 近义 in the first two positions.
    const many = Array.from({ length: 12 }, (_, i) => ({ ...CONCEPT, id: `c${i}` }))
    const s = generateDivergeSession(many, WORDS, progressOf(ALL), 8, () => 0.5)
    expect(new Set(s.slice(0, 4).map(q => q.axis)).size).toBe(4)
    expect(new Set(s.slice(4, 8).map(q => q.axis)).size).toBe(4)
  })

  it('fills the round from whatever is left rather than coming up short', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...CONCEPT, id: `c${i}` }))
    expect(generateDivergeSession(many, WORDS, progressOf(ALL), 8, () => 0.5)).toHaveLength(8)
  })

  it('stops at the requested count', () => {
    expect(generateDivergeSession(concepts, WORDS, progressOf(ALL), 3, () => 0.5)).toHaveLength(3)
  })

  it('returns nothing rather than a thin round when nothing is learned', () => {
    expect(generateDivergeSession(concepts, WORDS, progressOf([]), 8, () => 0.5)).toEqual([])
  })

  it('covers every axis name it declares', () => {
    expect([...DIVERGE_AXES]).toEqual(['synonym', 'opposite', 'pos', 'negation'])
  })
})
