import { describe, expect, it } from 'vitest'
import { NEIGHBOUR_CAP, optionGlosses, recallNeighbours } from './recallNeighbours'
import type { Meaning, Word } from '../types'

const w = (id: string, meanings: Array<[string, string]>, synonyms: string[] = []): Word => ({
  id, headword: id, phonetic: `/${id}/`,
  meanings: meanings.map(([pos, zh]): Meaning => ({ pos, zh, en: `${id} ${pos} def` })),
  examples: [`It was ${id}.`],
  synonyms, antonyms: [], collocations: [], relatedForms: [], sourceNote: 't', addedAt: '2026-07-01',
})

// The subside report, 2026-11-13: 渐渐平息 drew placate and appease, whose
// glosses carry 平息, and abate is subside's own synonym.
const subside = w('subside', [['v.', '减弱;平息;消退'], ['v.', '退去;下沉']], ['abate', 'ebb', 'wane'])
const abate = w('abate', [['v.', '减弱;缓和']], ['subside'])
const ebb = w('ebb', [['n.', '退潮'], ['v.', '衰退;减退']])
const placate = w('placate', [['v.', '安抚;平息(怒气)']])
const appease = w('appease', [['v.', '安抚,平息(怒气)']])
const lull = w('lull', [['n.', '平息;间歇']])
const library = [subside, abate, ebb, placate, appease, lull]
const ids = (ns: { id: string }[]) => ns.map(n => n.id)

describe('recallNeighbours', () => {
  it('lists card synonyms before gloss neighbours', () => {
    expect(ids(recallNeighbours(subside, 0, '渐渐平息', [], library))).toEqual(['abate', 'ebb', 'appease', 'placate'])
  })

  it('adds a gloss neighbour only when its term is in the target', () => {
    expect(ids(recallNeighbours(subside, 0, '消退', [], library))).toEqual(['abate', 'ebb'])
  })

  it('ignores a gloss neighbour of another part of speech', () => {
    // lull's 平息 is a noun; the rendered sense is a verb.
    expect(ids(recallNeighbours(subside, 0, '渐渐平息', [], library))).not.toContain('lull')
  })

  it('reads the gloss terms of the rendered sense, not the first', () => {
    const drop = w('drop', [['v.', '下沉']])
    expect(ids(recallNeighbours(subside, 1, '下沉了', [], [...library, drop]))).toContain('drop')
    expect(ids(recallNeighbours(subside, 0, '下沉了', [], [...library, drop]))).not.toContain('drop')
  })

  it('skips synonym strings not in the library', () => {
    expect(ids(recallNeighbours(subside, 0, '消退', [], library))).not.toContain('wane')
  })

  it('excludes the answer and on-screen options, case-insensitively', () => {
    const got = ids(recallNeighbours(subside, 0, '渐渐平息', ['Abate', 'placate', 'depose', 'oversee'], library))
    expect(got).toEqual(['ebb', 'appease'])
    expect(got).not.toContain('subside')
  })

  it('caps at NEIGHBOUR_CAP', () => {
    const many = Array.from({ length: 10 }, (_, i) => w(`calm${i}`, [['v.', '平息']]))
    expect(recallNeighbours(subside, 0, '渐渐平息', [], [...library, ...many])).toHaveLength(NEIGHBOUR_CAP)
  })

  it("focuses the neighbour's sense matching the answer's part of speech, with every sense listed", () => {
    const [ebbN] = recallNeighbours(subside, 0, '消退', ['abate'], library)
    expect(ebbN).toEqual({
      id: 'ebb', headword: 'ebb', focus: 1,
      lines: [{ pos: 'n.', zh: '退潮' }, { pos: 'v.', zh: '衰退;减退', en: 'ebb v. def' }],
    })
  })

  it('falls back to the first meaning when no part of speech matches', () => {
    const fade = w('fade', [['adj.', '褪色的']])
    const answer = { ...subside, synonyms: ['fade'] }
    expect(recallNeighbours(answer, 0, '消退', [], [answer, fade])[0]).toMatchObject({ id: 'fade', focus: 0 })
  })

  // Review, 2026-11-14: belittle [贬低] listed degrade under 退化, its first
  // verb sense, though 贬低 is what brought it in.
  it('focuses a gloss neighbour on the sense whose term matched the target', () => {
    const belittle = w('belittle', [['v.', '贬低;轻视']])
    const degrade = w('degrade', [['v.', '退化;降低质量'], ['v.', '贬低;使丢脸']])
    const [n] = recallNeighbours(belittle, 0, '贬低', [], [belittle, degrade])
    expect(n).toMatchObject({ id: 'degrade', focus: 1 })
  })

  // Review, 2026-11-14: callous asked as 老茧 (its second sense) listed
  // insensitive, a synonym of its first.
  it('drops a card synonym sharing no gloss term with a secondary rendered sense', () => {
    const callous = w('callous', [['adj.', '冷酷无情的'], ['adj.', '(皮肤)硬结的;起老茧的']], ['insensitive', 'hardened'])
    const insensitive = w('insensitive', [['adj.', '冷酷无情的;麻木不仁的']])
    const hardened = w('hardened', [['adj.', '变硬的;硬结的']])
    const lib = [callous, insensitive, hardened]
    expect(ids(recallNeighbours(callous, 1, '老茧', [], lib))).toEqual(['hardened'])
    expect(ids(recallNeighbours(callous, 0, '冷酷', [], lib))).toEqual(['insensitive', 'hardened'])
  })

  it('runs the synonym path only when the target is undefined', () => {
    expect(ids(recallNeighbours(subside, 0, undefined, [], library))).toEqual(['abate', 'ebb'])
  })
})

// The goodwill report, 2026-11-14: the four options on the reveal open
// their entries, and the answer's focus is the sense the rendering is about.
describe('optionGlosses', () => {
  const goodwill = w('goodwill', [['n.', '善意;好意;友好'], ['n.', '商誉;营业信誉']])
  const tyranny = w('tyranny', [['n.', '暴政;专横']])
  const mime = w('mime', [['v.', '模仿;做哑剧'], ['n.', '哑剧']])
  const words = [goodwill, tyranny, mime]

  it('keys each option to its gloss, the answer focused on the rendered sense', () => {
    const got = optionGlosses(goodwill, 1, ['tyranny', 'goodwill', 'mime'], words)
    expect(got.get('goodwill')).toEqual({
      id: 'goodwill', headword: 'goodwill', focus: 1,
      lines: [{ pos: 'n.', zh: '善意;好意;友好' }, { pos: 'n.', zh: '商誉;营业信誉', en: 'goodwill n. def' }],
    })
    expect(got.get('tyranny')?.focus).toBe(0)
  })

  it("focuses a distractor on its sense of the answer's part of speech", () => {
    expect(optionGlosses(goodwill, 0, ['mime'], words).get('mime')?.focus).toBe(1)
  })

  it('omits an option not in the library, so it does not expand', () => {
    expect(optionGlosses(goodwill, 0, ['goodwill', 'ghost'], words).has('ghost')).toBe(false)
  })

  it('matches an option case-insensitively but keys it as printed', () => {
    expect(optionGlosses(goodwill, 0, ['Goodwill'], words).get('Goodwill')?.id).toBe('goodwill')
  })

  it('falls back to sense 0 for the answer when the sense index dangles', () => {
    expect(optionGlosses(goodwill, 7, ['goodwill'], words).get('goodwill')?.focus).toBe(0)
  })
})
