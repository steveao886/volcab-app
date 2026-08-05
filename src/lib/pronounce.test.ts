import { describe, expect, it } from 'vitest'
import { pickAudioUrl } from './pronounce'

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

  it('returns null when the entry has no audio at all — abrogate is a real example, and the reason TTS stays', () => {
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
