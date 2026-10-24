import { describe, expect, it } from 'vitest'
import type { Word } from '../types'
import type { SynonymGroup } from './synonymGroups'
import { oppositeGroups } from './synonymOpposites'

const w = (id: string, antonyms: string[] = [], headword = id): Word => ({
  id, headword, phonetic: '', sourceNote: 'test', addedAt: '2026-10-23',
  meanings: [{ pos: 'adj.', en: id, zh: id }],
  examples: [], synonyms: [], antonyms, collocations: [], relatedForms: [],
})
/** A group whose members are first-meaning members, except those listed in `later`. */
const g = (key: string, ids: string[], later: string[] = []): SynonymGroup => ({
  key, terms: [key], bridges: [],
  members: ids.map((id) => ({ id, carrying: later.includes(id) ? [1] : [0], firstMeaning: !later.includes(id) })),
})

describe('oppositeGroups', () => {
  it('pairs two groups joined by two first-meaning antonym pairs', () => {
    const words = [w('frugal', ['lavish']), w('thrifty', ['extravagant']), w('lavish'), w('extravagant')]
    const groups = [g('节俭', ['frugal', 'thrifty']), g('奢侈', ['lavish', 'extravagant'])]
    const opp = oppositeGroups(groups, words)
    expect(opp.get('节俭')).toBe('奢侈')
    expect(opp.get('奢侈')).toBe('节俭')
  })

  it('needs at least two pairs', () => {
    const words = [w('frugal', ['lavish']), w('thrifty'), w('lavish'), w('extravagant')]
    const groups = [g('节俭', ['frugal', 'thrifty']), g('奢侈', ['lavish', 'extravagant'])]
    expect(oppositeGroups(groups, words).size).toBe(0)
  })

  it('counts a pair listed on both sides once', () => {
    const words = [w('frugal', ['lavish']), w('thrifty'), w('lavish', ['frugal']), w('extravagant')]
    const groups = [g('节俭', ['frugal', 'thrifty']), g('奢侈', ['lavish', 'extravagant'])]
    expect(oppositeGroups(groups, words).size).toBe(0)
  })

  it('needs a unique best, so a tie between two groups gives none', () => {
    const words = [
      w('frugal', ['lavish', 'wasteful']), w('thrifty', ['extravagant', 'prodigal']),
      w('lavish'), w('extravagant'), w('wasteful'), w('prodigal'),
    ]
    const groups = [g('节俭', ['frugal', 'thrifty']), g('奢侈', ['lavish', 'extravagant']), g('浪费', ['wasteful', 'prodigal'])]
    expect(oppositeGroups(groups, words).get('节俭')).toBeUndefined()
  })

  it('ignores antonyms through a member that is in the group by a later meaning', () => {
    // The antonym hangs off the word, not the sense (CLAUDE.md): blunt's
    // opposites belong to 钝的, not to the 减轻 it carries here.
    const words = [w('blunt', ['sharp', 'keen']), w('alleviate'), w('sharp'), w('keen')]
    const groups = [g('减轻', ['alleviate', 'blunt'], ['blunt']), g('锋利', ['sharp', 'keen'])]
    expect(oppositeGroups(groups, words).size).toBe(0)
  })

  it('matches headwords case-insensitively and skips antonyms outside the library', () => {
    const words = [w('frugal', ['Lavish', 'stingy-ish']), w('thrifty', ['EXTRAVAGANT']), w('lavish'), w('extravagant')]
    const groups = [g('节俭', ['frugal', 'thrifty']), g('奢侈', ['lavish', 'extravagant'])]
    expect(oppositeGroups(groups, words).get('节俭')).toBe('奢侈')
  })
})
