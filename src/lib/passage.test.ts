import { describe, expect, it } from 'vitest'
import { buildPassageQuestion, DUE_WEIGHT, LEARNED_WEIGHT, MAX_BLANKS, parsePassage, parseSentence, pickDistractors, pickPassage, pushRecent, RECENT_LIMIT, RECENT_PENALTY, scoreQuestion, selectBlanks } from './passage'
import type { Passage } from './passage'
import { emptyProgress } from '../types'
import type { Progress, Word } from '../types'
import { buildContrastPairs } from './contrast'

/**
 * The pure logic behind passage question generation. The UI gets no component tests (per repo
 * convention, see the top of store.test.tsx), so every branch worth testing has to live in this
 * file.
 */

const passage = (over: Partial<Passage> = {}): Passage => ({
  id: 'p1',
  title: '测试短文',
  en: ['The board was {{contentious}} about it.'],
  zh: ['董事会对此争议不小。'],
  ...over,
})

/** Build a word entry that's good enough. The tests only care about id / headword / meanings[0].pos. */
const word = (id: string, pos = 'v.'): Word => ({
  id, headword: id, phonetic: '',
  meanings: [{ pos, en: '', zh: id }],
  examples: [], synonyms: [], antonyms: [], collocations: [], relatedForms: [],
  sourceNote: 'test', addedAt: '2026-01-01',
})

/** Progress with state=review and a controllable due date. Words in ids count as learned. */
const progressWith = (entries: Record<string, string>): Progress => {
  const p = emptyProgress()
  for (const [id, due] of Object.entries(entries)) {
    p.words[id] = {
      state: 'review', ease: 2.5, intervalDays: 5, due,
      stepIndex: 0, reps: 3, lapses: 0, lastReviewedAt: '2026-01-01T00:00:00.000Z',
    }
  }
  return p
}

const byId = (ws: Word[]) => new Map(ws.map(w => [w.id, w]))

const TODAY = '2026-07-28'

/**
 * A reproducible pseudo-random number generator. **Do not substitute `() => 0.5`**: that makes
 * shuffle's `Math.floor(0.5 * (i+1))` degenerate into a fixed permutation, so the "randomness"
 * being tested never actually moves at all.
 */
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('parseSentence', () => {
  it('shorthand marker: the headword is the in-sentence form', () => {
    expect(parseSentence('a {{refute}} b')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'word', wordId: 'refute', surface: 'refute' },
      { kind: 'text', text: ' b' },
    ])
  })

  it('marker with a pipe: the in-sentence form differs from the headword', () => {
    expect(parseSentence('they {{refute|refuted}} it')).toEqual([
      { kind: 'text', text: 'they ' },
      { kind: 'word', wordId: 'refute', surface: 'refuted' },
      { kind: 'text', text: ' it' },
    ])
  })

  it('multiple markers in one sentence', () => {
    expect(parseSentence('{{a}} and {{b|bs}}')).toEqual([
      { kind: 'word', wordId: 'a', surface: 'a' },
      { kind: 'text', text: ' and ' },
      { kind: 'word', wordId: 'b', surface: 'bs' },
    ])
  })

  it('marker at the start of the sentence: no empty text segment before it', () => {
    expect(parseSentence('{{a}} b')).toEqual([
      { kind: 'word', wordId: 'a', surface: 'a' },
      { kind: 'text', text: ' b' },
    ])
  })

  it('marker at the end of the sentence: no empty text segment after it', () => {
    expect(parseSentence('a {{b}}')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'word', wordId: 'b', surface: 'b' },
    ])
  })

  it('no content between adjacent markers: no empty text segment appears', () => {
    expect(parseSentence('{{a}}{{b}}')).toEqual([
      { kind: 'word', wordId: 'a', surface: 'a' },
      { kind: 'word', wordId: 'b', surface: 'b' },
    ])
  })

  it('the whole sentence is one text segment when there is no marker', () => {
    expect(parseSentence('plain text')).toEqual([{ kind: 'text', text: 'plain text' }])
  })

  it('returns null on a malformed marker — better to skip the whole passage than to blank the wrong word', () => {
    expect(parseSentence('a {{b} c')).toBeNull()       // unmatched brackets
    expect(parseSentence('a {{b|c|d}} e')).toBeNull()  // two pipes
    expect(parseSentence('a {{}} b')).toBeNull()       // empty id
    expect(parseSentence('a {{b|}} c')).toBeNull()     // empty surface form
    expect(parseSentence('a {{ }} b')).toBeNull()      // id is all whitespace, empty after trim
    expect(parseSentence('a {{b| }} c')).toBeNull()    // surface form is all whitespace, empty after trim
    // Forgot the pipe: {{refute refuted}} gets treated as a single id containing a space,
    // and an id like that can never match any lowercase, space-free Word.id in words.json
    expect(parseSentence('a {{refute refuted}} b')).toBeNull()
    expect(parseSentence('a {{Refute}} b')).toBeNull() // id contains uppercase, likewise won't match any word
  })
})

describe('parsePassage', () => {
  it('parses sentence by sentence, returning a 2D token array when the sentence count matches zh', () => {
    const r = parsePassage(passage({ en: ['{{a}} x.', 'y {{b}}.'], zh: ['甲', '乙'] }))
    expect(r).toEqual([
      [
        { kind: 'word', wordId: 'a', surface: 'a' },
        { kind: 'text', text: ' x.' },
      ],
      [
        { kind: 'text', text: 'y ' },
        { kind: 'word', wordId: 'b', surface: 'b' },
        { kind: 'text', text: '.' },
      ],
    ])
  })

  it('returns null when the Chinese translation sentence count does not match — the reader is lenient toward bad data and skips this passage', () => {
    expect(parsePassage(passage({ en: ['a', 'b'], zh: ['甲'] }))).toBeNull()
  })

  it('returns null for an empty passage', () => {
    expect(parsePassage(passage({ en: [], zh: [] }))).toBeNull()
  })

  it('returns null for the whole passage if any single sentence is malformed', () => {
    expect(parsePassage(passage({ en: ['ok {{a}}', 'bad {{b}'], zh: ['甲', '乙'] }))).toBeNull()
  })
})

describe('selectBlanks', () => {
  /** Build a fresh one each time with a fixed seed — no shared state, so assertions don't depend on test execution order. */
  const rng = () => mulberry32(1)

  it('only blanks words that have been learned; unlearned words stay in the text as-is, as reading material', () => {
    const sentences = parsePassage(passage({
      en: ['{{a}} {{b}} {{c}}'], zh: ['甲'],
    }))!
    const words = [word('a'), word('b'), word('c')]
    const progress = progressWith({ a: TODAY, b: TODAY })  // c has not been learned
    const blanks = selectBlanks(sentences, byId(words), progress, TODAY, rng())
    expect(blanks.map(b => b.wordId)).toEqual(['a', 'b'])
  })

  it('words not found in the word list are not blanked — the repo copy and the live word list can diverge', () => {
    const sentences = parsePassage(passage({ en: ['{{a}} {{ghost}}'], zh: ['甲'] }))!
    const progress = progressWith({ a: TODAY, ghost: TODAY })
    const blanks = selectBlanks(sentences, byId([word('a')]), progress, TODAY, rng())
    expect(blanks.map(b => b.wordId)).toEqual(['a'])
  })

  it('the same word gets at most one blank per passage, otherwise the candidate area would show two identical words', () => {
    const sentences = parsePassage(passage({ en: ['{{a}} then {{a|as}}'], zh: ['甲'] }))!
    const blanks = selectBlanks(sentences, byId([word('a')]), progressWith({ a: TODAY }), TODAY, rng())
    expect(blanks).toHaveLength(1)
    expect(blanks[0].surface).toBe('a')
  })

  it('carries the in-sentence form and position', () => {
    const sentences = parsePassage(passage({
      en: ['x {{refute|refuted}} y', 'z {{a}}'], zh: ['甲', '乙'],
    }))!
    const words = [word('refute'), word('a')]
    const blanks = selectBlanks(sentences, byId(words), progressWith({ refute: TODAY, a: TODAY }), TODAY, rng())
    expect(blanks[0]).toMatchObject({ si: 0, ti: 1, wordId: 'refute', surface: 'refuted' })
    expect(blanks[1]).toMatchObject({ si: 1, wordId: 'a' })
  })

  it('due words take priority once over the limit, but the result is still returned in text order', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    const sentences = parsePassage(passage({
      en: [ids.map(i => `{{${i}}}`).join(' ')], zh: ['甲'],
    }))!
    const words = ids.map(i => word(i))
    // the first two are not due, the rest are — 9 candidates trimmed to 7 should drop the first two
    const progress = progressWith(Object.fromEntries(
      ids.map((i, n) => [i, n < 2 ? '2099-01-01' : TODAY]),
    ))
    // shuffling within the group doesn't affect this: exactly 7 words are due = MAX_BLANKS, so
    // the whole group is selected no matter how it's shuffled, and the two not-due words are
    // always outside the top 7 regardless of shuffle. This asserts two invariants — "due first"
    // and "text order" — independent of in-group order, so there's no need to loosen the
    // assertion just to make the test pass.
    const blanks = selectBlanks(sentences, byId(words), progress, TODAY, rng())
    expect(blanks).toHaveLength(MAX_BLANKS)
    expect(blanks.map(b => b.wordId)).toEqual(['c', 'd', 'e', 'f', 'g', 'h', 'i'])
  })

  it('the words trimmed away are not always the same ones — a word marked in the corpus should not be permanently untestable', () => {
    const ids = Array.from({ length: MAX_BLANKS + 3 }, (_, i) => `w${i}`)
    const sentences = parsePassage(passage({
      en: [ids.map(i => `{{${i}}}`).join(' ')], zh: ['甲'],
    }))!
    const words = ids.map(i => word(i))
    const progress = progressWith(Object.fromEntries(ids.map(i => [i, TODAY])))

    const sets = new Set<string>()
    const everChosen = new Set<string>()
    for (let seed = 1; seed <= 100; seed++) {
      const blanks = selectBlanks(sentences, byId(words), progress, TODAY, mulberry32(seed))
      expect(blanks).toHaveLength(MAX_BLANKS)
      // the text-order invariant still holds after shuffling
      expect(blanks.map(b => b.si * 100 + b.ti)).toEqual([...blanks.map(b => b.si * 100 + b.ti)].sort((x, y) => x - y))
      sets.add(blanks.map(b => b.wordId).join(','))
      for (const b of blanks) everChosen.add(b.wordId)
    }
    // this asserts that there is variation, not any one specific outcome
    expect(sets.size).toBeGreaterThan(1)
    // every marked word must have a chance of being blanked; none can be permanently excluded
    expect([...everChosen].sort()).toEqual([...ids].sort())
  })
})

describe('pickDistractors', () => {
  const rng = () => 0.5
  const none = new Set<string>()

  it('prioritizes learned words that are easily confused with an answer', () => {
    const answer = { ...word('alpha'), synonyms: ['shared'] }
    const confusable = { ...word('bravo'), synonyms: ['shared'] }
    const unrelated = word('charlie')
    const words = [answer, confusable, unrelated]
    const progress = progressWith({ alpha: TODAY, bravo: TODAY, charlie: TODAY })
    const out = pickDistractors(
      new Set(['alpha']), none, words, byId(words), progress, buildContrastPairs(words), 1, rng,
    )
    expect(out.map(w => w.id)).toEqual(['bravo'])
  })

  it('a pair that are direct dictionary synonyms of each other is not used as a distractor — it would also be correct if filled in', () => {
    // bravo lists alpha's headword in its own synonyms → a direct pair
    const answer = word('alpha')
    const same = { ...word('bravo'), synonyms: ['alpha'] }
    // charlie merely shares one synonym with alpha, it's not direct, so it should be selected
    const answerShared = { ...answer, synonyms: ['shared'] }
    const near = { ...word('charlie'), synonyms: ['shared'] }
    const words = [answerShared, same, near]
    const progress = progressWith({ alpha: TODAY, bravo: TODAY, charlie: TODAY })
    const pairs = buildContrastPairs(words)
    expect(pairs.find(p => p.a === 'alpha' && p.b === 'bravo')?.direct).toBe(true)
    const out = pickDistractors(new Set(['alpha']), none, words, byId(words), progress, pairs, 1, rng)
    expect(out.map(w => w.id)).toEqual(['charlie'])
  })

  it('falls back to learned words with the same part of speech when there are not enough confusable words', () => {
    const words = [word('alpha', 'adj.'), word('bravo', 'adj.'), word('charlie', 'n.')]
    const progress = progressWith({ alpha: TODAY, bravo: TODAY, charlie: TODAY })
    const out = pickDistractors(new Set(['alpha']), none, words, byId(words), progress, [], 1, rng)
    expect(out.map(w => w.id)).toEqual(['bravo'])
  })

  it('never selects the answer itself', () => {
    const words = [word('alpha'), word('bravo')]
    const progress = progressWith({ alpha: TODAY, bravo: TODAY })
    const out = pickDistractors(new Set(['alpha', 'bravo']), none, words, byId(words), progress, [], 2, rng)
    expect(out).toHaveLength(0)
  })

  it('unlearned words are not used as distractors', () => {
    const words = [word('alpha'), word('bravo')]
    const out = pickDistractors(new Set(['alpha']), none, words, byId(words), progressWith({ alpha: TODAY }), [], 2, rng)
    expect(out).toHaveLength(0)
  })

  it('gives fewer if it cannot fill the quota — one fewer distractor just makes the question slightly easier, but a duplicate option is a defect', () => {
    const words = [word('alpha'), word('bravo')]
    const progress = progressWith({ alpha: TODAY, bravo: TODAY })
    const out = pickDistractors(new Set(['alpha']), none, words, byId(words), progress, [], 5, rng)
    expect(out.map(w => w.id)).toEqual(['bravo'])
  })

  it('words in excludeIds are not used as distractors', () => {
    const words = [word('alpha'), word('bravo'), word('charlie')]
    const progress = progressWith({ alpha: TODAY, bravo: TODAY, charlie: TODAY })
    const out = pickDistractors(new Set(['alpha']), new Set(['bravo']), words, byId(words), progress, [], 5, rng)
    expect(out.map(w => w.id)).toEqual(['charlie'])
  })
})

describe('buildPassageQuestion', () => {
  const rng = () => 0.5
  const ids = ['a', 'b', 'c', 'd', 'e']
  const words = ids.map(i => word(i))
  const allLearned = progressWith(Object.fromEntries(ids.map(i => [i, TODAY])))
  const threeBlank = passage({ en: ['{{a}} {{b}} {{c}}'], zh: ['甲'] })

  it('candidate words = all answers + distractors', () => {
    const q = buildPassageQuestion(threeBlank, words, allLearned, TODAY, [], rng)!
    expect(q.blanks).toHaveLength(3)
    expect(q.choices).toHaveLength(3 + 2)
    expect(new Set(q.choices.map(c => c.wordId)).size).toBe(5)  // no duplicates
    for (const b of q.blanks) {
      expect(q.choices.some(c => c.wordId === b.wordId)).toBe(true)
    }
  })

  it('candidate words carry the base headword form, for the UI to display', () => {
    const q = buildPassageQuestion(threeBlank, words, allLearned, TODAY, [], rng)!
    expect(q.choices.every(c => c.headword !== '')).toBe(true)
  })

  it('returns null when fewer than 3 words can be blanked', () => {
    const p = passage({ en: ['{{a}} {{b}}'], zh: ['甲'] })
    expect(buildPassageQuestion(p, words, allLearned, TODAY, [], rng)).toBeNull()
  })

  it('returns null on parse failure, does not throw', () => {
    const p = passage({ en: ['{{a}} {{b} {{c}}'], zh: ['甲'] })
    expect(buildPassageQuestion(p, words, allLearned, TODAY, [], rng)).toBeNull()
  })

  it('words named in exclude are not used as distractors — ambiguity that cannot be computed can only be flagged by a human', () => {
    const p = passage({ en: ['{{a}} {{b}} {{c}}'], zh: ['甲'], exclude: ['d'] })
    for (let seed = 1; seed <= 50; seed++) {
      const q = buildPassageQuestion(p, words, allLearned, TODAY, [], mulberry32(seed))!
      expect(q.choices.map(c => c.wordId)).not.toContain('d')
    }
  })

  it('a word that was marked but not turned into a blank is not used as a distractor — it is printed right there in the text, so it would be ruled out at a glance', () => {
    const marked = Array.from({ length: MAX_BLANKS + 1 }, (_, i) => `m${i}`)
    const spare = ['s0', 's1', 's2']
    const all = [...marked, ...spare]
    const ws = all.map(i => word(i))
    const progress = progressWith(Object.fromEntries(all.map(i => [i, TODAY])))
    const p = passage({ en: [marked.map(i => `{{${i}}}`).join(' ')], zh: ['甲'] })

    for (let seed = 1; seed <= 50; seed++) {
      const q = buildPassageQuestion(p, ws, progress, TODAY, [], mulberry32(seed))!
      const answers = new Set(q.blanks.map(b => b.wordId))
      // each round really does leave one marked word unselected, otherwise this assertion is a no-op
      expect(answers.size).toBe(MAX_BLANKS)
      const leaked = q.choices.filter(c => !answers.has(c.wordId) && marked.includes(c.wordId))
      expect(leaked).toEqual([])
    }
  })
})

describe('pickPassage', () => {
  const rng = () => 0.5
  const ids = ['a', 'b', 'c', 'd', 'e', 'f']
  const words = ids.map(i => word(i))

  const p1 = passage({ id: 'p1', en: ['{{a}} {{b}} {{c}}'], zh: ['甲'] })
  const p2 = passage({ id: 'p2', en: ['{{d}} {{e}} {{f}}'], zh: ['乙'] })

  it('picks the passage with the most words due today', () => {
    const progress = progressWith({
      a: TODAY, b: TODAY, c: TODAY,        // p1: all three are due
      d: TODAY, e: '2099-01-01', f: '2099-01-01',  // p2: only one is due
    })
    expect(pickPassage([p1, p2], words, progress, TODAY, [], rng)?.passage.id).toBe('p1')
  })

  it('recently done passages give way — on a second attempt you remember last time\'s answers, not the words', () => {
    const progress = progressWith({
      a: TODAY, b: TODAY, c: TODAY,
      d: TODAY, e: TODAY, f: '2099-01-01',  // p2's score would normally be lower than p1's
    })
    expect(pickPassage([p1, p2], words, progress, TODAY, ['p1'], rng)?.passage.id).toBe('p2')
  })

  it('returns null when no passage can produce a question', () => {
    const progress = progressWith({ a: TODAY })  // each passage has at most one blank available
    expect(pickPassage([p1, p2], words, progress, TODAY, [], rng)).toBeNull()
  })

  it('the passage with bad data is skipped, without affecting the others', () => {
    const broken = passage({ id: 'bad', en: ['{{a} {{b}} {{c}}'], zh: ['甲'] })
    const progress = progressWith({ a: TODAY, b: TODAY, c: TODAY })
    expect(pickPassage([broken, p1], words, progress, TODAY, [], rng)?.passage.id).toBe('p1')
  })

  it('the same seed run twice gives identical results — the whole question-generation pipeline is built on reproducibility', () => {
    // use a passage with more than MAX_BLANKS words so blank selection, distractor selection,
    // and ordering all actually exercise their randomness
    const many = Array.from({ length: MAX_BLANKS + 3 }, (_, i) => `w${i}`)
    const spare = ['x0', 'x1', 'x2']
    const ws = [...many, ...spare].map(i => word(i))
    const progress = progressWith(Object.fromEntries([...many, ...spare].map(i => [i, TODAY])))
    const big = passage({ id: 'big', en: [many.map(i => `{{${i}}}`).join(' ')], zh: ['甲'] })

    expect(pickPassage([big, p1], ws, progress, TODAY, [], mulberry32(42)))
      .toEqual(pickPassage([big, p1], ws, progress, TODAY, [], mulberry32(42)))

    // a different seed really does give a different result, otherwise the assertion above is meaningless
    const a = pickPassage([big, p1], ws, progress, TODAY, [], mulberry32(42))!
    const b = pickPassage([big, p1], ws, progress, TODAY, [], mulberry32(7))!
    expect(a.choices).not.toEqual(b.choices)
  })
})

describe('scoreQuestion', () => {
  const ids = ['a', 'b', 'c']
  const words = ids.map(i => word(i))
  const p = passage({ id: 'p1', en: ['{{a}} {{b}} {{c}}'], zh: ['甲'] })
  const build = (progress: Progress) =>
    buildPassageQuestion(p, words, progress, TODAY, [], mulberry32(3))!

  const threeDue = progressWith({ a: TODAY, b: TODAY, c: TODAY })
  const twoDue = progressWith({ a: TODAY, b: TODAY, c: '2099-01-01' })

  it('due words are weighted higher than learned-but-not-due words — this is a review tool first, reading material second', () => {
    expect(scoreQuestion(build(threeDue), threeDue, TODAY, [])).toBe(DUE_WEIGHT * 3)
    expect(scoreQuestion(build(twoDue), twoDue, TODAY, [])).toBe(DUE_WEIGHT * 2 + LEARNED_WEIGHT)
    expect(DUE_WEIGHT).toBeGreaterThan(LEARNED_WEIGHT)
  })

  it('the recently-done penalty outweighs "one more due word" — better to switch to a passage with slightly worse coverage', () => {
    // one extra due word is only worth DUE_WEIGHT - LEARNED_WEIGHT points, the penalty must outweigh it
    expect(RECENT_PENALTY).toBeGreaterThan(DUE_WEIGHT - LEARNED_WEIGHT)
    const recent = scoreQuestion(build(threeDue), threeDue, TODAY, ['p1'])
    const fresh = scoreQuestion(build(twoDue), twoDue, TODAY, [])
    expect(recent).toBeLessThan(fresh)
  })

  it('no penalty when a passage is not in the recent list', () => {
    expect(scoreQuestion(build(threeDue), threeDue, TODAY, ['other']))
      .toBe(scoreQuestion(build(threeDue), threeDue, TODAY, []))
  })
})

describe('pushRecent', () => {
  it('the newest is placed first', () => {
    expect(pushRecent(['b', 'c'], 'a')).toEqual(['a', 'b', 'c'])
  })

  it('an item already in the list is moved to the front instead of leaving a duplicate', () => {
    expect(pushRecent(['b', 'a', 'c'], 'a')).toEqual(['a', 'b', 'c'])
  })

  it('the oldest entry is dropped once over the limit', () => {
    const long = Array.from({ length: RECENT_LIMIT }, (_, i) => `p${i}`)
    const out = pushRecent(long, 'new')
    expect(out).toHaveLength(RECENT_LIMIT)
    expect(out[0]).toBe('new')
    expect(out).not.toContain(`p${RECENT_LIMIT - 1}`)
  })
})
