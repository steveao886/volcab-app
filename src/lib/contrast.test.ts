import { describe, expect, it } from 'vitest'
import { buildContrastPairs } from './contrast'
import type { Word } from '../types'

/**
 * Pairing only looks at synonyms — **never at antonyms** — that's a design premise, not laziness.
 * If one word lists X as a synonym and another lists X as an antonym, the two words are opposites,
 * not easily confused.
 */
const w = (
  id: string,
  synonyms: string[],
  pos = 'adj.',
): Word => ({
  id, headword: id, phonetic: `/${id}/`,
  meanings: [{ pos, en: `def of ${id}`, zh: `${id}义` }],
  examples: [`We saw something ${id} today.`, `It felt ${id} again.`],
  synonyms, antonyms: [`${id}-ant`], collocations: [`${id} thing`],
  relatedForms: [], sourceNote: 't', addedAt: '2026-07-01',
})

const find = (pairs: ReturnType<typeof buildContrastPairs>, x: string, y: string) => {
  const [a, b] = x < y ? [x, y] : [y, x]
  return pairs.find(p => p.a === a && p.b === b)
}

describe('buildContrastPairs', () => {
  it('sharing one synonym forms a pair', () => {
    const pairs = buildContrastPairs([w('alpha', ['shared']), w('bravo', ['shared'])])
    expect(pairs).toHaveLength(1)
    expect(find(pairs, 'alpha', 'bravo')?.shared).toEqual(['shared'])
  })

  it('no overlap means no pair', () => {
    expect(buildContrastPairs([w('alpha', ['x']), w('bravo', ['y'])])).toEqual([])
  })

  it('a pair is normalized to lexical order internally, so the same pair never appears twice', () => {
    const pairs = buildContrastPairs([w('zulu', ['shared']), w('alpha', ['shared'])])
    expect(pairs).toHaveLength(1)
    expect(pairs[0].a).toBe('alpha')
    expect(pairs[0].b).toBe('zulu')
  })

  it('one side listing the other\'s headword as a synonym → direct, with no shared synonym required', () => {
    const pairs = buildContrastPairs([w('alpha', ['bravo']), w('bravo', ['nothing-in-common'])])
    const p = find(pairs, 'alpha', 'bravo')
    expect(p?.direct).toBe(true)
    expect(p?.shared).toEqual([])
  })

  it('case and leading/trailing whitespace do not affect matching', () => {
    const pairs = buildContrastPairs([w('alpha', ['  Shared  ']), w('bravo', ['SHARED'])])
    expect(find(pairs, 'alpha', 'bravo')?.shared).toEqual(['shared'])
  })

  it('scoring: shared count + 2 points for being direct synonyms + 1 point for matching part of speech', () => {
    // 2 shared + both adj. = 3
    const twoShared = buildContrastPairs([w('alpha', ['s1', 's2']), w('bravo', ['s1', 's2'])])
    expect(find(twoShared, 'alpha', 'bravo')?.score).toBe(3)

    // 1 shared + different part of speech = 1
    const diffPos = buildContrastPairs([w('alpha', ['s1'], 'adj.'), w('bravo', ['s1'], 'v.')])
    expect(find(diffPos, 'alpha', 'bravo')?.score).toBe(1)

    // direct synonyms (0 shared) + same part of speech = 3
    const direct = buildContrastPairs([w('alpha', ['bravo']), w('bravo', ['zzz'])])
    expect(find(direct, 'alpha', 'bravo')?.score).toBe(3)
  })

  it('the same synonym repeated within one word only counts once', () => {
    const pairs = buildContrastPairs([w('alpha', ['dup', 'DUP', ' dup ']), w('bravo', ['dup'])])
    expect(find(pairs, 'alpha', 'bravo')?.shared).toEqual(['dup'])
    expect(find(pairs, 'alpha', 'bravo')?.score).toBe(2) // 1 shared + same part of speech
  })

  it('empty-string synonyms take no part in pairing — otherwise every word with a blank entry would pair with every other', () => {
    const pairs = buildContrastPairs([w('alpha', ['', '  ']), w('bravo', ['', ''])])
    expect(pairs).toEqual([])
  })

  it('three words sharing the same synonym → three pairwise combinations', () => {
    const pairs = buildContrastPairs([w('alpha', ['s']), w('bravo', ['s']), w('carol', ['s'])])
    expect(pairs).toHaveLength(3)
  })

  it('sorted by score descending', () => {
    const pairs = buildContrastPairs([
      w('alpha', ['weak']),
      w('bravo', ['weak']),
      w('carol', ['s1', 's2', 's3']),
      w('delta', ['s1', 's2', 's3']),
    ])
    expect(pairs[0].a).toBe('carol') // 3 shared + same part of speech = 4, ranks first
    expect(pairs[0].score).toBeGreaterThan(pairs[1].score)
  })

  it('tied-score order does not depend on the word-list order — the question candidate pool must be reproducible', () => {
    // This has to be verified by changing the **input order**, not by running the same input
    // twice: Map iteration order follows insertion order, so running the same input twice would
    // trivially match — that assertion would be a no-op (mutation testing caught this once).
    const mk = () => [
      w('delta', ['tie']),
      w('carol', ['tie']),
      w('bravo', ['tie']),
      w('alpha', ['tie']),
    ]
    const forward = buildContrastPairs(mk())
    const reversed = buildContrastPairs([...mk()].reverse())
    expect(reversed).toEqual(forward)
    // all six pairs tie on score, so order can only be decided by id lexical order
    expect(forward.map(p => `${p.a}|${p.b}`)).toEqual([
      'alpha|bravo', 'alpha|carol', 'alpha|delta',
      'bravo|carol', 'bravo|delta', 'carol|delta',
    ])
  })

  it('does not pair on antonyms — a shared antonym is an opposing relationship, not a confusable one', () => {
    const a = { ...w('alpha', []), antonyms: ['shared'] }
    const b = { ...w('bravo', []), antonyms: ['shared'] }
    expect(buildContrastPairs([a, b])).toEqual([])
  })

  it('an entry that lists its own headword in synonyms does not pair with itself', () => {
    // The validation script already forbids this, but the reader shouldn't produce a
    // self-paired a===b question just because of one bad record
    const self = w('alpha', ['alpha'])
    expect(buildContrastPairs([self]).every(p => p.a !== p.b)).toBe(true)
  })
})

describe('buildContrastPairs at realistic scale', () => {
  // The inverted-index result must match the naive double loop — indexing is a performance
  // optimization, it shouldn't change semantics.
  it('is equivalent to a naive double loop', () => {
    const words = Array.from({ length: 40 }, (_, i) =>
      w(`w${String(i).padStart(2, '0')}`, [`s${i % 7}`, `s${i % 5}`], i % 2 ? 'adj.' : 'v.'),
    )
    const pairs = buildContrastPairs(words)

    const norm = (s: string) => s.trim().toLowerCase()
    const naive = new Set<string>()
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 1; j < words.length; j++) {
        const A = new Set(words[i].synonyms.map(norm))
        const B = new Set(words[j].synonyms.map(norm))
        const overlap = [...A].some(x => x !== '' && B.has(x))
        const direct = A.has(norm(words[j].headword)) || B.has(norm(words[i].headword))
        if (overlap || direct) naive.add(`${words[i].id}|${words[j].id}`)
      }
    }
    expect(new Set(pairs.map(p => `${p.a}|${p.b}`))).toEqual(naive)
  })
})
