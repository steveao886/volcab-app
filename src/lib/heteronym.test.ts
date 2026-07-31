import { describe, expect, it } from 'vitest'
import { heteronymRisk } from './heteronym'

describe('heteronymRisk', () => {
  it('a monosemous entry is never at risk, whatever the spelling', () => {
    // "object" entered only as a verb has one pronunciation and one truth to
    // tell. The risk only exists once two senses share the headword.
    expect(heteronymRisk('object', ['v.'])).toBeNull()
    expect(heteronymRisk('record', ['n.'])).toBeNull()
  })

  it('flags the classic noun/verb stress shifts once both senses are present', () => {
    expect(heteronymRisk('record', ['v.', 'n.'])).toBe('known')
    expect(heteronymRisk('present', ['n.', 'v.'])).toBe('known')
    expect(heteronymRisk('contract', ['n.', 'v.'])).toBe('known')
  })

  it('flags -ate words by rule rather than by list', () => {
    // The alternation is regular: /-eɪt/ as the verb, reduced /-ət/ otherwise.
    expect(heteronymRisk('indurate', ['v.', 'adj.'])).toBe('ate-alternation')
    expect(heteronymRisk('deliberate', ['adj.', 'v.'])).toBe('ate-alternation')
    expect(heteronymRisk('graduate', ['v.', 'n.'])).toBe('ate-alternation')
  })

  it('an -ate word that is not also a verb does not alternate', () => {
    expect(heteronymRisk('ultimate', ['adj.', 'n.'])).toBeNull()
  })

  it('leaves the many polysemous words that keep one pronunciation alone', () => {
    // These are real entries spanning n./v. in the library. A rule that keyed
    // off part of speech alone would flag every one of them and be wrong
    // nineteen times out of twenty, which is a gate that gets ignored.
    for (const h of ['harangue', 'mire', 'grouse', 'rebuke', 'mime', 'dovetail', 'swindle']) {
      expect(heteronymRisk(h, ['v.', 'n.'])).toBeNull()
    }
  })

  it('relapse is not on the list — the noun did not shift stress the way record did', () => {
    expect(heteronymRisk('relapse', ['n.', 'v.'])).toBeNull()
  })

  it('is case- and whitespace-insensitive, since it reads a headword as typed', () => {
    expect(heteronymRisk('  Record ', ['v.', 'n.'])).toBe('known')
  })
})
