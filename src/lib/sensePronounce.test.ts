import { describe, expect, it } from 'vitest'
import { senseVoices } from './sensePronounce'
import type { Meaning, Word } from '../types'

const word = (headword: string, phonetic: string, meanings: Meaning[]): Word => ({
  id: headword, headword, phonetic, meanings,
  examples: [], synonyms: [], antonyms: [], collocations: [], relatedForms: [],
  sourceNote: 'manual', addedAt: '2026-08-13',
})

const sense = (pos: string, extra: Partial<Meaning> = {}): Meaning =>
  ({ pos, en: 'en', zh: '中', ...extra })

/** The real shape of the only two heteronyms in the library. */
const presage = word('presage', '/prɪˈseɪdʒ/', [
  sense('v.', { phonetic: '/prɪˈseɪdʒ/' }),
  sense('n.', { phonetic: '/ˈprɛsɪdʒ/', speakAs: 'press-idge' }),
])

describe('senseVoices', () => {
  it('returns one entry per meaning, always', () => {
    // The call sites index it against word.meanings, so a short array would
    // silently drop the last sense's button rather than fail.
    expect(senseVoices(presage)).toHaveLength(2)
    expect(senseVoices(word('abate', '/əˈbeɪt/', [sense('v.')]))).toHaveLength(1)
  })

  it('an ordinary word gets no per-sense buttons at all', () => {
    // 521 of 523 words. They must render exactly as they did before this
    // existed — the header button is the whole story for them.
    const w = word('abate', '/əˈbeɪt/', [sense('v.'), sense('n.')])
    expect(senseVoices(w)).toEqual([null, null])
  })

  it('a meaning phonetic identical to the word-level one is not a divergence', () => {
    // This is the trap the validator gate fell into: presage's verb sense
    // carries a copy of the word-level string, which looks like per-sense
    // data and says nothing new. On its own it must not switch the feature on.
    const w = word('presage', '/prɪˈseɪdʒ/', [
      sense('v.', { phonetic: '/prɪˈseɪdʒ/' }),
      sense('n.', { phonetic: '/prɪˈseɪdʒ/' }),
    ])
    expect(senseVoices(w)).toEqual([null, null])
  })

  it('voices the divergent sense with its respelling and the rest with the recording', () => {
    expect(senseVoices(presage)).toEqual([
      { kind: 'recording', text: 'presage' },
      { kind: 'synth', text: 'press-idge' },
    ])
  })

  it('a sense carrying no phonetic at all takes the recording', () => {
    // Only the divergent sense is obliged to name itself; anything silent is
    // covered by the word-level phonetic, which is what the recording says.
    const w = word('indurate', '/ˈɪndʊreɪt/', [
      sense('v.'),
      sense('adj.', { phonetic: '/ˈɪndʊrət/', speakAs: 'in-dew-rut' }),
    ])
    expect(senseVoices(w)).toEqual([
      { kind: 'recording', text: 'indurate' },
      { kind: 'synth', text: 'in-dew-rut' },
    ])
  })

  it('handles three senses, two of which share the recording', () => {
    const w = word('minute', '/ˈmɪnɪt/', [
      sense('n.', { phonetic: '/ˈmɪnɪt/' }),
      sense('n.'),
      sense('adj.', { phonetic: '/maɪˈnjuːt/', speakAs: 'my-newt' }),
    ])
    expect(senseVoices(w)).toEqual([
      { kind: 'recording', text: 'minute' },
      { kind: 'recording', text: 'minute' },
      { kind: 'synth', text: 'my-newt' },
    ])
  })

  it('a divergent sense with no speakAs silences the whole word, not just itself', () => {
    // The load-bearing rule. A button on the verb and nothing on the noun
    // reads as "the noun has no pronunciation" rather than "nobody has
    // written one yet". Falling back to the ordinary layout says nothing
    // false. Reachable from an older build on another device, which is why
    // it is a runtime rule and not only a validator error.
    const w = word('presage', '/prɪˈseɪdʒ/', [
      sense('v.', { phonetic: '/prɪˈseɪdʒ/' }),
      sense('n.', { phonetic: '/ˈprɛsɪdʒ/' }),
    ])
    expect(senseVoices(w)).toEqual([null, null])
  })

  it('treats a blank speakAs as absent rather than speaking an empty string', () => {
    const w = word('presage', '/prɪˈseɪdʒ/', [
      sense('v.', { phonetic: '/prɪˈseɪdʒ/' }),
      sense('n.', { phonetic: '/ˈprɛsɪdʒ/', speakAs: '   ' }),
    ])
    expect(senseVoices(w)).toEqual([null, null])
  })

  it('one unwritten sense silences the other divergent one too', () => {
    const w = word('minute', '/ˈmɪnɪt/', [
      sense('adj.', { phonetic: '/maɪˈnjuːt/', speakAs: 'my-newt' }),
      sense('v.', { phonetic: '/maɪˈnuːt/' }),
    ])
    expect(senseVoices(w)).toEqual([null, null])
  })

  it('trims the respelling it hands to the synthesizer', () => {
    const w = word('presage', '/prɪˈseɪdʒ/', [
      sense('n.', { phonetic: '/ˈprɛsɪdʒ/', speakAs: ' press-idge ' }),
    ])
    expect(senseVoices(w)).toEqual([{ kind: 'synth', text: 'press-idge' }])
  })
})
