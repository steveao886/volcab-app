import { describe, expect, it } from 'vitest'
import {
  buildGuessQuestion, checkGuess, classifyGuess, CLUE_PRICES, generateGuessSession,
  maskHeadword, scoreWord, WORD_START_SCORE,
} from './guess'
import { emptyProgress } from '../types'
import type { Progress, ProgressEntry, Word } from '../types'

/** Fixed date for difficultyWeight's recent-miss window. Fixtures below carry no missedAt unless a test sets one, so this only matters where one does. */
const TODAY = '2026-08-08'


const word = (over: Partial<Word> = {}): Word => ({
  id: 'abrogate',
  headword: 'abrogate',
  phonetic: '/ˈæbrəɡeɪt/',
  meanings: [{ pos: 'v.', en: 'to repeal a law', zh: '把法律、条约正式废除掉' }],
  examples: ['The council voted to abrogate the treaty.'],
  synonyms: [], antonyms: [],
  collocations: ['abrogate a treaty'],
  relatedForms: [],
  sourceNote: 'manual',
  addedAt: '2026-07-01',
  etymology: 'ab-(away) + rogare(propose) → 废除',
  ...over,
})

const kinds = (q: ReturnType<typeof buildGuessQuestion>) => q?.clues.map(c => c.kind) ?? []
const clue = (q: ReturnType<typeof buildGuessQuestion>, kind: string) => q?.clues.find(c => c.kind === kind)

describe('checkGuess', () => {
  it('accepts the word typed exactly', () => {
    expect(checkGuess('abrogate', 'abrogate')).toBe(true)
  })

  it('ignores case and surrounding whitespace', () => {
    // A phone keyboard capitalises the first letter whether or not you want
    // it to; losing a point to that would be the app's fault, not yours.
    expect(checkGuess('  Abrogate ', 'abrogate')).toBe(true)
  })

  it('accepts an inflected form — the test is whether the word is in your head', () => {
    expect(checkGuess('abrogated', 'abrogate')).toBe(true)
    expect(checkGuess('abrogating', 'abrogate')).toBe(true)
  })

  it('rejects a different word', () => {
    expect(checkGuess('alleviate', 'abrogate')).toBe(false)
  })

  it('rejects an empty answer rather than counting it as a solve', () => {
    expect(checkGuess('', 'abrogate')).toBe(false)
    expect(checkGuess('   ', 'abrogate')).toBe(false)
  })
})

describe('maskHeadword', () => {
  it('blanks the word out of a collocation', () => {
    // Measured over the library: 498 of 498 collocations contain the
    // headword. Shown raw this is not a clue, it is the answer.
    expect(maskHeadword('abrogate a treaty', 'abrogate')).toBe('____ a treaty')
  })

  it('blanks inflected forms too, not just the exact spelling', () => {
    expect(maskHeadword('The storm abated overnight.', 'abate')).toBe('The storm ____ overnight.')
  })

  it('blanks every occurrence, not only the first', () => {
    expect(maskHeadword('abate and abate again', 'abate')).toBe('____ and ____ again')
  })

  it('withholds the clue when the word cannot be located', () => {
    // Failing closed: one clue fewer beats one clue that gives the game away.
    expect(maskHeadword('a sentence about something else', 'abrogate')).toBeNull()
  })

  it('withholds on empty text rather than returning an empty clue', () => {
    expect(maskHeadword('', 'abrogate')).toBeNull()
  })
})

describe('buildGuessQuestion', () => {
  it('asks with the dominant sense and hides the word itself', () => {
    const q = buildGuessQuestion(word(), '废除的是法律、条约、制度(abrogate a treaty)。')
    expect(q?.prompt).toBe('把法律、条约正式废除掉')
    expect(q?.headword).toBe('abrogate')
    expect(JSON.stringify(q?.clues).toLowerCase()).not.toContain('abrogate')
  })

  it('offers all six clues when the word has the data for them', () => {
    const q = buildGuessQuestion(word(), '废除的是法律、条约、制度(abrogate a treaty)。')
    expect(kinds(q).sort()).toEqual(['collocation', 'etymology', 'example', 'initial', 'note', 'pos'])
  })

  it('prices them the way the measurements say', () => {
    const q = buildGuessQuestion(word(), '废除的是法律(abrogate a treaty)。')
    expect(clue(q, 'pos')?.price).toBe(CLUE_PRICES.pos)
    expect(clue(q, 'initial')?.price).toBe(CLUE_PRICES.initial)
    // 词性 partitions into 5 classes and leaves 174 of 498 candidates;
    // 首字母 leaves 38. The prices have to reflect that ordering.
    expect(CLUE_PRICES.pos).toBeLessThan(CLUE_PRICES.initial)
  })

  it('drops a clue the word has no data for', () => {
    const q = buildGuessQuestion(word({ etymology: undefined, collocations: [] }), undefined)
    expect(kinds(q).sort()).toEqual(['example', 'initial', 'pos'])
  })

  it('withholds a clue whose text cannot be masked, rather than leaking it', () => {
    const q = buildGuessQuestion(word({ examples: ['A sentence that never says it.'] }), undefined)
    expect(kinds(q)).not.toContain('example')
  })

  it('shows an etymology that never names the word, exactly as written', () => {
    // Measured: only 3 of 481 etymologies contain the headword, because they
    // mostly end on the Chinese sense. "Cannot locate" is the normal case
    // here and must not withhold the clue — the opposite of the rule for
    // examples and collocations.
    const q = buildGuessQuestion(word(), undefined)
    expect(clue(q, 'etymology')?.text).toBe('ab-(away) + rogare(propose) → 废除')
  })

  it('masks an etymology that does name the word', () => {
    const q = buildGuessQuestion(word({ etymology: 'ab- + rogare → abrogate' }), undefined)
    expect(clue(q, 'etymology')?.text).toBe('ab- + rogare → ____')
  })

  it('gives up on a word with no Chinese gloss instead of asking an empty question', () => {
    expect(buildGuessQuestion(word({ meanings: [{ pos: 'v.', en: 'x', zh: '  ' }] }), undefined)).toBeNull()
    expect(buildGuessQuestion(word({ meanings: [] }), undefined)).toBeNull()
  })

  it('orders clues cheapest first, so the shop reads as a ladder', () => {
    const q = buildGuessQuestion(word(), '废除的是法律(abrogate a treaty)。')
    const prices = q?.clues.map(c => c.price) ?? []
    expect([...prices].sort((a, b) => a - b)).toEqual(prices)
  })
})

describe('generateGuessSession', () => {
  const entry = (over: Partial<ProgressEntry> = {}): ProgressEntry => ({
    state: 'review', ease: 2.5, intervalDays: 5, due: '2026-08-01',
    stepIndex: 0, reps: 3, lapses: 0, lastReviewedAt: '2026-07-30T00:00:00Z', ...over,
  })

  const library = (n: number): Word[] =>
    Array.from({ length: n }, (_, i) => word({
      id: `w${i}`, headword: `w${i}`,
      examples: [`We saw w${i} today.`], collocations: [`w${i} thing`],
    }))

  const learned = (words: Word[], over: Partial<ProgressEntry> = {}): Progress => {
    const p = emptyProgress()
    for (const w of words) p.words[w.id] = entry(over)
    return p
  }

  it('never asks you to produce a word you have never met', () => {
    const words = library(6)
    const p = learned(words)
    p.words['w0'] = entry({ state: 'new' })
    delete p.words['w1']
    const ids = generateGuessSession(words, p, TODAY, {}, 10, () => 0.5).map(q => q.id)
    expect(ids).not.toContain('w0')
    expect(ids).not.toContain('w1')
    expect(ids).toHaveLength(4)
  })

  it('stops at the requested count even with a big library', () => {
    const words = library(50)
    expect(generateGuessSession(words, learned(words), TODAY, {}, 10, () => 0.5)).toHaveLength(10)
  })

  it('returns what it can rather than nothing when the library is thin', () => {
    const words = library(3)
    expect(generateGuessSession(words, learned(words), TODAY, {}, 10, () => 0.5)).toHaveLength(3)
  })

  it('leans toward the words that are giving trouble', () => {
    // difficultyWeight rises as ease falls; over many deterministic draws the
    // struggling word has to lead more often than an easy one.
    const words = library(2)
    const p = learned(words)
    p.words['w0'] = entry({ ease: 1.4, lapses: 4 })
    let hardFirst = 0
    for (let i = 1; i <= 200; i++) {
      const seq = [i / 201, 1 - i / 201]
      let k = 0
      const s = generateGuessSession(words, p, TODAY, {}, 1, () => seq[k++ % seq.length])
      if (s[0]?.id === 'w0') hardFirst++
    }
    expect(hardFirst).toBeGreaterThan(100)
  })

  it('skips a word that cannot carry a question instead of emitting a blank one', () => {
    const words = library(3)
    words[0].meanings = [{ pos: 'v.', en: 'x', zh: '' }]
    const ids = generateGuessSession(words, learned(words), TODAY, {}, 10, () => 0.5).map(q => q.id)
    expect(ids).not.toContain('w0')
  })

  it('hands each question its own 要点 when there is one', () => {
    const words = library(2)
    const notes = { w0: '只用于 w0 这种场合。' }
    const session = generateGuessSession(words, learned(words), TODAY, notes, 10, () => 0.5)
    expect(session.find(q => q.id === 'w0')?.clues.some(c => c.kind === 'note')).toBe(true)
    expect(session.find(q => q.id === 'w1')?.clues.some(c => c.kind === 'note')).toBe(false)
  })
})

describe('classifyGuess', () => {
  const q = (over: Partial<Word> = {}) => buildGuessQuestion(word(over), undefined)!
  const library = (...ids: string[]) => new Set(ids)

  it('calls an exact answer correct', () => {
    expect(classifyGuess('abrogate', q(), library())).toBe('correct')
    expect(classifyGuess('Abrogated ', q(), library())).toBe('correct')
  })

  it('calls a slip of the fingers near, not wrong', () => {
    expect(classifyGuess('abrogatte', q(), library())).toBe('near')   // doubled letter
    expect(classifyGuess('abrogaet', q(), library())).toBe('near')    // transposition
  })

  it('leaves a real inflection alone — that was already correct, not near', () => {
    // isInflectionOf accepts the bare stem and a plural s, so these never
    // reach the distance check at all. Worth pinning: the near-miss rule
    // must not quietly demote something the lenient matcher already passed.
    expect(classifyGuess('abrogat', q(), library())).toBe('correct')
  })

  it('scales the allowance with length — a short word has no room to be sloppy', () => {
    // 0.25 of the length, floored, minimum 1. raze(4) allows one edit;
    // circumlocution(14) allows three.
    const short = q({ id: 'raze', headword: 'raze' })
    expect(classifyGuess('rase', short, library())).toBe('near')
    expect(classifyGuess('rope', short, library())).toBe('wrong')
  })

  it('calls an unrelated word wrong', () => {
    expect(classifyGuess('elephant', q(), library())).toBe('wrong')
  })

  it('will not call another library word a typo — that is a different memory failure', () => {
    // Measured over the 498 headwords: at this threshold 21 pairs of
    // genuinely distinct words sit inside each other's allowance —
    // imperious/impetuous, contentious/conscientious, gratify/ratify,
    // disparate/disparage. Telling someone they nearly spelled it, when
    // what they actually did was recall a different word, is the one
    // wrong thing this feature could say.
    const imperious = q({ id: 'imperious', headword: 'imperious' })
    expect(classifyGuess('impetuous', imperious, library('impetuous'))).toBe('wrong')
    expect(classifyGuess('impreious', imperious, library('impetuous'))).toBe('near')
  })

  it('will not call the word\'s own synonym or antonym a typo either', () => {
    // raze's gloss literally warns "注意与 raise 反义". One edit apart, and
    // the last thing to tell someone who typed it is "close on spelling".
    const raze = q({ id: 'raze', headword: 'raze', antonyms: ['raise'], synonyms: ['ruin'] })
    expect(classifyGuess('raise', raze, library())).toBe('wrong')
    expect(classifyGuess('ruin', raze, library())).toBe('wrong')
  })

  it('treats an empty answer as wrong rather than near', () => {
    expect(classifyGuess('', q(), library())).toBe('wrong')
    expect(classifyGuess('  ', q(), library())).toBe('wrong')
  })
})

describe('scoreWord', () => {
  it('is worth full marks with no help at all', () => {
    expect(scoreWord([], 'solved')).toBe(WORD_START_SCORE)
  })

  it('subtracts what the clues cost', () => {
    expect(scoreWord(['etymology'], 'solved')).toBe(WORD_START_SCORE - CLUE_PRICES.etymology)
    expect(scoreWord(['pos', 'initial'], 'solved')).toBe(WORD_START_SCORE - CLUE_PRICES.pos - CLUE_PRICES.initial)
  })

  it('still pays 1 for solving it, however much help was bought', () => {
    // Buying everything costs 15 against a 10-point word. Solving has to stay
    // strictly better than giving up, or the shop turns into a trap.
    const all = Object.keys(CLUE_PRICES) as (keyof typeof CLUE_PRICES)[]
    expect(scoreWord(all, 'solved')).toBe(1)
  })

  it('pays nothing for revealing the answer', () => {
    expect(scoreWord([], 'revealed')).toBe(0)
    expect(scoreWord(['pos'], 'revealed')).toBe(0)
  })
})
