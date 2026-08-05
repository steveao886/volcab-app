import { describe, expect, it } from 'vitest'
import { pickAudioUrl, preparePronunciation, youdaoUrl } from './pronounce'

/** Shaped like api.dictionaryapi.dev's response: an array of entries, each with a phonetics list. */
const entry = (...audio: string[]) => ({ phonetics: audio.map(a => ({ text: '/x/', audio: a })) })

describe('pickAudioUrl', () => {
  it('prefers the American recording — every phonetic in this library is American', () => {
    const data = [entry(
      'https://api.dictionaryapi.dev/media/pronunciations/en/conflate-uk.mp3',
      'https://api.dictionaryapi.dev/media/pronunciations/en/conflate-us.mp3',
    )]
    expect(pickAudioUrl(data)).toMatch(/-us\.mp3$/)
  })

  it('takes what exists when there is no US recording', () => {
    // zeitgeist really only has -au audio on this API.
    const data = [entry('https://api.dictionaryapi.dev/media/pronunciations/en/zeitgeist-au.mp3')]
    expect(pickAudioUrl(data)).toMatch(/-au\.mp3$/)
  })

  it('returns null when the entry has no audio at all — abrogate is a real example; the caller substitutes the server voice', () => {
    expect(pickAudioUrl([{ phonetics: [{ text: '/ˈæbrəɡeɪt/', audio: '' }] }])).toBeNull()
    expect(pickAudioUrl([{ phonetics: [] }])).toBeNull()
  })

  it('searches across multiple entries, not just the first', () => {
    const data = [
      { phonetics: [{ audio: '' }] },
      entry('https://api.dictionaryapi.dev/media/pronunciations/en/record-us.mp3'),
    ]
    expect(pickAudioUrl(data)).toMatch(/record-us\.mp3$/)
  })

  it('tolerates garbage instead of throwing — this parses an external API body', () => {
    expect(pickAudioUrl(null)).toBeNull()
    expect(pickAudioUrl('nope')).toBeNull()
    expect(pickAudioUrl([{ phonetics: 'nope' }])).toBeNull()
    expect(pickAudioUrl([{ phonetics: [{ audio: 42 }] }])).toBeNull()
  })
})

describe('youdaoUrl', () => {
  it('is derivable from the headword alone — no lookup, so an unprepared tap can still play something correct', () => {
    expect(youdaoUrl('conflate')).toBe('https://dict.youdao.com/dictvoice?audio=conflate&type=2')
  })

  it('asks for the American voice, matching every phonetic in this library', () => {
    expect(youdaoUrl('abrogate')).toContain('type=2')
  })

  it('encodes phrases — connected speech is exactly where the local engine was weakest', () => {
    expect(youdaoUrl('bite the bullet')).toBe('https://dict.youdao.com/dictvoice?audio=bite%20the%20bullet&type=2')
  })

  it('normalises case and whitespace so the URL matches what the map was keyed with', () => {
    expect(youdaoUrl('  Conflate ')).toBe(youdaoUrl('conflate'))
  })
})

describe('preparePronunciation for phrases', () => {
  it('settles a phrase on the server voice synchronously, with no dictionary lookup', () => {
    // The dictionary 404s on phrases anyway; going straight to youdao means
    // even the very first play of a phrase needs no network round trip at
    // prepare time.
    localStorage.removeItem('volcab.audioUrls')
    preparePronunciation('Bite the Bullet')
    const map = JSON.parse(localStorage.getItem('volcab.audioUrls') ?? '{}')
    expect(map['bite the bullet']).toBe(youdaoUrl('bite the bullet'))
  })
})
