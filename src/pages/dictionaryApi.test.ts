import { describe, expect, it } from 'vitest'
import { mapDictionaryResponse } from './dictionaryApi'

/**
 * Fixtures are taken from real responses (manually curled and checked
 * against api.dictionaryapi.dev on 2026-07-25), with fields the mapping
 * function doesn't use — audio/license/sourceUrls etc. — trimmed out,
 * keeping the real definition/phonetic text and array order intact.
 */

// curl https://api.dictionaryapi.dev/api/v2/entries/en/abrogate
// Key trait: no top-level phonetic, and the phonetics array is empty — no phonetic is available at all
const ABROGATE_FIXTURE = [
  {
    word: 'abrogate',
    phonetics: [],
    meanings: [
      {
        partOfSpeech: 'verb',
        definitions: [
          {
            definition:
              'To annul by an authoritative act; to abolish by the authority of the maker or her or his successor; to repeal; — applied to the repeal of laws, decrees, ordinances, the abolition of customs, etc.',
            synonyms: [],
            antonyms: [],
          },
          { definition: 'To put an end to; to do away with.', synonyms: [], antonyms: [] },
          { definition: 'To block a process or function.', synonyms: [], antonyms: [] },
        ],
        synonyms: ['abolish', 'annul'],
        antonyms: ['establish', 'fix'],
      },
      {
        partOfSpeech: 'adjective',
        definitions: [{ definition: 'Abrogated; abolished.', synonyms: [], antonyms: [] }],
        synonyms: [],
        antonyms: [],
      },
    ],
  },
]

// curl https://api.dictionaryapi.dev/api/v2/entries/en/run
// Key trait: phonetics[0] has only audio, no text; the next two already
// include slashes; meanings has 4 entries (verb, noun, verb, adjective),
// used to verify "only the first 3 are taken"
const RUN_FIXTURE = [
  {
    word: 'run',
    phonetics: [
      { audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/run-au.mp3' },
      { text: '/ɹʊn/', audio: '' },
      { text: '/ɹʌn/', audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/run-us.mp3' },
    ],
    meanings: [
      {
        partOfSpeech: 'verb',
        definitions: [{ definition: 'To run.', synonyms: [], antonyms: [] }],
        synonyms: [],
        antonyms: [],
      },
      {
        partOfSpeech: 'noun',
        definitions: [
          {
            definition: 'Act or instance of running, of moving rapidly using the feet.',
            synonyms: [],
            antonyms: [],
            example: 'I just got back from my morning run.',
          },
          { definition: 'Act or instance of hurrying (to or from a place).', synonyms: [], antonyms: [] },
        ],
        synonyms: ['execute', 'start'],
        antonyms: ['rise'],
      },
      {
        partOfSpeech: 'verb',
        definitions: [{ definition: 'To move swiftly.', synonyms: [], antonyms: [] }],
        synonyms: [],
        antonyms: [],
      },
      {
        partOfSpeech: 'adjective',
        definitions: [{ definition: 'In a liquid state; melted or molten.', synonyms: [], antonyms: [] }],
        synonyms: [],
        antonyms: [],
      },
    ],
  },
]

// curl https://api.dictionaryapi.dev/api/v2/entries/en/happy
// Key trait: phonetics[0] likewise has only audio; the first one with text is the British /ˈhæpiː/
const HAPPY_FIXTURE = [
  {
    word: 'happy',
    phonetics: [
      { audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/happy-au.mp3' },
      { text: '/ˈhæpiː/', audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/happy-uk.mp3' },
      { text: '/ˈhæpi/', audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/happy-us.mp3' },
    ],
    meanings: [
      {
        partOfSpeech: 'noun',
        definitions: [{ definition: 'A happy event, thing, person, etc.', synonyms: [], antonyms: [] }],
        synonyms: [],
        antonyms: [],
      },
      {
        partOfSpeech: 'noun',
        definitions: [{ definition: 'Preceded by the: happy people as a group.', synonyms: [], antonyms: [] }],
        synonyms: [],
        antonyms: [],
      },
      {
        partOfSpeech: 'verb',
        definitions: [
          {
            definition: 'Often followed by up: to become happy; to brighten up, to cheer up.',
            synonyms: [],
            antonyms: [],
          },
        ],
        synonyms: ['happify'],
        antonyms: [],
      },
      {
        partOfSpeech: 'adjective',
        definitions: [
          { definition: 'Having a feeling arising from a consciousness of well-being.', synonyms: [], antonyms: [] },
        ],
        synonyms: [],
        antonyms: [],
      },
    ],
  },
]

// curl https://api.dictionaryapi.dev/api/v2/entries/en/zzzqqq → HTTP 404
const NOT_FOUND_BODY = {
  title: 'No Definitions Found',
  message: "Sorry pal, we couldn't find definitions for the word you were looking for.",
  resolution: 'You can try the search again at later time or head to the web instead.',
}

describe('mapDictionaryResponse · real response fixtures', () => {
  it('abrogate: no phonetic (missing at top level and phonetics is empty), takes the first 2 meanings (this word only has 2)', () => {
    const result = mapDictionaryResponse(ABROGATE_FIXTURE)
    expect(result.phonetic).toBe('')
    expect(result.meanings).toEqual([
      {
        pos: 'v.',
        en: 'To annul by an authoritative act; to abolish by the authority of the maker or her or his successor; to repeal; — applied to the repeal of laws, decrees, ordinances, the abolition of customs, etc.',
      },
      { pos: 'adj.', en: 'Abrogated; abolished.' },
    ])
  })

  it('run: skips phonetics[0] which has no text, takes the first valid phonetic; only the first 3 of 4 meanings are taken', () => {
    const result = mapDictionaryResponse(RUN_FIXTURE)
    expect(result.phonetic).toBe('/ɹʊn/')
    expect(result.meanings).toEqual([
      { pos: 'v.', en: 'To run.' },
      { pos: 'n.', en: 'Act or instance of running, of moving rapidly using the feet.' },
      { pos: 'v.', en: 'To move swiftly.' },
    ])
  })

  it('happy: likewise skips the first entry with no text, takes the British phonetic; part-of-speech abbreviations follow this app\'s convention', () => {
    const result = mapDictionaryResponse(HAPPY_FIXTURE)
    expect(result.phonetic).toBe('/ˈhæpiː/')
    expect(result.meanings.map((m) => m.pos)).toEqual(['n.', 'n.', 'v.'])
  })

  it('404 error response body (not an array) → empty result, no exception thrown', () => {
    expect(mapDictionaryResponse(NOT_FOUND_BODY)).toEqual({ phonetic: '', meanings: [] })
  })
})

describe('mapDictionaryResponse · edge cases and malformed input', () => {
  it('empty array → empty result', () => {
    expect(mapDictionaryResponse([])).toEqual({ phonetic: '', meanings: [] })
  })

  it('null / undefined → empty result, no exception thrown', () => {
    expect(mapDictionaryResponse(null)).toEqual({ phonetic: '', meanings: [] })
    expect(mapDictionaryResponse(undefined)).toEqual({ phonetic: '', meanings: [] })
  })

  it('completely unrelated types like string / number → empty result', () => {
    expect(mapDictionaryResponse('abrogate')).toEqual({ phonetic: '', meanings: [] })
    expect(mapDictionaryResponse(42)).toEqual({ phonetic: '', meanings: [] })
  })

  it('phonetics with all-whitespace text → treated as no phonetic', () => {
    const data = [{ phonetics: [{ text: '' }, { text: '   ' }] }]
    expect(mapDictionaryResponse(data).phonetic).toBe('')
  })

  it('phonetic text without slashes → completed into /.../ form', () => {
    const data = [{ phonetics: [{ text: 'əˈbreɪʒən' }] }]
    expect(mapDictionaryResponse(data).phonetic).toBe('/əˈbreɪʒən/')
  })

  it('top-level phonetic string takes priority over the phonetics array, and is likewise normalized', () => {
    const data = [{ phonetic: 'test', phonetics: [{ text: '/should-not-use/' }] }]
    expect(mapDictionaryResponse(data).phonetic).toBe('/test/')
  })

  it('top-level phonetic is an empty string → falls back to the phonetics array', () => {
    const data = [{ phonetic: '', phonetics: [{ text: '/fallback/' }] }]
    expect(mapDictionaryResponse(data).phonetic).toBe('/fallback/')
  })

  it('meaning missing definitions (empty array) → skipped, doesn\'t count toward the first-3 quota', () => {
    const data = [
      {
        meanings: [
          { partOfSpeech: 'verb', definitions: [] },
          { partOfSpeech: 'noun', definitions: [{ definition: 'ok' }] },
        ],
      },
    ]
    expect(mapDictionaryResponse(data).meanings).toEqual([{ pos: 'n.', en: 'ok' }])
  })

  it('meaning missing partOfSpeech → pos left as an empty string, rather than crashing or inserting undefined', () => {
    const data = [{ meanings: [{ definitions: [{ definition: 'no pos field' }] }] }]
    expect(mapDictionaryResponse(data).meanings).toEqual([{ pos: '', en: 'no pos field' }])
  })

  it('unknown part of speech (non-standard partOfSpeech) → falls back to a "word." style abbreviation', () => {
    const data = [{ meanings: [{ partOfSpeech: 'phrase', definitions: [{ definition: 'x' }] }] }]
    expect(mapDictionaryResponse(data).meanings).toEqual([{ pos: 'phrase.', en: 'x' }])
  })

  it('meanings field has the wrong type (not an array) → empty meanings, no exception thrown', () => {
    const data = [{ meanings: 'oops' }]
    expect(mapDictionaryResponse(data).meanings).toEqual([])
  })

  it('a definitions element isn\'t an object / definition isn\'t a string → skipped one by one while continuing to search', () => {
    const data = [
      {
        meanings: [
          { partOfSpeech: 'verb', definitions: [null, 42, { definition: 123 }, { definition: 'valid' }] },
        ],
      },
    ]
    expect(mapDictionaryResponse(data).meanings).toEqual([{ pos: 'v.', en: 'valid' }])
  })

  it('when there are more than 3 meanings, only the first 3 are taken (even if all are valid)', () => {
    const data = [
      {
        meanings: Array.from({ length: 5 }, (_, i) => ({
          partOfSpeech: 'noun',
          definitions: [{ definition: `def-${i}` }],
        })),
      },
    ]
    expect(mapDictionaryResponse(data).meanings).toEqual([
      { pos: 'n.', en: 'def-0' },
      { pos: 'n.', en: 'def-1' },
      { pos: 'n.', en: 'def-2' },
    ])
  })

  it('the first array item isn\'t an object (e.g. starts with null) → skipped, continues to find the first usable entry', () => {
    const data = [null, { meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'second entry' }] }] }]
    expect(mapDictionaryResponse(data).meanings).toEqual([{ pos: 'n.', en: 'second entry' }])
  })
})
