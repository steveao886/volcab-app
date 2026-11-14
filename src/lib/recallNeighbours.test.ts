import { describe, expect, it } from 'vitest'
import { NEIGHBOUR_CAP, recallNeighbours } from './recallNeighbours'
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

  it("takes the neighbour's meaning matching the answer's part of speech", () => {
    const [ebbN] = recallNeighbours(subside, 0, '消退', ['abate'], library)
    expect(ebbN).toEqual({ id: 'ebb', headword: 'ebb', pos: 'v.', zh: '衰退;减退', en: 'ebb v. def' })
  })

  it('falls back to the first meaning when no part of speech matches', () => {
    const fade = w('fade', [['adj.', '褪色的']])
    const answer = { ...subside, synonyms: ['fade'] }
    expect(recallNeighbours(answer, 0, '消退', [], [answer, fade])[0]).toMatchObject({ id: 'fade', pos: 'adj.', zh: '褪色的' })
  })

  it('runs the synonym path only when the target is undefined', () => {
    expect(ids(recallNeighbours(subside, 0, undefined, [], library))).toEqual(['abate', 'ebb'])
  })
})
