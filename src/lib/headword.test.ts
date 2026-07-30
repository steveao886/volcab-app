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
    //
    // The stem test is applied **per word**, not to the headword as one string.
    // Only the first word of a phrase inflects, so comparing whole strings
    // fails on correct spans: "bite the bullet" would demand a span starting
    // "bite the bul" and reject the perfectly good "bit the bullet". Checking
    // the head against the stem and requiring the tail verbatim is both
    // correct for phrases and strictly stronger for them — the tail has to
    // match exactly rather than merely extend a prefix.
    const lib = (await import('../../data/words.json')).default
    const approxStem = (word: string) => word.slice(0, Math.max(3, word.length - 3))
    const wrong: string[] = []
    for (const w of lib.words) {
      const parts = w.headword.trim().toLowerCase().split(/[\s-]+/)
      for (const ex of w.examples) {
        for (const seg of splitByHeadword(ex, w.headword)) {
          if (!seg.hit) continue
          const got = seg.text.toLowerCase().split(/[\s-]+/)
          const ok = got.length === parts.length
            && got[0].startsWith(approxStem(parts[0]))
            && parts.slice(1).every((p, i) => got[i + 1] === p)
          if (!ok) wrong.push(`${w.headword} → ${seg.text}`)
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

/**
 * Multi-word headwords: phrasal verbs, idioms, fixed expressions.
 *
 * The single-word rules are left alone by this branch — verified by diffing
 * every marked occurrence over the whole library before and after: 3756
 * example/collocation strings, byte-identical output. No existing headword
 * contains a space, so nothing in the library takes this path yet.
 */
describe('multi-word headwords', () => {
  const hits = (s: string, h: string) => splitByHeadword(s, h).filter(x => x.hit).map(x => x.text)

  it('matches the plain contiguous form', () => {
    expect(hits('They put off the launch until the audit cleared.', 'put off')).toEqual(['put off'])
  })

  it('inflects the first word, including the doubled consonant', () => {
    expect(hits('He puts off every hard decision until Friday.', 'put off')).toEqual(['puts off'])
    expect(hits('She keeps putting off the conversation.', 'put off')).toEqual(['putting off'])
  })

  it('handles irregular pasts, which is most of what phrasal verbs are built from', () => {
    expect(hits('It came down to one line in the contract.', 'come down to')).toEqual(['came down to'])
    expect(hits('Legal sat on the report for three weeks.', 'sit on')).toEqual(['sat on'])
    expect(hits('The board took up the motion after lunch.', 'take up')).toEqual(['took up'])
  })

  it('a hyphen counts as a separator, so "ad-hoc" matches the headword "ad hoc"', () => {
    expect(hits('The team met on an ad-hoc basis.', 'ad hoc')).toEqual(['ad-hoc'])
  })

  it('longer phrases work, and only the first word inflects', () => {
    expect(hits('They kicked the can down the road again.', 'kick the can down the road'))
      .toEqual(['kicked the can down the road'])
  })

  // The reason this branch exists at all.
  it('a separated particle is a MISS, never a partial match', () => {
    // Under the single-word loose fallback this produced the stem "put " and
    // matched "put the", yielding the cloze "He ___ meeting off twice in one
    // week" — blank in the wrong place, particle left stranded. A false hit
    // ships a broken question; a miss only drops one candidate sentence.
    expect(hits('He put the meeting off twice in one week.', 'put off')).toEqual([])
    expect(headwordPattern('He put the meeting off twice in one week.', 'put off')).toBeNull()
  })

  it('does not match across unrelated words that happen to contain the parts', () => {
    expect(hits('She put a deposit down and off she went.', 'put off')).toEqual([])
  })

  it('blanks every occurrence in the sentence, like the single-word rule', () => {
    expect(hits('They put off the review, then put off the retro too.', 'put off'))
      .toEqual(['put off', 'put off'])
  })

  it('isInflectionOf agrees with the sentence scan about what counts', () => {
    expect(isInflectionOf('putting off', 'put off')).toBe(true)
    expect(isInflectionOf('came down to', 'come down to')).toBe(true)
    expect(isInflectionOf('put the meeting off', 'put off')).toBe(false)
  })
})
