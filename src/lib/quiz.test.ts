import { describe, expect, it } from 'vitest'
import { QUIZ_TYPES, clozeCollocation, clozeExample, generateAudioQuiz, generateContrastQuiz, generateQuiz, pickCloze, pickMeaning, sharedSynonyms } from './quiz'
import { emptyProgress } from '../types'
import type { Meaning, Progress, Word } from '../types'

// These fields cover everything the six question types need: examples/collocations contain
// the base headword form (the cloze question must be able to locate it), synonyms/antonyms
// are prefixed with the id so they're naturally distinct and never shared with other fixture
// words (otherwise sharedSynonyms would exclude them and synonymHint could never come up).
const word = (id: string, zh: string): Word => ({
  id, headword: id, phonetic: `/${id}/`, meanings: [{ pos: 'v.', en: `def of ${id}`, zh }],
  examples: [`We ${id} things daily.`, `They ${id} it again.`],
  synonyms: [`${id}-syn1`, `${id}-syn2`, `${id}-syn3`],
  antonyms: [`${id}-ant1`, `${id}-ant2`],
  collocations: [`${id} a plan`, `${id} the rules`],
  relatedForms: [], sourceNote: 't', addedAt: '2026-07-01',
})
const words = [word('alpha', '甲'), word('bravo', '乙'), word('carol', '丙'), word('delta', '丁'), word('echo', '戊'), word('fox', '己')]

const studied = (): Progress => {
  const p = emptyProgress()
  for (const w of words) {
    p.words[w.id] = { state: 'review', ease: 2.5, intervalDays: 3, due: '2026-08-01', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-20T00:00:00Z' }
  }
  return p
}
const seq = () => { let i = 0; return () => ((i = (i + 7) % 13), i / 13) }

const wordP = (id: string, pos: string, zh: string): Word => ({
  id, headword: id, phonetic: `/${id}/`, meanings: [{ pos, en: `def of ${id}`, zh }],
  examples: ['a', 'b'], synonyms: [], antonyms: [], collocations: [], relatedForms: [], sourceNote: 't', addedAt: '2026-07-01',
})

/** Multi-sense-word fixture: senses are pre-sorted by share in descending order (matches the storage invariant in data/words.json) */
const multi = (id: string, shares: number[]): Word => ({
  id, headword: id, phonetic: `/${id}/`,
  // zh must include the id: sense labels are deduplicated by display text inside
  // pickDistractorLabels, and words sharing generic labels like "sense0/sense1" would get all
  // their distractors filtered out, so not a single question could be generated.
  meanings: shares.map((share, i): Meaning => ({ pos: 'v.', en: `sense ${i} of ${id}`, zh: `${id}义${i}`, share })),
  examples: [`We ${id} things daily.`, `They ${id} it again.`],
  synonyms: [`${id}-syn1`], antonyms: [], collocations: [`${id} a plan`],
  relatedForms: [], sourceNote: 't', addedAt: '2026-07-01',
})

describe('pickMeaning', () => {
  it('a single-sense word returns that one sense directly', () => {
    const w = word('solo', '甲')
    expect(pickMeaning(w, () => 0.99).zh).toBe('甲')
  })

  it('segmented by share: at 90/10, rng<0.9 lands on the first sense, ≥0.9 lands on the second', () => {
    const w = multi('m', [90, 10])
    expect(pickMeaning(w, () => 0).zh).toBe('m义0')
    expect(pickMeaning(w, () => 0.5).zh).toBe('m义0')
    expect(pickMeaning(w, () => 0.899).zh).toBe('m义0')
    expect(pickMeaning(w, () => 0.9).zh).toBe('m义1')
    expect(pickMeaning(w, () => 0.999).zh).toBe('m义1')
  })

  it('segment boundaries for a three-sense 60/30/10 split', () => {
    const w = multi('m', [60, 30, 10])
    expect(pickMeaning(w, () => 0.59).zh).toBe('m义0')
    expect(pickMeaning(w, () => 0.6).zh).toBe('m义1')
    expect(pickMeaning(w, () => 0.89).zh).toBe('m义1')
    expect(pickMeaning(w, () => 0.9).zh).toBe('m义2')
  })

  it('does not go out of bounds when rng returns close to 1', () => {
    const w = multi('m', [50, 50])
    expect(pickMeaning(w, () => 0.9999999999).zh).toBe('m义1')
  })

  it('multi-sense but no share data (old data pushed from elsewhere) falls back to the first sense, instead of randomizing blindly', () => {
    const w = multi('m', [50, 50])
    w.meanings = w.meanings.map(m => ({ pos: m.pos, en: m.en, zh: m.zh }))
    expect(pickMeaning(w, () => 0.99).zh).toBe('m义0')
  })

  it('falls back to the first sense even when only some shares are filled in — partial data is not enough to weight by', () => {
    const w = multi('m', [50, 50])
    delete w.meanings[1].share
    expect(pickMeaning(w, () => 0.99).zh).toBe('m义0')
  })
})

describe('generateQuiz — sense share weighting', () => {
  const multiWords = [multi('alpha', [70, 30]), multi('bravo', [70, 30]), multi('carol', [70, 30]), multi('delta', [70, 30]), multi('echo', [70, 30]), multi('fox', [70, 30])]
  const studiedMulti = (): Progress => {
    const p = emptyProgress()
    for (const w of multiWords) {
      p.words[w.id] = { state: 'review', ease: 2.5, intervalDays: 3, due: '2026-08-01', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-20T00:00:00Z' }
    }
    return p
  }

  it('a minor sense can be tested too — it used to be hardcoded to meanings[0], so the 30% sense would never come up', () => {
    // rng is always 0.95 → every draw lands in the last 30% of the 70/30 split
    const qs = generateQuiz(multiWords, studiedMulti(), 6, () => 0.95)
    const withMeaning = qs.filter(q => q.type === 'word2meaning' || q.type === 'meaning2word' || q.type === 'spelling')
    expect(withMeaning.length).toBeGreaterThan(0)
    const texts = withMeaning.map(q => (q.type === 'word2meaning' ? q.answer : q.prompt))
    expect(texts.some(t => /义1$/.test(t))).toBe(true)
  })

  it('another sense of the same word never appears among the options — when the prompt is just the headword, both would be correct', () => {
    // This must use an rng that **actually varies**: with a constant rng, meaningOf(w) always
    // returns the same sense, so it always equals answer and gets blocked by seen — the
    // `x.id !== w.id` filter in pickDistractorLabels never even gets exercised, and the
    // assertion would be a no-op. (Verified: removing that filter, the constant-rng version
    // still passes entirely.)
    const lcg = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff)
    for (let s = 1; s <= 40; s++) {
      const qs = generateQuiz(multiWords, studiedMulti(), 12, lcg(s))
      for (const q of qs.filter(q => q.type === 'word2meaning')) {
        const w = multiWords.find(x => x.id === q.wordId)!
        const ownLabels = w.meanings.map(m => `${m.pos} ${m.zh}`)
        expect(q.options.filter(o => ownLabels.includes(o))).toHaveLength(1)
      }
    }
  })
})

describe('generateQuiz', () => {
  it('generates the requested count, rotates question types, never repeats a word', () => {
    const qs = generateQuiz(words, studied(), 6, seq())
    expect(qs).toHaveLength(6)
    expect(new Set(qs.map(q => q.wordId)).size).toBe(6)
    // question types rotate deterministically, evenly distributed within one round. No longer
    // hardcoding the total number of types here — this asserts the "rotation" contract itself,
    // so this line doesn't need to change when a new type is added.
    const types = qs.map(q => q.type)
    expect(new Set(types).size).toBe(Math.min(qs.length, QUIZ_TYPES.length))
  })
  it('multiple-choice questions have 4 options including the correct answer, with no duplicate options', () => {
    const qs = generateQuiz(words, studied(), 6, seq())
    for (const q of qs.filter(q => q.type !== 'spelling')) {
      expect(q.options).toHaveLength(4)
      expect(new Set(q.options).size).toBe(4)
      expect(q.options).toContain(q.answer)
    }
  })
  it('spelling questions have no options, and the answer is the headword', () => {
    const qs = generateQuiz(words, studied(), 6, seq())
    const sp = qs.find(q => q.type === 'spelling')!
    expect(sp.options).toEqual([])
    expect(sp.answer).toBe(sp.wordId)
  })
  it('falls back to the full word list when fewer than 4 words have been learned', () => {
    const qs = generateQuiz(words, emptyProgress(), 4, seq())
    expect(qs).toHaveLength(4)
  })
  it('returns empty when the word list has fewer than 4 words', () => {
    expect(generateQuiz(words.slice(0, 3), emptyProgress(), 5, seq())).toEqual([])
  })
  it('spelling questions carry a separate phonetic field, the prompt no longer has the phonetic appended', () => {
    const qs = generateQuiz(words, studied(), 6, seq())
    const sp = qs.find(q => q.type === 'spelling')!
    const w = words.find(x => x.id === sp.wordId)!
    expect(sp.phonetic).toBe(w.phonetic)
    expect(sp.prompt).not.toContain(w.phonetic)
  })
  it('multiple-choice questions do not carry a phonetic field', () => {
    const qs = generateQuiz(words, studied(), 6, seq())
    for (const q of qs.filter(q => q.type !== 'spelling')) {
      expect(q.phonetic).toBeUndefined()
    }
  })
  it('distractors are deduplicated by display text, so synonyms sharing a sense never produce a duplicate option or a duplicate correct answer', () => {
    // abolish/rescind share the same meaningLabel ("v. 废除"). Only the first 4 words are marked
    // learned (this synonym pair plus 2 words with distinct senses), so the learned pool has
    // fewer than 3 non-colliding candidates, forcing distractors to be topped up from the full
    // word list (including the unlearned delta/echo) to make up 4 mutually distinct options.
    const collisionWords = [
      wordP('abolish', 'v.', '废除'),
      wordP('rescind', 'v.', '废除'), // shares the same meaningLabel as abolish
      wordP('bravo', 'n.', '乙'),
      wordP('carol', 'n.', '丙'),
      wordP('delta', 'n.', '丁'),
      wordP('echo', 'n.', '戊'),
    ]
    const p = emptyProgress()
    for (const w of collisionWords.slice(0, 4)) {
      p.words[w.id] = { state: 'review', ease: 2.5, intervalDays: 3, due: '2026-08-01', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-20T00:00:00Z' }
    }
    const zeroRng = () => 0
    for (const count of [1, 2, 3, 4]) {
      const qs = generateQuiz(collisionWords, p, count, zeroRng)
      for (const q of qs.filter(q => q.type !== 'spelling')) {
        expect(new Set(q.options).size).toBe(4)
        expect(q.options.filter(o => o === q.answer).length).toBe(1)
      }
    }
  })
})

describe('clozeExample', () => {
  it('blanks out the headword when it appears in its base form', () => {
    expect(clozeExample('She concoct a story quickly.', 'concoct'))
      .toBe('She ___ a story quickly.')
  })
  it('blanks out the headword when it appears as an inflected form', () => {
    expect(clozeExample('She concocted an elaborate excuse.', 'concoct'))
      .toBe('She ___ an elaborate excuse.')
  })
  it('is case-insensitive', () => {
    expect(clozeExample('Concocting excuses is his talent.', 'concoct'))
      .toBe('___ excuses is his talent.')
  })
  it('blanks out every occurrence within the same sentence, leaving none that would give away the answer', () => {
    expect(clozeExample('He concocted it, then concocted more.', 'concoct'))
      .toBe('He ___ it, then ___ more.')
  })
  it('multi-word headwords are blanked as a whole', () => {
    expect(clozeExample('They agreed on an ad hoc basis.', 'ad hoc'))
      .toBe('They agreed on an ___ basis.')
  })
  it('returns null when it cannot be located, leaving it to the caller to skip this example', () => {
    expect(clozeExample('Nothing relevant here.', 'concoct')).toBeNull()
  })
})

describe('clozeCollocation', () => {
  it('blanks out the headword within the collocation', () => {
    expect(clozeCollocation('abrogate a treaty', 'abrogate')).toBe('___ a treaty')
  })
  it('can blank the headword even in the middle', () => {
    expect(clozeCollocation('formally abrogate an accord', 'abrogate'))
      .toBe('formally ___ an accord')
  })
  it('inflected forms are handled the same way', () => {
    expect(clozeCollocation('abrogated the agreement', 'abrogate'))
      .toBe('___ the agreement')
  })
  it('returns null when it cannot be located', () => {
    expect(clozeCollocation('a binding accord', 'abrogate')).toBeNull()
  })
})

describe('sharedSynonyms', () => {
  it('finds synonyms/antonyms shared by multiple entries (case-normalized to lowercase)', () => {
    const ws = [
      word('alpha', '甲'), word('bravo', '乙'),
    ]
    ws[0].synonyms = ['Common', 'onlyA']
    ws[1].synonyms = ['common', 'onlyB']
    const shared = sharedSynonyms(ws)
    expect(shared.has('common')).toBe(true)
    expect(shared.has('onlya')).toBe(false)
  })
  it('antonyms are counted together with synonyms', () => {
    const ws = [word('alpha', '甲'), word('bravo', '乙')]
    ws[0].synonyms = ['x']
    ws[1].antonyms = ['X']
    expect(sharedSynonyms(ws).has('x')).toBe(true)
  })
})

describe('new question types', () => {
  it('example cloze: the prompt contains a blank and not the answer word, choose one headword out of four', () => {
    const qs = generateQuiz(words, studied(), 12, seq())
    const q = qs.find(x => x.type === 'clozeExample')
    if (q === undefined) return // did not come up this round, not a failure
    expect(q.prompt).toContain('___')
    expect(q.prompt.toLowerCase()).not.toContain(q.answer.toLowerCase())
    expect(q.options).toHaveLength(4)
    expect(q.options).toContain(q.answer)
  })
  it('collocation cloze: likewise does not give away the answer', () => {
    const qs = generateQuiz(words, studied(), 12, seq())
    const q = qs.find(x => x.type === 'clozeCollocation')
    if (q === undefined) return
    expect(q.prompt).toContain('___')
    expect(q.prompt.toLowerCase()).not.toContain(q.answer.toLowerCase())
  })
  it('synonym/antonym hint: labels the kind, and the hint word is not a shared synonym', () => {
    const qs = generateQuiz(words, studied(), 12, seq())
    const q = qs.find(x => x.type === 'synonymHint')
    if (q === undefined) return
    expect(q.hintKind === 'synonym' || q.hintKind === 'antonym').toBe(true)
    expect(sharedSynonyms(words).has(q.prompt.toLowerCase())).toBe(false)
  })
})

// --- Bonus-practice modes ------------------------------------------------------

/** Confusable-word fixture: two words share a synonym, and each example sentence contains only its own headword, not the other's. */
const pairWord = (id: string, syns: string[], pos = 'v.'): Word => ({
  id, headword: id, phonetic: `/${id}/`,
  meanings: [{ pos, en: `def of ${id}`, zh: `${id}义` }],
  examples: [`The board voted to ${id} the policy.`, `They ${id} it every spring.`],
  synonyms: syns, antonyms: [], collocations: [`${id} a plan`],
  relatedForms: [], sourceNote: 't', addedAt: '2026-07-01',
})

const studiedOf = (ws: Word[]): Progress => {
  const p = emptyProgress()
  for (const w of ws) {
    p.words[w.id] = { state: 'review', ease: 2.5, intervalDays: 3, due: '2026-08-01', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-20T00:00:00Z' }
  }
  return p
}

describe('generateContrastQuiz', () => {
  const pairWords = [
    pairWord('alpha', ['shared1', 'shared2', 'shared3']),
    pairWord('bravo', ['shared1', 'shared2', 'shared3']),
    pairWord('carol', ['other1', 'other2', 'other3']),
    pairWord('delta', ['other1', 'other2', 'other3']),
  ]

  it('produces only two options — discrimination questions are a binary choice, not four-way', () => {
    const qs = generateContrastQuiz(pairWords, studiedOf(pairWords), 4, seq())
    expect(qs.length).toBeGreaterThan(0)
    for (const q of qs) {
      expect(q.type).toBe('contrast')
      expect(q.options).toHaveLength(2)
      expect(q.options).toContain(q.answer)
    }
  })

  it('the prompt is blanked and does not leak the answer word', () => {
    const qs = generateContrastQuiz(pairWords, studiedOf(pairWords), 4, seq())
    for (const q of qs) {
      expect(q.prompt).toContain('___')
      expect(q.prompt.toLowerCase()).not.toContain(q.answer.toLowerCase())
    }
  })

  it('contrastId points to the contrasting word, and never equals this question\'s word', () => {
    const qs = generateContrastQuiz(pairWords, studiedOf(pairWords), 4, seq())
    for (const q of qs) {
      expect(q.contrastId).toBeDefined()
      expect(q.contrastId).not.toBe(q.wordId)
      // the two options are exactly these two words' headwords
      const ids = [q.wordId, q.contrastId]
      const heads = ids.map(id => pairWords.find(w => w.id === id)?.headword)
      expect([...q.options].sort()).toEqual([...heads as string[]].sort())
    }
  })

  it('the question is not generated when both words appear in the sentence — blanking one would leave the other sitting right there, giving away the answer', () => {
    // **Both words' example sentences contain both words**, so whichever one is picked as the
    // answer must be blocked by the guard — the only correct outcome is zero questions. Earlier,
    // only one side leaked the answer, so the generator could randomly land on the clean side
    // and bypass the guard entirely, making the assertion equivalent to not writing one at all
    // (mutation testing caught this).
    const both = ['We alpha and bravo together.', 'They alpha then bravo.']
    const leaky = [
      { ...pairWord('alpha', ['s1']), examples: both },
      { ...pairWord('bravo', ['s1']), examples: both },
    ]
    expect(generateContrastQuiz(leaky, studiedOf(leaky), 4, seq())).toEqual([])
  })

  it('switches to the other side as the answer when one side cannot be blanked, so the pair is not wasted', () => {
    const noSelfMention = { ...pairWord('alpha', ['s1']), examples: ['Nothing here matches.', 'Still nothing.'] }
    const ws = [noSelfMention, pairWord('bravo', ['s1'])]
    // the two constant rngs each walk the "try alpha first" and "try bravo first" branches, and both must succeed in producing a question
    for (const r of [() => 0.1, () => 0.9]) {
      const qs = generateContrastQuiz(ws, studiedOf(ws), 4, r)
      expect(qs).toHaveLength(1)
      expect(qs[0].answer).toBe('bravo')
    }
  })

  it('returns an empty array without throwing when no pair can be formed', () => {
    const lonely = [pairWord('alpha', ['x']), pairWord('bravo', ['y'])]
    expect(generateContrastQuiz(lonely, studiedOf(lonely), 4, seq())).toEqual([])
  })

  it('never exceeds the requested question count', () => {
    expect(generateContrastQuiz(pairWords, studiedOf(pairWords), 1, seq())).toHaveLength(1)
  })
})

describe('generateAudioQuiz', () => {
  it('listen-and-choose-meaning: choose one out of four senses, the prompt is the headword to be read aloud', () => {
    const qs = generateAudioQuiz(words, studied(), 6, seq())
    const q = qs.find(x => x.type === 'audio2meaning')
    expect(q).toBeDefined()
    expect(q!.options).toHaveLength(4)
    expect(q!.options).toContain(q!.answer)
    // prompt stores the headword (what gets read aloud), **not** the text shown to the user
    expect(words.some(w => w.headword === q!.prompt)).toBe(true)
  })

  it('listen-and-spell: no options, the answer is the headword, with the phonetic included for display on reveal', () => {
    const qs = generateAudioQuiz(words, studied(), 6, seq())
    const q = qs.find(x => x.type === 'audio2spelling')
    expect(q).toBeDefined()
    expect(q!.options).toEqual([])
    expect(q!.answer).toBe(q!.prompt)
    expect(q!.phonetic).toBeDefined()
  })

  it('the two question types rotate, never sticking to just one for a whole round', () => {
    const qs = generateAudioQuiz(words, studied(), 6, seq())
    expect(new Set(qs.map(q => q.type)).size).toBe(2)
  })

  it('returns an empty array when the word list has fewer than 4 words', () => {
    expect(generateAudioQuiz(words.slice(0, 3), emptyProgress(), 4, seq())).toEqual([])
  })
})

describe('generateQuiz question-type restriction (used by sprint mode)', () => {
  it('only generates the specified types', () => {
    const qs = generateQuiz(words, studied(), 6, seq(), ['word2meaning'])
    expect(qs.length).toBeGreaterThan(0)
    expect(qs.every(q => q.type === 'word2meaning')).toBe(true)
  })

  it('when two types are specified, both actually come up', () => {
    const qs = generateQuiz(words, studied(), 6, seq(), ['word2meaning', 'meaning2word'])
    expect(new Set(qs.map(q => q.type))).toEqual(new Set(['word2meaning', 'meaning2word']))
  })

  it('an empty type list returns an empty array, without looping forever or falling back to the default types', () => {
    expect(generateQuiz(words, studied(), 6, seq(), [])).toEqual([])
  })

  it('behavior is unchanged when this parameter is omitted — all six types still rotate', () => {
    const qs = generateQuiz(words, studied(), 6, seq())
    expect(new Set(qs.map(q => q.type)).size).toBeGreaterThan(1)
    expect(qs.every(q => QUIZ_TYPES.includes(q.type))).toBe(true)
  })
})

// --- Cloze-prompt diversity ------------------------------------------------------
// Measured (400 rounds against a real user's progress): of the 63 words that produced a cloze
// question, **not one** ever showed a second variant of the prompt, even though 297/471 words
// have 3 example sentences. The root cause: the loop that picks an example sentence breaks on
// the first hit. This had to be fixed before writing more example sentences, or the new ones
// would never get used.

describe('pickCloze', () => {
  const three = ['We alpha the plan.', 'They alpha it twice.', 'She alpha nothing.']

  it('the picked sentence comes from the candidates and is already blanked', () => {
    const got = pickCloze(three, 'alpha', () => 0.4)
    expect(got).not.toBeNull()
    expect(got).toContain('___')
    expect(got!.toLowerCase()).not.toContain('alpha')
  })

  it('**different rng values give different sentences** — this is the whole reason this function exists', () => {
    const a = pickCloze(three, 'alpha', () => 0)
    const b = pickCloze(three, 'alpha', () => 0.99)
    expect(a).not.toBe(b)
  })

  it('when only one sentence can be blanked, that sentence is returned regardless of rng', () => {
    const mixed = ['Nothing here.', 'They alpha it twice.', 'Still nothing.']
    expect(pickCloze(mixed, 'alpha', () => 0)).toBe(pickCloze(mixed, 'alpha', () => 0.99))
    expect(pickCloze(mixed, 'alpha', () => 0.5)).toContain('___')
  })

  it('returns null when no sentence can be located, never a prompt without a blank', () => {
    expect(pickCloze(['Nothing.', 'Still nothing.'], 'alpha', () => 0.5)).toBeNull()
    expect(pickCloze([], 'alpha', () => 0.5)).toBeNull()
  })
})

// --- Discrimination mode only tests learned words --------------------------------------
// Measured: sorting is not the same as filtering. A user's 63 learned words only paired up
// into 7 contrast pairs, and once those ran out it fell through to unlearned words — 53.7% of
// the questions tested words the user had never seen. The combined and listening modes hard-
// filter via questionPool and both measured 0%.

describe('generateContrastQuiz only tests learned words', () => {
  const ws = [
    pairWord('alpha', ['s1']),
    pairWord('bravo', ['s1']),
    pairWord('carol', ['s2']),
    pairWord('delta', ['s2']),
  ]
  const learnedOnly = (ids: string[]): Progress => {
    const p = emptyProgress()
    for (const id of ids) {
      p.words[id] = { state: 'review', ease: 2.5, intervalDays: 3, due: '2026-08-01', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-20T00:00:00Z' }
    }
    return p
  }

  it('a question is only generated when both words have been learned', () => {
    const qs = generateContrastQuiz(ws, learnedOnly(['alpha', 'bravo']), 10, seq())
    expect(qs.length).toBeGreaterThan(0)
    for (const q of qs) {
      expect(['alpha', 'bravo']).toContain(q.wordId)
      expect(['alpha', 'bravo']).toContain(q.contrastId)
    }
  })

  it('better to produce fewer questions than to mix in unlearned words — with only one pair learned, only one question comes out', () => {
    expect(generateContrastQuiz(ws, learnedOnly(['alpha', 'bravo']), 10, seq())).toHaveLength(1)
  })

  it('learning only one word of a pair means that pair produces no question either — the options must not contain an unseen word', () => {
    expect(generateContrastQuiz(ws, learnedOnly(['alpha', 'carol']), 10, seq())).toEqual([])
  })

  it('produces nothing when no word at all has been learned, **and does not fall back to the full library** — the empty state has an explanation, and out-of-syllabus questions would only waste time', () => {
    expect(generateContrastQuiz(ws, emptyProgress(), 4, seq())).toEqual([])
  })

  it('repeated questions on the same pair use different sentences, not the same one every time', () => {
    // Only one pair of words, with the answer side fixed, so the only thing that varies is the
    // example sentence — otherwise "the prompt differs" could simply be because this round
    // picked a different word as the answer, and the assertion would never actually test the
    // shuffling itself.
    const three = {
      ...pairWord('alpha', ['s1']),
      examples: [
        'The board voted to alpha the policy.',
        'They alpha it every spring.',
        'Nobody wanted to alpha anything.',
      ],
    }
    const pair = [three, pairWord('bravo', ['s1'])]
    const p = studiedOf(pair)
    // rng call order: (1) which side is the answer (2)(3) example-sentence shuffle (3 elements, two swaps) (4) option shuffle
    const seqOf = (vals: number[]) => { let i = 0; return () => vals[i++ % vals.length] }
    const a = generateContrastQuiz(pair, p, 1, seqOf([0.1, 0, 0, 0.5]))
    const b = generateContrastQuiz(pair, p, 1, seqOf([0.1, 0.99, 0.99, 0.5]))
    expect(a[0].answer).toBe('alpha')
    expect(b[0].answer).toBe('alpha')   // answer side is consistent, confirming that what varies is indeed the sentence
    expect(a[0].prompt).not.toBe(b[0].prompt)
  })
})
