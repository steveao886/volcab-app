import { describe, expect, it } from 'vitest'
import type { Word } from '../types'
import { buildSynonymGroups } from './synonymGroups'

/** A fixture word: one `[pos, zh]` per meaning, in order, so the first is meanings[0]. */
const w = (id: string, meanings: [string, string][], relatedForms: string[] = []): Word => ({
  id, headword: id, phonetic: '', sourceNote: 'test', addedAt: '2026-10-23',
  meanings: meanings.map(([pos, zh]) => ({ pos, en: id, zh })),
  examples: [], synonyms: [], antonyms: [], collocations: [],
  relatedForms: relatedForms.map((form) => ({ form, pos: 'n.', zh: '' })),
})

const ids = (g: { members: { id: string }[] }) => g.members.map((m) => m.id).sort()

describe('buildSynonymGroups', () => {
  it('puts an adjective and a noun under one term once 的 is stripped', () => {
    const words = [w('uneasy', [['adj.', '不安的;忐忑的']]), w('unease', [['n.', '不安;忧虑']])]
    const groups = buildSynonymGroups(words)
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('不安')
    expect(ids(groups[0])).toEqual(['unease', 'uneasy'])
  })

  it('groups every library word that shares a term, studied or not, and needs two of them', () => {
    const words = [
      w('alleviate', [['v.', '减轻;缓解']]),
      w('abate', [['v.', '减弱;减轻']]),
      w('extenuate', [['v.', '开脱;减轻(罪责)']]),
    ]
    expect(buildSynonymGroups(words).map(ids)).toEqual([['abate', 'alleviate', 'extenuate']])
    expect(buildSynonymGroups(words.slice(0, 1))).toEqual([])
  })

  it('drops a group that is one word family, by relatedForms in either direction', () => {
    const words = [w('promulgate', [['v.', '颁布']], ['promulgation']), w('promulgation', [['n.', '颁布']])]
    expect(buildSynonymGroups(words)).toEqual([])
  })

  it('keeps a family pair inside a larger group', () => {
    const words = [
      w('promulgate', [['v.', '颁布']], ['promulgation']),
      w('promulgation', [['n.', '颁布']]),
      w('enact', [['v.', '颁布;制定']]),
    ]
    const groups = buildSynonymGroups(words)
    expect(groups.map(ids)).toEqual([['enact', 'promulgate', 'promulgation']])
  })

  it('merges groups with identical members, titled with both terms', () => {
    const words = [
      w('grouse', [['v.', '抱怨;发牢骚'], ['n.', '牢骚;怨言']]),
      w('grumble', [['v.', '抱怨'], ['n.', '牢骚']]),
    ]
    const groups = buildSynonymGroups(words)
    expect(groups).toHaveLength(1)
    expect(groups[0].terms).toEqual(['抱怨', '牢骚'])
    expect(groups[0].key).toBe('抱怨、牢骚')
  })

  it('drops a group whose members are a strict subset of another group', () => {
    const words = [
      w('antipathy', [['n.', '反感;厌恶']]),
      w('aversion', [['n.', '厌恶;反感']]),
      w('loathe', [['v.', '厌恶;憎恨']]),
    ]
    const groups = buildSynonymGroups(words)
    expect(groups.map((g) => g.key)).toEqual(['厌恶'])
    expect(ids(groups[0])).toEqual(['antipathy', 'aversion', 'loathe'])
  })

  it('gives a member every meaning that carries one of the terms', () => {
    const words = [
      w('grouse', [['v.', '抱怨;发牢骚'], ['n.', '牢骚;怨言']]),
      w('grumble', [['v.', '抱怨'], ['n.', '牢骚']]),
    ]
    const grouse = buildSynonymGroups(words)[0].members.find((m) => m.id === 'grouse')
    expect(grouse).toEqual({ id: 'grouse', carrying: [0, 1], firstMeaning: true })
  })

  it('marks a member that joins only through a later meaning, and lists it last', () => {
    const words = [
      w('blunt', [['adj.', '钝的'], ['v.', '使变钝;减轻']]),
      w('alleviate', [['v.', '减轻']]),
    ]
    const [group] = buildSynonymGroups(words)
    expect(group.members).toEqual([
      { id: 'alleviate', carrying: [0], firstMeaning: true },
      { id: 'blunt', carrying: [1], firstMeaning: false },
    ])
  })
})
