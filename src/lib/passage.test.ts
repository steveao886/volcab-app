import { describe, expect, it } from 'vitest'
import { buildPassageQuestion, MAX_BLANKS, parsePassage, parseSentence, pickDistractors, pickPassage, pushRecent, recordPlay, RECENT_LIMIT, recentWindow, selectBlanks } from './passage'
import type { PassagePlay } from './passage'
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

  it('a fully caught-up passage rotates one blank out per assembly — the identical-blanks repeat was measured on 32 of 34 passages', () => {
    // Five marked words, all learned, none due: the spec's bet that "which
    // blanks are available changes as you learn" is dead once everything is
    // learned, so without the cap this passage blanked the same five words
    // on every single repeat.
    const ids = ['a', 'b', 'c', 'd', 'e']
    const sentences = parsePassage(passage({
      en: [ids.map(i => `{{${i}}}`).join(' ')], zh: ['甲'],
    }))!
    const words = ids.map(i => word(i))
    const progress = progressWith(Object.fromEntries(ids.map(i => [i, '2099-01-01'])))

    const everLeftOut = new Set<string>()
    for (let seed = 1; seed <= 60; seed++) {
      const blanks = selectBlanks(sentences, byId(words), progress, TODAY, mulberry32(seed))
      expect(blanks).toHaveLength(4) // one below the eligible count
      const chosen = new Set(blanks.map(b => b.wordId))
      for (const id of ids) if (!chosen.has(id)) everLeftOut.add(id)
    }
    // the rotated-out slot moves — each word sits out sometimes, none always
    expect(everLeftOut.size).toBeGreaterThan(1)
  })

  it('rotation never costs a due word and never digs below the floor', () => {
    // All five due: review wins, nothing rotates out.
    const ids = ['a', 'b', 'c', 'd', 'e']
    const sentences = parsePassage(passage({
      en: [ids.map(i => `{{${i}}}`).join(' ')], zh: ['甲'],
    }))!
    const words = ids.map(i => word(i))
    const allDue = progressWith(Object.fromEntries(ids.map(i => [i, TODAY])))
    expect(selectBlanks(sentences, byId(words), allDue, TODAY, mulberry32(7))).toHaveLength(5)

    // Exactly MIN_BLANKS eligible, none due: cutting would sink the passage
    // below the mutual-clue floor, so all three stay.
    const three = ['a', 'b', 'c']
    const sentences3 = parsePassage(passage({
      en: [three.map(i => `{{${i}}}`).join(' ')], zh: ['甲'],
    }))!
    const none = progressWith(Object.fromEntries(three.map(i => [i, '2099-01-01'])))
    expect(selectBlanks(sentences3, byId(words), none, TODAY, mulberry32(7))).toHaveLength(3)
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
  const allLearned = progressWith(Object.fromEntries(ids.map(i => [i, TODAY])))

  it('picks the passage played fewest times', () => {
    expect(pickPassage([p1, p2], words, allLearned, TODAY, { p1: { n: 3, last: 3 }, p2: { n: 1, last: 0 } }, rng)?.passage.id).toBe('p2')
    expect(pickPassage([p1, p2], words, allLearned, TODAY, { p1: { n: 1, last: 0 }, p2: { n: 3, last: 3 } }, rng)?.passage.id).toBe('p1')
  })

  it('a passage the map has never heard of counts as zero, so new material goes to the front', () => {
    expect(pickPassage([p1, p2], words, allLearned, TODAY, { p1: { n: 4, last: 3 } }, rng)?.passage.id).toBe('p2')
  })

  it('due words no longer buy a passage any advantage — the play count is the whole rule', () => {
    // p1 has three words due today, p2 none. Under the old score p1 won 9 to
    // 3 and kept on winning; that spread is what starved the rest of the corpus.
    const progress = progressWith({
      a: TODAY, b: TODAY, c: TODAY,
      d: '2099-01-01', e: '2099-01-01', f: '2099-01-01',
    })
    expect(pickPassage([p1, p2], words, progress, TODAY, { p1: { n: 1, last: 0 } }, rng)?.passage.id).toBe('p2')
  })

  it('levels the counts: every passage is played once before any is played twice', () => {
    const progress = progressWith({
      a: TODAY, b: TODAY, c: TODAY,
      d: '2099-01-01', e: '2099-01-01', f: '2099-01-01',   // p2 would have scored far lower, permanently
    })
    const corpus = [p1, p2]
    const seen: string[] = []
    let plays: Record<string, PassagePlay> = {}
    for (let i = 0; i < 6; i++) {
      const id = pickPassage(corpus, words, progress, TODAY, plays, mulberry32(i))!.passage.id
      seen.push(id)
      plays = recordPlay(plays, id, corpus.map(p => p.id))
    }
    expect(seen.filter(id => id === 'p1')).toHaveLength(3)
    expect(seen.filter(id => id === 'p2')).toHaveLength(3)
    // and never the same one twice running, which is what the recency window used to buy
    expect(seen.some((id, i) => i > 0 && id === seen[i - 1])).toBe(false)
  })

  it('a passage just served waits out the cooldown even while everything is level', () => {
    // Three passages, all level at one play. p3 was served last, so it is the
    // one the cooldown holds back; with a pool of 3 the window is one serve.
    const p3 = passage({ id: 'p3', en: ['{{a}} {{d}} {{e}}'], zh: ['丙'] })
    const plays = { p1: { n: 1, last: 0 }, p2: { n: 1, last: 1 }, p3: { n: 1, last: 2 } }
    const drawn = new Set(
      Array.from({ length: 20 }, (_, i) =>
        pickPassage([p1, p2, p3], words, allLearned, TODAY, plays, mulberry32(i))!.passage.id),
    )
    expect(drawn.has('p3')).toBe(false)
    expect(drawn).toEqual(new Set(['p1', 'p2']))
  })

  it('the cooldown gives way rather than returning nothing when it would empty the tie', () => {
    // One passage left at the low count and it is also the most recent. The
    // count guarantee outranks the cooldown, so it is served anyway.
    const plays = { p1: { n: 2, last: 0 }, p2: { n: 1, last: 1 } }
    expect(pickPassage([p1, p2], words, allLearned, TODAY, plays, rng)?.passage.id).toBe('p2')
  })

  it('sets aside a passage more than a third of whose marked words are unlearned', () => {
    // wide marks five words, two of them unlearned — two fifths, over the
    // line. It is still buildable (three learned marks clear MIN_BLANKS), so
    // the gate is the only thing keeping it out, and p1 wins despite having
    // been played five more times.
    const wide = passage({ id: 'wide', en: ['{{a}} {{b}} {{c}} {{e}} {{f}}'], zh: ['甲'] })
    const progress = progressWith({ a: TODAY, b: TODAY, c: TODAY })
    expect(pickPassage([p1, wide], words, progress, TODAY, { p1: { n: 5, last: 4 } }, rng)?.passage.id).toBe('p1')
  })

  it('a third exactly is still allowed — the bar is what it says it is', () => {
    // narrow marks six, two unlearned — exactly a third, which is allowed.
    // p1 has been played five more times, so if narrow were eligible it wins.
    const narrow = passage({ id: 'narrow', en: ['{{a}} {{b}} {{c}} {{d}} {{e}} {{f}}'], zh: ['甲'] })
    const progress = progressWith({ a: TODAY, b: TODAY, c: TODAY, d: TODAY })
    expect(pickPassage([p1, narrow], words, progress, TODAY, { p1: { n: 5, last: 4 } }, rng)?.passage.id).toBe('narrow')
  })

  it('serves an over-the-line passage anyway rather than showing nothing', () => {
    // The only buildable passage is thick with unlearned words; empty is worse.
    const wide = passage({ id: 'wide', en: ['{{a}} {{b}} {{c}} {{e}} {{f}}'], zh: ['甲'] })
    const progress = progressWith({ a: TODAY, b: TODAY, c: TODAY })
    expect(pickPassage([wide], words, progress, TODAY, {}, rng)?.passage.id).toBe('wide')
  })

  it('returns null when no passage can produce a question', () => {
    const progress = progressWith({ a: TODAY })  // each passage has at most one blank available
    expect(pickPassage([p1, p2], words, progress, TODAY, {}, rng)).toBeNull()
  })

  it('the passage with bad data is skipped, without affecting the others', () => {
    const broken = passage({ id: 'bad', en: ['{{a} {{b}} {{c}}'], zh: ['甲'] })
    const progress = progressWith({ a: TODAY, b: TODAY, c: TODAY })
    expect(pickPassage([broken, p1], words, progress, TODAY, {}, rng)?.passage.id).toBe('p1')
  })

  it('the same seed run twice gives identical results — the whole question-generation pipeline is built on reproducibility', () => {
    // use a passage with more than MAX_BLANKS words so blank selection, distractor selection,
    // and ordering all actually exercise their randomness
    const many = Array.from({ length: MAX_BLANKS + 3 }, (_, i) => `w${i}`)
    const spare = ['x0', 'x1', 'x2']
    const ws = [...many, ...spare].map(i => word(i))
    const progress = progressWith(Object.fromEntries([...many, ...spare].map(i => [i, TODAY])))
    const big = passage({ id: 'big', en: [many.map(i => `{{${i}}}`).join(' ')], zh: ['甲'] })

    expect(pickPassage([big], ws, progress, TODAY, {}, mulberry32(42)))
      .toEqual(pickPassage([big], ws, progress, TODAY, {}, mulberry32(42)))

    // a different seed really does give a different result, otherwise the assertion above is meaningless
    const a = pickPassage([big], ws, progress, TODAY, {}, mulberry32(42))!
    const b = pickPassage([big], ws, progress, TODAY, {}, mulberry32(7))!
    expect(a.choices).not.toEqual(b.choices)
  })
})

describe('recordPlay', () => {
  it('counts a serve and stamps it with the next ordinal', () => {
    expect(recordPlay({}, 'p1', ['p1', 'p2'])).toEqual({ p1: { n: 1, last: 0 } })
    expect(recordPlay({ p1: { n: 2, last: 5 } }, 'p1', ['p1'])).toEqual({ p1: { n: 3, last: 6 } })
  })

  it('the ordinal counts serves across the whole corpus, not per passage', () => {
    const out = recordPlay({ p1: { n: 1, last: 0 }, p2: { n: 1, last: 1 } }, 'p1', ['p1', 'p2'])
    expect(out.p1).toEqual({ n: 2, last: 2 })
  })

  it('drops ids the corpus no longer holds, so a retired passage stops occupying the map', () => {
    expect(recordPlay({ old: { n: 9, last: 9 }, p1: { n: 1, last: 0 } }, 'p1', ['p1', 'p2']))
      .toEqual({ p1: { n: 2, last: 1 } })
  })

  it('ignores a serve for an id outside the corpus rather than inventing an entry', () => {
    expect(recordPlay({ p1: { n: 1, last: 0 } }, 'ghost', ['p1'])).toEqual({ p1: { n: 1, last: 0 } })
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

describe('recentWindow', () => {
  it('scales with the corpus instead of being a fixed count', () => {
    // A fixed window fails once the corpus holds more high scorers than the
    // window has slots. With 26 passages and 11 that scored far above the
    // rest, a window of 10 left exactly one high scorer free every time, so
    // those eleven cycled forever.
    expect(recentWindow(26)).toBe(17)
    expect(recentWindow(60)).toBe(40)
  })

  it('always leaves at least one passage eligible', () => {
    for (const n of [1, 2, 3, 4, 5, 10]) {
      expect(recentWindow(n)).toBeLessThanOrEqual(n - 1)
    }
  })

  it('an empty corpus does not produce a negative window', () => {
    expect(recentWindow(0)).toBe(0)
  })
})
