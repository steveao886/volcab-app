import { describe, expect, it } from 'vitest'
import { headwordPattern, isInflectionOf, splitByHeadword } from './headword'

const hits = (s: string, h: string) => splitByHeadword(s, h).filter(x => x.hit).map(x => x.text)
const rebuild = (s: string, h: string) => splitByHeadword(s, h).map(x => x.text).join('')

describe('headwordPattern', () => {
  it('matches the whole word', () => {
    expect(headwordPattern('We concoct things.', 'concoct')).not.toBeNull()
  })
  it('is case-insensitive', () => {
    expect(headwordPattern('Concoct it.', 'concoct')).not.toBeNull()
  })
  it('matches an inflected form', () => {
    expect(headwordPattern('She concocted an excuse.', 'concoct')).not.toBeNull()
  })
  it('returns null when it cannot be located', () => {
    expect(headwordPattern('Nothing here.', 'concoct')).toBeNull()
  })
  it('when the base form is present, only real inflectional endings count: mire does not match mirth', () => {
    expect(hits('The mire of mirth and debt.', 'mire')).toEqual(['mire'])
  })
  it('when the base form is present, it does not match a longer cognate word: officiate does not swallow officials', () => {
    expect(hits('Three officials officiate every match.', 'officiate')).toEqual(['officiate'])
  })
  it('when the base form is present, it does not match a longer cognate word: dystrophy does not swallow dystrophin', () => {
    expect(hits('muscular dystrophy weakens dystrophin', 'dystrophy')).toEqual(['dystrophy'])
  })
  it('only falls back to a loose stem when the base form is absent — covers the 14% of examples that only contain an inflected form', () => {
    expect(hits('She concocted an excuse.', 'concoct')).toEqual(['concocted'])
  })
  it("the returned regex's lastIndex is reset to zero — test() with the g flag advances it, and not resetting it would miss the first match", () => {
    const re = headwordPattern('We concoct and concoct.', 'concoct')!
    expect(re.lastIndex).toBe(0)
    expect([...'We concoct and concoct.'.matchAll(re)]).toHaveLength(2)
  })
  it('returns null for an empty headword, instead of producing a regex that matches everything', () => {
    expect(headwordPattern('anything', '   ')).toBeNull()
  })
})

describe('splitByHeadword', () => {
  it('splits out the matched segment', () => {
    expect(hits('She concocted an excuse.', 'concoct')).toEqual(['concocted'])
  })
  it('matches both the base form and an inflected form in the same sentence — a blank that only targets the base form would leave the answer sitting in the sentence', () => {
    // real example sentence (placate): "to placate passengers…, which placated almost no one"
    expect(hits('to placate passengers, which placated almost no one', 'placate'))
      .toEqual(['placate', 'placated'])
  })
  it('matches every occurrence of the same form', () => {
    expect(hits('We concoct and we concoct.', 'concoct')).toEqual(['concoct', 'concoct'])
  })
  it('preserves the original casing, does not rewrite to match the headword', () => {
    expect(hits('Concoct it.', 'concoct')).toEqual(['Concoct'])
  })
  it('joining the segments back together must reproduce the original sentence exactly', () => {
    for (const s of ['She concocted an excuse.', 'We concoct and they concocted.', 'Nothing here.', 'concoct']) {
      expect(rebuild(s, 'concoct')).toBe(s)
    }
  })
  it('when it cannot be located, the whole sentence is one segment, and the example still displays normally', () => {
    expect(splitByHeadword('Nothing here.', 'concoct')).toEqual([{ text: 'Nothing here.', hit: false }])
  })
  it('no empty leading segment when the match is at the start of the sentence', () => {
    expect(splitByHeadword('Concoct it.', 'concoct')[0]).toEqual({ text: 'Concoct', hit: true })
  })
  it('no empty trailing segment when the match is at the end of the sentence', () => {
    const segs = splitByHeadword('They concoct', 'concoct')
    expect(segs[segs.length - 1]).toEqual({ text: 'concoct', hit: true })
  })
  it('headwords containing regex metacharacters do not blow up', () => {
    expect(() => splitByHeadword('cost (a lot) here', 'cost (a')).not.toThrow()
    expect(() => splitByHeadword('a.b.c', 'a.b')).not.toThrow()
  })
  it('phrase entries containing spaces (ad hoc / due diligence) are matched normally', () => {
    expect(hits('An ad hoc fix shipped Friday.', 'ad hoc')).toEqual(['ad hoc'])
  })
})

describe('full-library regression', () => {
  it('every word has at least one example sentence where it can be located — this assertion is the whole reason this algorithm exists', async () => {
    const lib = (await import('../../data/words.json')).default
    const missed = lib.words.filter(w => w.examples.every(ex => headwordPattern(ex, w.headword) === null))
    expect(missed.map(w => w.headword)).toEqual([])
  })

  it('no word is mismarked across the full library — every marked span must start with an approximate stem of the headword', async () => {
    // The loose-stem fallback path can match unrelated words like indict→industry or allude→all.
    // In practice this has never triggered on the current word list (the base form is always
    // present), but a new word could hit it at any time — so pin down "no false positives" as a
    // full-library assertion instead of relying on a one-off manual check.
    const lib = (await import('../../data/words.json')).default
    const wrong: string[] = []
    for (const w of lib.words) {
      const h = w.headword.trim().toLowerCase()
      const prefix = h.slice(0, Math.max(3, h.length - 3))
      for (const ex of w.examples) {
        for (const seg of splitByHeadword(ex, w.headword)) {
          if (seg.hit && !seg.text.toLowerCase().startsWith(prefix)) {
            wrong.push(`${w.headword} → ${seg.text}`)
          }
        }
      }
    }
    expect(wrong).toEqual([])
  })
})

describe('isInflectionOf', () => {
  it('the base form itself counts', () => {
    expect(isInflectionOf('refute', 'refute')).toBe(true)
  })

  it('common inflected forms count', () => {
    expect(isInflectionOf('refuted', 'refute')).toBe(true)
    expect(isInflectionOf('ratified', 'ratify')).toBe(true)
    expect(isInflectionOf('inundated', 'inundate')).toBe(true)
    expect(isInflectionOf('thwarting', 'thwart')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isInflectionOf('Refuted', 'refute')).toBe(true)
  })

  /**
   * This case is the entire reason this function exists. headwordPattern falls back to a loose
   * stem `stem + [a-z]*` when the base form is absent, and using that for validation would judge
   * reference to be an inflected form of refute — that loose rule is a necessary fallback when
   * locating a whole sentence, but a loophole when validating a single word.
   */
  it('similar-looking but unrelated words do not count', () => {
    expect(isInflectionOf('reference', 'refute')).toBe(false)
    expect(isInflectionOf('mirth', 'mire')).toBe(false)
    expect(isInflectionOf('officials', 'officiate')).toBe(false)
  })

  it('extra prefixes or suffixes do not count', () => {
    expect(isInflectionOf('unrefuted', 'refute')).toBe(false)
    expect(isInflectionOf('refutation', 'refute')).toBe(false)
  })

  it("similar-looking but unrelated words do not count (the ones headwordPattern's loose fallback would hit — validation must still block them)", () => {
    expect(isInflectionOf('president', 'preside')).toBe(false)
    expect(isInflectionOf('sapiens', 'sapient')).toBe(false)
  })

  it('empty strings do not count', () => {
    expect(isInflectionOf('', 'refute')).toBe(false)
    expect(isInflectionOf('refute', '')).toBe(false)
  })

  /**
   * The following are real misses found during full-library regression testing (see the measured
   * data in the comment above isInflectionOf). Named after real words, not invented edge cases.
   */
  it('doubled final consonant: real example-sentence inflections of manumit/concur/extol', () => {
    // all 5 example sentences for manumit use manumitted, the base form never appears — before
    // the fix, this word could not be located at all
    expect(isInflectionOf('manumitted', 'manumit')).toBe(true)
    expect(isInflectionOf('concurred', 'concur')).toBe(true)
    expect(isInflectionOf('extolled', 'extol')).toBe(true)
    expect(isInflectionOf('extolling', 'extol')).toBe(true)
  })

  it('headword unchanged, -ly appended directly: real example-sentence inflections of profuse/unobtrusive', () => {
    expect(isInflectionOf('profusely', 'profuse')).toBe(true)
    expect(isInflectionOf('unobtrusively', 'unobtrusive')).toBe(true)
  })

  it('headword ending in vowel + y — the y should not be stripped: inflected forms of convey', () => {
    expect(isInflectionOf('conveyed', 'convey')).toBe(true)
    expect(isInflectionOf('conveys', 'convey')).toBe(true)
  })
})
