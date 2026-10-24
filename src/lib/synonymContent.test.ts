import { describe, expect, it } from 'vitest'
import type { Word } from '../types'
import type { ContrastNotesFile } from './contrastNotes'
import type { SynonymGroup } from './synonymGroups'
import type { WordNotesFile } from './wordNotes'
import { currentNote, groupView } from './synonymContent'
import type { SynonymNotesFile } from './synonymContent'

/** A fixture word: one `[pos, zh]` per meaning, plus its collocations. */
const w = (id: string, meanings: [string, string][], collocations: string[] = []): Word => ({
  id, headword: id, phonetic: '', sourceNote: 'test', addedAt: '2026-10-23',
  meanings: meanings.map(([pos, zh]) => ({ pos, en: id, zh })),
  examples: [], synonyms: [], antonyms: [], collocations, relatedForms: [],
})
const byId = (...ws: Word[]) => new Map(ws.map((x) => [x.id, x]))
const member = (id: string, carrying = [0]) => ({ id, carrying, firstMeaning: carrying.includes(0) })

const contrast = (notes: Record<string, string> = {}): ContrastNotesFile => ({ version: 1, notes })
const wordNotes = (notes: Record<string, string> = {}): WordNotesFile => ({ version: 1, notes })
const synNotes = (notes: SynonymNotesFile['notes'] = {}): SynonymNotesFile => ({ version: 1, notes })

const dislike = byId(
  w('antipathy', [['n.', '反感,厌恶']], ['deep antipathy']),
  w('aversion', [['n.', '厌恶,反感']], ['have an aversion to']),
  w('averse', [['adj.', '反感的,厌恶的']], ['averse to risk']),
)
const dislikeGroup: SynonymGroup = {
  key: '厌恶、反感', terms: ['厌恶', '反感'], bridges: [],
  members: [member('antipathy'), member('averse'), member('aversion')],
}

describe('groupView', () => {
  it("gives the paragraph when a note under any of the group's terms lists exactly its members, in the note's order", () => {
    const notes = synNotes({ 厌恶: { members: ['averse', 'aversion', 'antipathy'], text: '先分词性……' } })
    const view = groupView(dislikeGroup, dislike, notes, contrast(), wordNotes({ averse: '程度不重' }))
    expect(view?.kind).toBe('paragraph')
    expect(view?.members.map((m) => m.id)).toEqual(['averse', 'aversion', 'antipathy'])
    expect(view?.kind === 'paragraph' && view.text).toBe('先分词性……')
    expect(view?.members.every((m) => m.note === undefined)).toBe(true)
    expect(view?.title).toBe('厌恶、反感')
  })

  it('falls back to the pieces when the note was written for other members', () => {
    const notes = synNotes({ 反感: { members: ['antipathy', 'aversion'], text: '……' } })
    expect(groupView(dislikeGroup, dislike, notes, contrast(), wordNotes())?.kind).toBe('pieces')
  })

  it('shows a word note and pair notes only for first-meaning members, and counts the rest as missing', () => {
    const words = byId(
      w('alleviate', [['v.', '减轻;缓解']]),
      w('abate', [['v.', '减弱;减轻']]),
      w('blunt', [['adj.', '钝的'], ['v.', '使变钝;减轻']]),
    )
    const group: SynonymGroup = {
      key: '减轻', terms: ['减轻'], bridges: [],
      members: [member('abate'), member('alleviate'), member('blunt', [1])],
    }
    const view = groupView(group, words, synNotes(), contrast({
      'abate|alleviate': 'abate 说势头自己减弱……',
      'alleviate|blunt': 'blunt 说直率……',
    }), wordNotes({ alleviate: '缓解痛苦', blunt: '直言不讳' }))
    expect(view?.kind).toBe('pieces')
    if (view?.kind !== 'pieces') return
    expect(view.pairs).toEqual([{ a: 'abate', b: 'alleviate', text: 'abate 说势头自己减弱……' }])
    expect(view.missing).toBe(2)
    expect(view.members.find((m) => m.id === 'alleviate')?.note).toBe('缓解痛苦')
    expect(view.members.find((m) => m.id === 'blunt')?.note).toBeUndefined()
  })

  it('takes the usage line from collocations on first-meaning members only', () => {
    const words = byId(
      w('alleviate', [['v.', '减轻']], ['alleviate pain', 'alleviate poverty']),
      w('blunt', [['adj.', '钝的'], ['v.', '减轻']], ['blunt instrument']),
    )
    const group: SynonymGroup = { key: '减轻', terms: ['减轻'], bridges: [], members: [member('alleviate'), member('blunt', [1])] }
    const view = groupView(group, words, synNotes(), contrast(), wordNotes())
    expect(view?.members.map((m) => m.usage)).toEqual([['alleviate pain', 'alleviate poverty'], []])
  })

  it('keeps each carrying meaning with its part of speech', () => {
    const words = byId(
      w('grouse', [['v.', '抱怨;发牢骚'], ['n.', '牢骚;怨言']]),
      w('grumble', [['v.', '抱怨'], ['n.', '牢骚']]),
    )
    const group: SynonymGroup = {
      key: '抱怨、牢骚', terms: ['抱怨', '牢骚'], bridges: [], members: [member('grouse', [0, 1]), member('grumble', [0, 1])],
    }
    const view = groupView(group, words, synNotes(), contrast(), wordNotes())
    expect(view?.members[0].meanings).toEqual([{ pos: 'v.', zh: '抱怨;发牢骚' }, { pos: 'n.', zh: '牢骚;怨言' }])
  })

  it('skips a malformed note entry rather than throwing', () => {
    const notes = { version: 1, notes: { 厌恶: { members: 'averse', text: 5 }, 反感: null } } as unknown as SynonymNotesFile
    expect(() => groupView(dislikeGroup, dislike, notes, contrast(), wordNotes())).not.toThrow()
    expect(groupView(dislikeGroup, dislike, notes, contrast(), wordNotes())?.kind).toBe('pieces')
  })

  it('drops a member deleted mid-visit, and gives null when one is left', () => {
    const two = byId(w('antipathy', [['n.', '反感']]), w('aversion', [['n.', '反感']]))
    expect(groupView(dislikeGroup, two, synNotes(), contrast(), wordNotes())?.members.map((m) => m.id))
      .toEqual(['antipathy', 'aversion'])
    expect(groupView(dislikeGroup, byId(w('antipathy', [['n.', '反感']])), synNotes(), contrast(), wordNotes())).toBeNull()
  })
})

describe('base words in the view (spec R2)', () => {
  it('shows a lone member\x27s base word, with its usage when it is a library word', () => {
    const words = byId(
      w('diminishing', [['adj.', '逐渐减少的']], ['diminishing returns']),
      w('dwindle', [['v.', '逐渐减少']]),
      w('diminish', [['v.', '减少']], ['diminish the risk']),
    )
    const group: SynonymGroup = {
      key: '逐渐减少', terms: ['逐渐减少'], members: [member('diminishing'), member('dwindle')],
      bridges: [{ for: 'diminishing', form: 'diminish', pos: 'v.', zh: '减少;削弱', wordId: 'diminish' }],
    }
    const pieces = groupView(group, words, synNotes(), contrast(), wordNotes())
    expect(pieces?.members[0].bridge).toEqual({ form: 'diminish', pos: 'v.', zh: '减少;削弱', usage: ['diminish the risk'] })
    expect(pieces?.members[1].bridge).toBeUndefined()
    const notes = synNotes({ 逐渐减少: { members: ['dwindle', 'diminishing'], text: '…' } })
    const paragraph = groupView(group, words, notes, contrast(), wordNotes())
    expect(paragraph?.kind).toBe('paragraph')
    expect(paragraph?.members[1].bridge?.form).toBe('diminish')
  })

  it('gives a base word that is not a library word no usage line', () => {
    const words = byId(w('austerity', [['n.', '严峻']]), w('bleak', [['adj.', '严峻的']]))
    const group: SynonymGroup = {
      key: '严峻', terms: ['严峻'], members: [member('austerity'), member('bleak')],
      bridges: [{ for: 'austerity', form: 'austere', pos: 'adj.', zh: '严峻的' }],
    }
    expect(groupView(group, words, synNotes(), contrast(), wordNotes())?.members[0].bridge)
      .toEqual({ form: 'austere', pos: 'adj.', zh: '严峻的', usage: [] })
  })
})

describe('opposites in the view (spec R3)', () => {
  const ant = (id: string, zh: string, antonyms: string[]): Word => ({ ...w(id, [['adj.', zh]]), antonyms })
  const thrift = byId(
    ant('frugal', '节俭的', ['lavish', 'wasteful']),
    ant('thrifty', '节俭的', ['extravagant']),
    ant('lavish', '奢侈的', []),
    ant('extravagant', '奢侈的', []),
    { ...w('spare', [['adj.', '多余的'], ['adj.', '节俭的']]), antonyms: ['necessary'] },
  )
  const frugalGroup: SynonymGroup = {
    key: '节俭', terms: ['节俭'], bridges: [],
    members: [member('frugal'), member('thrifty'), member('spare', [1])],
  }
  const lavishGroup: SynonymGroup = { key: '奢侈', terms: ['奢侈'], bridges: [], members: [member('extravagant'), member('lavish')] }

  it('lists antonyms on first-meaning members only', () => {
    const view = groupView(frugalGroup, thrift, synNotes(), contrast(), wordNotes())
    expect(view?.members.map((m) => m.antonyms)).toEqual([['lavish', 'wasteful'], ['extravagant'], []])
  })

  it('shows the opposite group, with its paragraph when current', () => {
    const notes = synNotes({ 奢侈: { members: ['lavish', 'extravagant'], text: 'lavish 偏慷慨……' } })
    const view = groupView(frugalGroup, thrift, notes, contrast(), wordNotes(), lavishGroup)
    expect(view?.opposite).toEqual({
      title: '奢侈',
      members: [
        { id: 'lavish', headword: 'lavish', meanings: [{ pos: 'adj.', zh: '奢侈的' }] },
        { id: 'extravagant', headword: 'extravagant', meanings: [{ pos: 'adj.', zh: '奢侈的' }] },
      ],
      text: 'lavish 偏慷慨……',
    })
  })

  it('shows the opposite group without a paragraph when none is current, and none without one', () => {
    const view = groupView(frugalGroup, thrift, synNotes(), contrast(), wordNotes(), lavishGroup)
    expect(view?.opposite?.text).toBeUndefined()
    expect(view?.opposite?.members.map((m) => m.id)).toEqual(['extravagant', 'lavish'])
    expect(groupView(frugalGroup, thrift, synNotes(), contrast(), wordNotes())?.opposite).toBeUndefined()
  })
})

describe('currentNote', () => {
  it('matches the member set regardless of order, under any of the terms', () => {
    const notes = synNotes({ 反感: { members: ['aversion', 'averse', 'antipathy'], text: 't' } })
    expect(currentNote(dislikeGroup, notes)?.text).toBe('t')
    expect(currentNote({ ...dislikeGroup, terms: ['厌恶'] }, notes)).toBeUndefined()
  })
})
