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

/** A fixture word with full related forms, for the base-word rule. */
const wr = (id: string, meanings: [string, string][], forms: [string, string, string][]): Word => ({
  ...w(id, meanings),
  relatedForms: forms.map(([form, pos, zh]) => ({ form, pos, zh })),
})

describe('base words (spec R2)', () => {
  it('brings the base word of a member alone in its part of speech', () => {
    const words = [
      wr('diminishing', [['adj.', '递减的;逐渐减少的']], [['diminish', 'v.', '减少;削弱'], ['diminution', 'n.', '减少']]),
      w('dwindle', [['v.', '逐渐减少;日渐衰微']]),
    ]
    expect(buildSynonymGroups(words)[0].bridges).toEqual([{ for: 'diminishing', form: 'diminish', pos: 'v.', zh: '减少;削弱' }])
  })

  it('brings one base word for a pair of two lone members, not one each', () => {
    // diminishing (adj.) and dwindle (v.) are both alone in their part of
    // speech. Once diminish (v.) stands beside dwindle, dwindle has its pair,
    // so dwindling is not brought as well.
    const words = [
      wr('diminishing', [['adj.', '逐渐减少的']], [['diminish', 'v.', '减少;削弱']]),
      wr('dwindle', [['v.', '逐渐减少']], [['dwindling', 'adj.', '日渐减少的']]),
    ]
    expect(buildSynonymGroups(words)[0].bridges.map((b) => b.form)).toEqual(['diminish'])
  })

  it('marks a base word that is itself a library word', () => {
    const words = [
      wr('diminishing', [['adj.', '逐渐减少的']], [['Diminish', 'v.', '减少;削弱']]),
      w('dwindle', [['v.', '逐渐减少']]),
      w('diminish', [['v.', '减少;缩小']]),
    ]
    expect(buildSynonymGroups(words).find((g) => g.key === '逐渐减少')?.bridges)
      .toEqual([{ for: 'diminishing', form: 'Diminish', pos: 'v.', zh: '减少;削弱', wordId: 'diminish' }])
  })

  it('brings none when every part of speech is shared', () => {
    const words = [w('alleviate', [['v.', '减轻']]), w('abate', [['v.', '减轻']])]
    expect(buildSynonymGroups(words)[0].bridges).toEqual([])
  })

  it('counts every carrying meaning, so a member with a verb and a noun sense is not alone', () => {
    // grouse carries 抱怨 as a verb and as a noun, gripe only as a noun. Read by
    // first carrying meaning alone, both would look lone (v. against n.) and
    // each would bring a base word.
    const words = [
      wr('grouse', [['v.', '抱怨'], ['n.', '抱怨;牢骚']], [['grouser', 'n.', '爱抱怨的人']]),
      wr('gripe', [['n.', '抱怨']], [['griping', 'v.', '发牢骚']]),
    ]
    const g = buildSynonymGroups(words).find((x) => x.key === '抱怨')
    expect(g?.members.find((m) => m.id === 'grouse')?.carrying).toEqual([0, 1])
    expect(g?.bridges).toEqual([])
  })

  it('brings none when no related form matches, or the match is already a member', () => {
    const none = [wr('austerity', [['n.', '严峻']], [['austerely', 'adv.', '严厉地']]), w('bleak', [['adj.', '严峻的']])]
    expect(buildSynonymGroups(none)[0].bridges).toEqual([])
    const member = [
      wr('promulgation', [['n.', '颁布']], [['promulgate', 'v.', '颁布']]),
      w('promulgate', [['v.', '颁布']]),
      w('enact', [['v.', '颁布;制定']]),
    ]
    expect(buildSynonymGroups(member)[0].bridges).toEqual([])
  })
})

describe('base words: sense guards (final review of revision 2)', () => {
  it('brings none for a member that is in the group through a later meaning', () => {
    // related forms describe a word by its first sense: blunt's bluntness is
    // 直率, not anything to do with 减轻.
    // relief brings no verb of its own here, so nothing else covers blunt's
    // verb and only the later-meaning guard can stop bluntness.
    const words = [
      wr('blunt', [['adj.', '钝的'], ['v.', '减轻;削弱']], [['bluntness', 'n.', '直率;减轻锋芒']]),
      wr('relief', [['n.', '减轻;缓解']], []),
    ]
    expect(buildSynonymGroups(words)[0].bridges).toEqual([])
  })

  it('brings none for a member whose own family form is already in the group', () => {
    // timeliness already has timely beside it; reaching past it took untimely.
    const words = [
      wr('timeliness', [['n.', '适时;及时']], [['timely', 'adj.', '及时的;适时的'], ['untimely', 'adj.', '不合时宜的;适时的反面']]),
      wr('timely', [['adj.', '适时的']], [['timeliness', 'n.', '适时']]),
      w('opportune', [['adj.', '适时的;恰好的']]),
    ]
    expect(buildSynonymGroups(words).find((g) => g.key === '适时')?.bridges).toEqual([])
  })

  it('does not bring the same form twice', () => {
    const words = [
      wr('presume', [['v.', '假定']], [['presumption', 'n.', '假定;推测']]),
      wr('presumptive', [['adj.', '假定的']], [['presumption', 'n.', '假定;推测']]),
      w('supposition', [['n.', '假定']]),
    ]
    expect(buildSynonymGroups(words)[0].bridges.map((b) => b.form)).toEqual(['presumption'])
  })

  it('needs the base word to share a two-character run with the member\'s meaning', () => {
    // grief's grievous is 严重的, a different sense from 悲痛; diminish keeps
    // 减少 in common with diminishing's 逐渐减少的.
    const words = [
      wr('grief', [['n.', '悲痛;哀伤']], [['grievous', 'adj.', '严重的;剧烈的']]),
      w('mournful', [['adj.', '悲痛的']]),
    ]
    expect(buildSynonymGroups(words)[0].bridges).toEqual([])
  })
})
