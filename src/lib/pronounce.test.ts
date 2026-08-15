import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pickAudioUrl, preparePronunciation, pronounce, youdaoUrl } from './pronounce'

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

// --- The ladder, exercised end to end ------------------------------------
//
// These stub the two playback channels rather than the network, because the
// bug they pin down is entirely about *which channel gets used*: measured
// against the live services on 2026-08-05, every api.dictionaryapi.dev
// media mp3 returns 502 (conflate, inflate, abrogate, ubiquitous, cat — the
// whole host), while its JSON API keeps advertising those same URLs and
// youdao keeps serving real audio. So a recording that resolves fine can
// still be unplayable, and what happens next is the whole question.

const MEDIA = 'https://api.dictionaryapi.dev/media/pronunciations/en/conflate-us.mp3'
const AUDIO_URLS = 'volcab.audioUrls'

interface Played { url: string }
let played: Played[] = []
let spoken: string[] = []
/** Stands in for the 502: the element refuses the source, rejecting play(). */
let unplayable: (url: string) => boolean

class FakeAudio {
  onerror: (() => void) | null = null
  src: string
  /** Rejects this element's still-pending play(), the way a real one does when it is interrupted. */
  private abort: ((err: Error) => void) | null = null
  constructor(src: string) {
    this.src = src
    played.push({ url: src })
  }
  pause(): void {
    // A no-op fake hid a real bug for as long as it existed. In Chrome,
    // pausing an element whose play() has not settled yet **rejects that
    // promise** — "The play() request was interrupted by a call to pause()",
    // name AbortError — and play() only settles once playback actually
    // starts, 435ms away on a cold youdao fetch (measured in-browser).
    this.abort?.(Object.assign(new Error('interrupted by pause()'), { name: 'AbortError' }))
    this.abort = null
  }
  play(): Promise<void> {
    if (unplayable(this.src)) return Promise.reject(new Error('NotSupportedError'))
    return new Promise((resolve, reject) => {
      this.abort = reject
      setTimeout(() => { this.abort = null; resolve() }, 0)
    })
  }
}

/** Lets the rejected play() promise and its .catch run. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

function installChannels(): void {
  played = []
  spoken = []
  unplayable = () => false
  localStorage.removeItem(AUDIO_URLS)
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('speechSynthesis', { cancel: () => {}, getVoices: () => [], speak: (u: { text: string }) => spoken.push(u.text) })
  vi.stubGlobal('SpeechSynthesisUtterance', class {
    text: string
    constructor(text: string) { this.text = text }
  })
  // prepare() must not reach the real network from a test; a rejected fetch
  // is the "offline" path it already tolerates.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in tests'))))
}

describe('pronounce — a dead recording must not land on the local engine', () => {
  beforeEach(installChannels)
  afterEach(() => vi.unstubAllGlobals())

  it('falls to the server voice, not local synthesis — local synthesis is what says "con f late"', async () => {
    localStorage.setItem(AUDIO_URLS, JSON.stringify({ conflate: MEDIA }))
    unplayable = url => url === MEDIA

    pronounce('conflate')
    await flush()

    expect(played.map(p => p.url)).toEqual([MEDIA, youdaoUrl('conflate')])
    expect(spoken).toEqual([])
  })

  it('forgets the dead recording, so the next tap goes straight to the server voice', async () => {
    localStorage.setItem(AUDIO_URLS, JSON.stringify({ conflate: MEDIA }))
    unplayable = url => url === MEDIA

    pronounce('conflate')
    await flush()
    // Without this the entry is sticky in localStorage: prepare() early-returns
    // on `key in map`, so nothing re-checks it and every future tap repeats
    // the same dead request. That stickiness is why shipping a fix appeared
    // to change nothing.
    expect(JSON.parse(localStorage.getItem(AUDIO_URLS) ?? '{}')['conflate']).toBeUndefined()

    played = []
    pronounce('conflate')
    await flush()
    expect(played.map(p => p.url)).toEqual([youdaoUrl('conflate')])
  })

  it('reaches local synthesis only when the server voice fails too — that is the offline case', async () => {
    localStorage.setItem(AUDIO_URLS, JSON.stringify({ conflate: MEDIA }))
    unplayable = () => true

    pronounce('conflate')
    await flush()

    expect(played.map(p => p.url)).toEqual([MEDIA, youdaoUrl('conflate')])
    expect(spoken).toEqual(['conflate'])
  })

  it('an unprepared word plays the server voice and never the local engine', async () => {
    pronounce('conflate')
    await flush()

    expect(played.map(p => p.url)).toEqual([youdaoUrl('conflate')])
    expect(spoken).toEqual([])
  })
})

describe('pronounce — an interruption is not a failure', () => {
  beforeEach(installChannels)
  afterEach(() => vi.unstubAllGlobals())

  // Tapping the speak button again while the first clip is still loading is
  // an ordinary thing to do: a cold youdao fetch is 435ms away from making a
  // sound, so "nothing happened, tap it again" is the natural reaction — and
  // a brand-new word is exactly the case that is never cached. The re-tap
  // pauses the loading element, which rejects its play() promise, and that
  // rejection used to be indistinguishable from "this recording won't play":
  // the ladder fell to the bottom rung and Microsoft David read the word over
  // the top of the restarted clip (measured in Chrome: David starts at 24ms,
  // the replacement clip becomes audible at 435ms).
  it('a re-tap while the clip is still loading restarts it without waking the local engine', async () => {
    pronounce('conflate')
    pronounce('conflate')
    await flush()

    expect(played.map(p => p.url)).toEqual([youdaoUrl('conflate'), youdaoUrl('conflate')])
    expect(spoken).toEqual([])
  })

  it('still reaches the local engine when the replacement itself cannot play — the offline case survives the guard', async () => {
    pronounce('conflate')
    unplayable = () => true
    pronounce('conflate')
    await flush()

    expect(spoken).toEqual(['conflate'])
  })
})

describe('preparePronunciation — a recording is only recorded once its body arrives', () => {
  beforeEach(installChannels)
  afterEach(() => vi.unstubAllGlobals())

  const res = (over: Partial<{ ok: boolean; status: number; json: () => Promise<unknown> }>) =>
    ({ ok: true, status: 200, clone: () => ({}), json: () => Promise.resolve([]), ...over }) as unknown as Response

  it('a dictionary URL whose body 502s is never recorded — the server voice takes its place', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) =>
      Promise.resolve(url.includes('/api/v2/entries/')
        ? res({ json: () => Promise.resolve([{ phonetics: [{ audio: MEDIA }] }]) })
        : res({ ok: false, status: 502 }))))

    preparePronunciation('conflate')
    await flush()

    expect(JSON.parse(localStorage.getItem(AUDIO_URLS) ?? '{}')['conflate']).toBe(youdaoUrl('conflate'))
  })

  it('a recording whose body does arrive is recorded and preferred', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) =>
      Promise.resolve(url.includes('/api/v2/entries/')
        ? res({ json: () => Promise.resolve([{ phonetics: [{ audio: MEDIA }] }]) })
        : res({}))))

    preparePronunciation('conflate')
    await flush()

    expect(JSON.parse(localStorage.getItem(AUDIO_URLS) ?? '{}')['conflate']).toBe(MEDIA)
  })
})
