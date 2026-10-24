import { describe, expect, it } from 'vitest'
import type { Word } from '../types'
import type { SynonymNotesFile } from './synonymContent'
import type { SynonymGroup } from './synonymGroups'
import { maxSynonymNote, synonymCoverageErrors, synonymNoteErrors } from './synonymNotesValidate'

const w = (id: string, zh: string[], headword = id): Word => ({
  id, headword, phonetic: '', sourceNote: 'test', addedAt: '2026-10-23',
  meanings: zh.map((z) => ({ pos: 'v.', en: id, zh: z })),
  examples: [], synonyms: [], antonyms: [], collocations: [], relatedForms: [],
})
const lib = new Map([
  w('averse', ['反感的,厌恶的']),
  w('aversion', ['厌恶,反感']),
  w('loathe', ['憎恨;厌恶']),
  w('put-off', ['反感;推迟'], 'put off'),
].map((x) => [x.id, x]))

const ok = { members: ['averse', 'aversion', 'loathe'], text: 'averse 最轻;aversion 想躲开;loathes 最重。' }

describe('synonymNoteErrors', () => {
  it('accepts a note that names every member under a term they all carry', () => {
    expect(synonymNoteErrors('厌恶', ok, lib)).toEqual([])
  })

  it("rejects a key that is not one of a member's gloss terms", () => {
    const errs = synonymNoteErrors('反感', ok, lib)
    expect(errs).toHaveLength(1)
    expect(errs[0]).toContain('loathe')
  })

  it('rejects fewer than two members, an unknown id and a repeat', () => {
    expect(synonymNoteErrors('厌恶', { members: ['averse'], text: 'averse' }, lib).join()).toContain('2')
    expect(synonymNoteErrors('厌恶', { members: ['averse', 'ghost'], text: 'averse ghost' }, lib).join()).toContain('ghost')
    expect(synonymNoteErrors('厌恶', { members: ['averse', 'averse'], text: 'averse' }, lib).join()).toContain('averse')
  })

  it('rejects text over the cap, and empty text', () => {
    expect(synonymNoteErrors('厌恶', { ...ok, text: ok.text + '长'.repeat(maxSynonymNote(3)) }, lib)).toHaveLength(1)
    expect(synonymNoteErrors('厌恶', { ...ok, text: '' }, lib).length).toBeGreaterThan(0)
  })

  it('caps by group size, so a pair cannot run as long as a larger group', () => {
    const pad = (s: string, n: number) => s + '长'.repeat(n - s.length)
    const pair = { members: ['averse', 'aversion'], text: pad('averse 最轻;aversion 想躲开。', maxSynonymNote(2) + 1) }
    expect(synonymNoteErrors('厌恶', pair, lib)).toHaveLength(1)
    expect(synonymNoteErrors('厌恶', { ...ok, text: pad(ok.text, maxSynonymNote(2) + 1) }, lib)).toEqual([])
  })

  it('requires each headword as a word or an inflection, not a substring', () => {
    const bog = new Map([w('mire', ['泥潭;困境']), w('quagmire', ['泥潭;困境'])].map((x) => [x.id, x]))
    // "mire" sits inside "admire" and "quagmire" but is not named as a word.
    const errs = synonymNoteErrors('泥潭', { members: ['mire', 'quagmire'], text: 'quagmire 更深;人人 admire 它。' }, bog)
    expect(errs).toHaveLength(1)
    expect(errs[0]).toContain('names mire')
    expect(synonymNoteErrors('泥潭', { members: ['mire', 'quagmire'], text: 'mired 是陷住;quagmire 更深。' }, bog)).toEqual([])
  })

  it('does not let one member of a word family stand in for another', () => {
    // isInflectionOf accepts some derivations both ways (unease / uneasy), so
    // a token that is exactly one member's headword counts for that member
    // alone. 22 of 519 groups hold such a pair, every word counted studied.
    const fam = new Map([w('unease', ['不安;忧虑']), w('uneasy', ['不安的;忐忑的'])].map((x) => [x.id, x]))
    const errs = synonymNoteErrors('不安', { members: ['unease', 'uneasy'], text: 'uneasy 说人心里不踏实。' }, fam)
    expect(errs).toHaveLength(1)
    expect(errs[0]).toContain('names unease')
    expect(synonymNoteErrors('不安', { members: ['unease', 'uneasy'], text: 'unease 是名词;uneasy 是形容词。' }, fam)).toEqual([])
  })

  it('matches a multi-word headword as a phrase', () => {
    expect(synonymNoteErrors('反感', { members: ['averse', 'put-off'], text: 'averse 较轻;put off 是被劝退。' }, lib)).toEqual([])
  })

  it('rejects an entry of the wrong shape without throwing', () => {
    expect(() => synonymNoteErrors('厌恶', null, lib)).not.toThrow()
    expect(synonymNoteErrors('厌恶', null, lib)).toHaveLength(1)
    expect(synonymNoteErrors('厌恶', { members: 'averse', text: 5 }, lib)).toHaveLength(1)
  })
})

describe('synonymCoverageErrors (spec R4)', () => {
  const words = [
    w('diminishing', ['逐渐减少的']),
    w('dwindle', ['逐渐减少']),
    w('alleviate', ['减轻']),
    w('abate', ['减轻']),
  ]
  const byId = new Map(words.map((x) => [x.id, x]))
  const dwindleGroup: SynonymGroup = {
    key: '逐渐减少', terms: ['逐渐减少'],
    members: [{ id: 'diminishing', carrying: [0], firstMeaning: true }, { id: 'dwindle', carrying: [0], firstMeaning: true }],
    bridges: [{ for: 'diminishing', form: 'diminish', pos: 'v.', zh: '减少' }],
  }
  const easeGroup: SynonymGroup = {
    key: '减轻', terms: ['减轻'], bridges: [],
    members: [{ id: 'abate', carrying: [0], firstMeaning: true }, { id: 'alleviate', carrying: [0], firstMeaning: true }],
  }
  const file = (notes: SynonymNotesFile['notes']): SynonymNotesFile => ({ version: 1, notes })
  const good = {
    逐渐减少: { members: ['diminishing', 'dwindle'], text: 'diminish 和 dwindle 都是动词;diminishing 是形容词。' },
    减轻: { members: ['alleviate', 'abate'], text: 'alleviate 主动缓解;abate 自己减弱。' },
  }

  it('passes when every group has a current paragraph that names its base words', () => {
    expect(synonymCoverageErrors([dwindleGroup, easeGroup], file(good), byId)).toEqual([])
  })

  it('reports a group with no current paragraph', () => {
    const errs = synonymCoverageErrors([dwindleGroup, easeGroup], file({ 逐渐减少: good.逐渐减少 }), byId)
    expect(errs).toHaveLength(1)
    expect(errs[0]).toContain('减轻')
    expect(errs[0]).toContain('abate, alleviate')
  })

  it('reports a paragraph that is current for no group', () => {
    const stale = { ...good, 减轻: { members: ['alleviate', 'abate', 'extenuate'], text: 'alleviate abate extenuate' } }
    const errs = synonymCoverageErrors([dwindleGroup, easeGroup], file(stale), byId)
    expect(errs.some((e) => e.includes('no current paragraph') && e.includes('减轻'))).toBe(true)
    expect(errs.some((e) => e.includes('current for no group') && e.includes('减轻'))).toBe(true)
  })

  it('does not let a base word stand in for the member it hangs under', () => {
    // isInflectionOf counts uneasy for unease, and only this check knows that
    // uneasy is the base word here, not a mention of the member.
    const lib2 = new Map([w('unease', ['不安']), w('anxious', ['不安的'])].map((x) => [x.id, x]))
    const group: SynonymGroup = {
      key: '不安', terms: ['不安'],
      members: [{ id: 'anxious', carrying: [0], firstMeaning: true }, { id: 'unease', carrying: [0], firstMeaning: true }],
      bridges: [{ for: 'unease', form: 'uneasy', pos: 'adj.', zh: '不安的' }],
    }
    const errs = synonymCoverageErrors([group], file({ 不安: { members: ['anxious', 'unease'], text: 'uneasy 是形容词;anxious 更焦虑。' } }), lib2)
    expect(errs).toHaveLength(1)
    expect(errs[0]).toContain('names unease')
  })

  it('requires the paragraph to name each base word, and the member it derives from does not count', () => {
    const unnamed = { ...good, 逐渐减少: { members: ['diminishing', 'dwindle'], text: 'diminishing 是形容词;dwindle 是动词。' } }
    const errs = synonymCoverageErrors([dwindleGroup, easeGroup], file(unnamed), byId)
    expect(errs).toHaveLength(1)
    expect(errs[0]).toContain('diminish')
  })
})
