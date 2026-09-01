import { describe, expect, it } from 'vitest'
import type { Word } from '../types'
import type { WordDraft, WordIssueCode } from './wordValidate'
import { validateWordDraft } from './wordValidate'

/**
 * A complete, valid entry. Deliberately an `-ate` verb with a single sense:
 * heteronymRisk needs two parts of speech before it fires, so this base
 * carries no accidental heteronym pressure and each test below can add
 * exactly the one fault it is about.
 */
const base = (): Word => ({
  id: 'abrogate',
  headword: 'abrogate',
  phonetic: '/ˈæbrəɡeɪt/',
  meanings: [{ pos: 'v.', en: 'to repeal or formally do away with a law', zh: '废除' }],
  examples: [
    'The new CEO abrogated the remote-work policy over one Slack message.',
    'Parliament voted to abrogate the treaty three weeks before the deadline.',
  ],
  synonyms: ['abolish', 'annul'],
  antonyms: ['uphold'],
  collocations: ['abrogate a treaty'],
  relatedForms: [{ form: 'abrogation', pos: 'n.', zh: '废除' }],
  sourceNote: 'manual',
  addedAt: '2026-09-01',
  usageScore: 5,
})

const codes = (draft: WordDraft): WordIssueCode[] => validateWordDraft(draft).map(i => i.code)
/** Deliberately malformed input: the script feeds this function raw JSON, which the type cannot describe. */
const raw = (patch: Record<string, unknown>): WordDraft => ({ ...base(), ...patch } as WordDraft)

describe('a valid entry', () => {
  it('produces no issues', () => {
    expect(validateWordDraft(base())).toEqual([])
  })
  it('produces no issues without an etymology — the one field allowed to be absent', () => {
    const w = base()
    delete w.etymology
    expect(validateWordDraft(w)).toEqual([])
  })
  it('produces no issues with a valid etymology', () => {
    expect(validateWordDraft({ ...base(), etymology: 'ab-(离开) + rogare(提议) → 废除' })).toEqual([])
  })
})

describe('id', () => {
  it('id.empty when the id is missing', () => {
    expect(codes(raw({ id: undefined }))).toContain('id.empty')
  })
  it('no id.empty for a present id', () => {
    expect(codes(base())).not.toContain('id.empty')
  })
  it('id.format for uppercase', () => {
    expect(codes({ ...base(), id: 'Abrogate' })).toContain('id.format')
  })
  it('id.format for whitespace in the middle — `refute refuted` sailed through the old trim()-based check', () => {
    expect(codes({ ...base(), id: 'refute refuted' })).toContain('id.format')
  })
  it('no id.format for a hyphenated phrase id', () => {
    expect(codes({ ...base(), id: 'ad-hoc', headword: 'ad hoc' })).not.toContain('id.format')
  })
})

describe('headword', () => {
  it('headword.empty when missing', () => {
    const w = raw({ headword: undefined })
    expect(codes(w)).toContain('headword.empty')
  })
  it('headword.empty when whitespace only', () => {
    expect(codes({ ...base(), headword: '   ' })).toContain('headword.empty')
  })
  it('no headword.empty for a real headword', () => {
    expect(codes(base())).not.toContain('headword.empty')
  })
})

describe('phonetic', () => {
  it('phonetic.notSlashed when the slashes are missing', () => {
    expect(codes({ ...base(), phonetic: 'ˈæbrəɡeɪt' })).toContain('phonetic.notSlashed')
  })
  it('phonetic.notSlashed when the field is absent', () => {
    expect(codes(raw({ phonetic: undefined }))).toContain('phonetic.notSlashed')
  })
  it('no phonetic.notSlashed for a slashed phonetic', () => {
    expect(codes(base())).not.toContain('phonetic.notSlashed')
  })
})

describe('meanings', () => {
  it('meanings.empty for an empty array', () => {
    expect(codes({ ...base(), meanings: [] })).toContain('meanings.empty')
  })
  it('meanings.empty when meanings is not an array at all', () => {
    expect(codes(raw({ meanings: 'v. 废除' }))).toContain('meanings.empty')
  })
  it('no meanings.empty for one complete meaning', () => {
    expect(codes(base())).not.toContain('meanings.empty')
  })
  it('meanings.incomplete when zh is missing, and the detail names the 1-based row', () => {
    const issues = validateWordDraft({
      ...base(),
      meanings: [{ pos: 'v.', en: 'to repeal', zh: '废除' }, { pos: 'n.', en: 'a repeal', zh: '' }],
    })
    const issue = issues.find(i => i.code === 'meanings.incomplete')
    expect(issue?.detail).toBe('2')
  })
  it('meanings.incomplete for a whitespace-only pos — the script accepted it, both forms trimmed first', () => {
    expect(codes({ ...base(), meanings: [{ pos: '  ', en: 'to repeal', zh: '废除' }] })).toContain('meanings.incomplete')
  })
  it('no meanings.incomplete when every row is filled', () => {
    expect(codes(base())).not.toContain('meanings.incomplete')
  })
  it('meanings.phoneticNotSlashed for a sense phonetic without slashes', () => {
    expect(codes({ ...base(), meanings: [{ pos: 'v.', en: 'to repeal', zh: '废除', phonetic: 'æbrəɡeɪt' }] }))
      .toContain('meanings.phoneticNotSlashed')
  })
  it('no meanings.phoneticNotSlashed when the sense carries no phonetic — absence is the normal case', () => {
    expect(codes(base())).not.toContain('meanings.phoneticNotSlashed')
  })
})

describe('speakAs', () => {
  const withSense = (extra: Record<string, unknown>): WordDraft => raw({
    headword: 'presage',
    id: 'presage',
    phonetic: '/prɪˈseɪdʒ/',
    meanings: [
      { pos: 'v.', en: 'to be a sign of something to come', zh: '预示', share: 60 },
      { pos: 'n.', en: 'an omen', zh: '预兆', share: 40, phonetic: '/ˈprɛsɪdʒ/', speakAs: 'press-idge', ...extra },
    ],
  })
  it('meanings.speakAsInvalid for a blank respelling', () => {
    expect(codes(withSense({ speakAs: '   ' }))).toContain('meanings.speakAsInvalid')
  })
  it('meanings.speakAsIsIpa when the IPA was pasted in — the synthesizer would read the slashes aloud', () => {
    expect(codes(withSense({ speakAs: '/ˈprɛsɪdʒ/' }))).toContain('meanings.speakAsIsIpa')
  })
  it('meanings.speakAsWithoutPhonetic when a respelling has no pronunciation to spell', () => {
    expect(codes(raw({ meanings: [{ pos: 'v.', en: 'to repeal', zh: '废除', speakAs: 'ab-ro-gate' }] })))
      .toContain('meanings.speakAsWithoutPhonetic')
  })
  it('a well-formed respelling raises none of the three', () => {
    expect(validateWordDraft(withSense({}))).toEqual([])
  })
})

describe('heteronym', () => {
  /** `record`-shaped: on the KNOWN list, two senses, one shared phonetic. */
  const knownPair = (): WordDraft => raw({
    id: 'record',
    headword: 'record',
    phonetic: '/rɪˈkɔːrd/',
    meanings: [
      { pos: 'v.', en: 'to set down for later reference', zh: '记录', share: 60 },
      { pos: 'n.', en: 'a stored account of something', zh: '记录', share: 40 },
    ],
  })
  it('heteronym.phoneticRequired when a known heteronym has one phonetic for both senses', () => {
    const issue = validateWordDraft(knownPair()).find(i => i.code === 'heteronym.phoneticRequired')
    expect(issue?.detail).toBe('known')
  })
  it('heteronym.phoneticRequired for the -ate alternation, detected by rule rather than by list', () => {
    const issue = validateWordDraft(raw({
      id: 'advocate',
      headword: 'advocate',
      phonetic: '/ˈædvəkeɪt/',
      meanings: [
        { pos: 'v.', en: 'to publicly recommend', zh: '提倡', share: 60 },
        { pos: 'n.', en: 'someone who pleads a cause', zh: '拥护者', share: 40 },
      ],
    })).find(i => i.code === 'heteronym.phoneticRequired')
    expect(issue?.detail).toBe('ate-alternation')
  })
  it('a byte-identical copy of the word-level phonetic does not satisfy it — presage passed the old gate that way', () => {
    const w = knownPair()
    w.meanings![1]!.phonetic = '/rɪˈkɔːrd/'
    expect(codes(w)).toContain('heteronym.phoneticRequired')
  })
  it('no heteronym.phoneticRequired once a sense carries a genuinely different phonetic', () => {
    const w = knownPair()
    w.meanings![1]!.phonetic = '/ˈrekərd/'
    w.meanings![1]!.speakAs = 'REK-erd'
    expect(codes(w)).not.toContain('heteronym.phoneticRequired')
  })
  it('no heteronym.phoneticRequired for a single-sense entry, whatever the spelling', () => {
    expect(codes(raw({ id: 'record', headword: 'record', phonetic: '/rɪˈkɔːrd/' }))).not.toContain('heteronym.phoneticRequired')
  })
  it('heteronym.speakAsRequired when a divergent sense has no respelling to synthesize', () => {
    const w = knownPair()
    w.meanings![1]!.phonetic = '/ˈrekərd/'
    const issue = validateWordDraft(w).find(i => i.code === 'heteronym.speakAsRequired')
    expect(issue?.detail).toBe('n. /ˈrekərd/')
  })
  it('no heteronym.speakAsRequired once the respelling is there', () => {
    const w = knownPair()
    w.meanings![1]!.phonetic = '/ˈrekərd/'
    w.meanings![1]!.speakAs = 'REK-erd'
    expect(codes(w)).not.toContain('heteronym.speakAsRequired')
  })
})

describe('share', () => {
  it('share.invalid when a single-sense word carries a share', () => {
    expect(codes({ ...base(), meanings: [{ pos: 'v.', en: 'to repeal', zh: '废除', share: 100 }] })).toContain('share.invalid')
  })
  it('share.invalid when the shares do not sum to 100', () => {
    expect(codes({
      ...base(),
      meanings: [{ pos: 'v.', en: 'to repeal', zh: '废除', share: 60 }, { pos: 'n.', en: 'a repeal', zh: '废除', share: 30 }],
    })).toContain('share.invalid')
  })
  it('no share.invalid for a valid split', () => {
    expect(codes({
      ...base(),
      meanings: [{ pos: 'v.', en: 'to repeal', zh: '废除', share: 60 }, { pos: 'n.', en: 'a repeal', zh: '废除', share: 40 }],
    })).not.toContain('share.invalid')
  })
  it('share.unordered when a smaller share comes first', () => {
    expect(codes({
      ...base(),
      meanings: [{ pos: 'n.', en: 'a repeal', zh: '废除', share: 40 }, { pos: 'v.', en: 'to repeal', zh: '废除', share: 60 }],
    })).toContain('share.unordered')
  })
  it('no share.unordered when a 50/50 tie keeps its authored order', () => {
    expect(codes({
      ...base(),
      meanings: [{ pos: 'n.', en: 'a repeal', zh: '废除', share: 50 }, { pos: 'v.', en: 'to repeal', zh: '废除', share: 50 }],
    })).not.toContain('share.unordered')
  })
})

describe('examples', () => {
  it('examples.tooFew for one sentence, with the count in the detail', () => {
    const issue = validateWordDraft({ ...base(), examples: ['Only one sentence about abrogate here.'] })
      .find(i => i.code === 'examples.tooFew')
    expect(issue?.detail).toBe('1')
  })
  it('examples.tooFew when two of the entries are blank — the script counted array length alone', () => {
    expect(codes({ ...base(), examples: ['They voted to abrogate the treaty.', '   '] })).toContain('examples.tooFew')
  })
  it('examples.tooFew when examples is not an array', () => {
    expect(codes(raw({ examples: 'one sentence' }))).toContain('examples.tooFew')
  })
  it('no examples.tooFew for two real sentences', () => {
    expect(codes(base())).not.toContain('examples.tooFew')
  })
})

describe('synonyms / antonyms / collocations', () => {
  it('wordList.notArray names the offending list in both the field and the detail', () => {
    const issue = validateWordDraft(raw({ antonyms: 'uphold' })).find(i => i.code === 'wordList.notArray')
    expect(issue?.field).toBe('antonyms')
    expect(issue?.detail).toBe('antonyms')
  })
  it('wordList.includesHeadword for an exact self-reference', () => {
    expect(codes({ ...base(), synonyms: ['abrogate'] })).toContain('wordList.includesHeadword')
  })
  it('wordList.includesHeadword for a self-reference that differs only in case — both forms already excluded it case-insensitively', () => {
    expect(codes({ ...base(), collocations: ['Abrogate'] })).toContain('wordList.includesHeadword')
  })
  it('no wordList.includesHeadword for a genuine synonym', () => {
    expect(codes(base())).not.toContain('wordList.includesHeadword')
  })
})

describe('relatedForms', () => {
  it('relatedForms.notArray when it is not an array', () => {
    expect(codes(raw({ relatedForms: 'abrogation' }))).toContain('relatedForms.notArray')
  })
  it('relatedForms.partial when a row is half filled, with the 1-based row in the detail', () => {
    const issue = validateWordDraft({ ...base(), relatedForms: [{ form: 'abrogation', pos: '', zh: '废除' }] })
      .find(i => i.code === 'relatedForms.partial')
    expect(issue?.detail).toBe('1')
  })
  it('no relatedForms.partial for an empty list — having no related forms is normal', () => {
    expect(codes({ ...base(), relatedForms: [] })).not.toContain('relatedForms.partial')
  })
})

describe('sourceNote and addedAt', () => {
  it('sourceNote.empty when missing', () => {
    expect(codes(raw({ sourceNote: undefined }))).toContain('sourceNote.empty')
  })
  it('no sourceNote.empty for "manual"', () => {
    expect(codes(base())).not.toContain('sourceNote.empty')
  })
  it('addedAt.format for a non-ISO date', () => {
    expect(codes({ ...base(), addedAt: '2026/09/01' })).toContain('addedAt.format')
  })
  it('no addedAt.format for YYYY-MM-DD', () => {
    expect(codes(base())).not.toContain('addedAt.format')
  })
})

describe('usageScore', () => {
  it('usageScore.missing when the field is absent', () => {
    const w = base()
    delete w.usageScore
    expect(codes(w)).toContain('usageScore.missing')
  })
  it('usageScore.range for 0, with the offending value in the detail', () => {
    const issue = validateWordDraft({ ...base(), usageScore: 0 }).find(i => i.code === 'usageScore.range')
    expect(issue?.detail).toBe('0')
  })
  it('usageScore.range for a non-integer', () => {
    expect(codes({ ...base(), usageScore: 5.5 })).toContain('usageScore.range')
  })
  it('no usageScore issue for 10', () => {
    expect(codes({ ...base(), usageScore: 10 })).toEqual([])
  })
})

describe('etymology', () => {
  it('etymology.empty when the key is present but blank — the display layer would render a heading with nothing under it', () => {
    expect(codes({ ...base(), etymology: '   ' })).toContain('etymology.empty')
  })
  it('etymology.tooLong past the limit, carrying the message the field owner writes', () => {
    const issue = validateWordDraft({ ...base(), etymology: '词'.repeat(61) }).find(i => i.code === 'etymology.tooLong')
    expect(issue?.detail).toContain('61')
  })
  it('no etymology issue at exactly the limit', () => {
    expect(codes({ ...base(), etymology: '词'.repeat(60) })).toEqual([])
  })
})

describe('full-library regression', () => {
  it('every entry in data/words.json validates clean — this is the write gate\'s own invariant', async () => {
    // If this fails on a real entry, the rule that flagged it is stricter than
    // the script that let the entry in. Check the table in wordValidate.ts
    // before touching the data.
    const lib = (await import('../../data/words.json')).default
    const failures = lib.words.flatMap(w =>
      validateWordDraft(w as WordDraft).map(i => `${w.id}: ${i.code}${i.detail === undefined ? '' : ` (${i.detail})`}`),
    )
    expect(failures).toEqual([])
  })
})
