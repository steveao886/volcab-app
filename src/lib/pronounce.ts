import { speak } from './tts'

/**
 * Pronunciation with a real recording first, synthesis second.
 *
 * The TTS engines this app can reach read the headword **text** through
 * their own letter-to-sound rules — the stored IPA is display-only, and the
 * Web Speech API has no phoneme input (browsers ignore SSML), so there is
 * no way to make an engine follow the phonetic. That went wrong in a way
 * voice selection cannot fix: measured with muted utterances on this
 * machine, Microsoft David takes 2022ms to say "conflate" against 1433ms
 * for "inflate" — longer than the 1976ms it takes to spell out "bcdfg" —
 * because the word is simply missing from the engine's lexicon, so it gets
 * chopped into pieces ("con f late"). A C1/C2 vocabulary is precisely the
 * register an aging offline lexicon is missing.
 *
 * The ladder, best voice first:
 * 1. a dictionaryapi.dev **human recording** (conflate-us.mp3 exists;
 *    abrogate has none) — resolved by preparePronunciation and remembered;
 * 2. **youdao's server TTS** (see youdaoUrl below) — correct for
 *    everything, constructible without a lookup, so it is both the gap
 *    filler and what an unprepared tap plays;
 * 3. local speechSynthesis — only when playback itself fails, i.e. fully
 *    offline on a never-cached word. A wrong-sounding word beats a silent
 *    button, and offline is the one place nothing better exists.
 *
 * iOS shapes the design: audio must start inside a user gesture, so
 * `pronounce()` is synchronous and never awaits — every URL it might play
 * is either already in the map or derivable from the headword alone.
 * Callers with a mount point (the review card, the audio quiz) call
 * `preparePronunciation()` when the word appears, which upgrades later
 * plays to the human recording.
 */

/** localStorage key for the headword → audio URL map. Not in lib/storage.ts's KEYS: that registry is for sync/session state the logout path must clear, and a pronunciation cache should survive logout. */
const URL_CACHE_KEY = 'volcab.audioUrls'
/** Cache API bucket for the mp3 bodies themselves, so a once-heard word replays offline. */
const AUDIO_CACHE = 'volcab-pronunciations'

/**
 * Server-side TTS with a full lexicon, as the second tier below a human
 * recording. type=2 is the American voice, matching the library's phonetics.
 *
 * This exists because the first shipped version of this file still fell
 * back to local synthesis whenever no human recording was known — which is
 * exactly the engine that chops "conflate" into pieces, so the listening
 * quiz's auto-play (always the word's first encounter) stayed broken, and
 * words dictionaryapi has no audio for (abrogate) stayed broken forever.
 * Youdao's endpoint pronounces everything correctly, phrases included
 * (verified: conflate, abrogate, "bite the bullet" all return real audio),
 * and the URL is constructible **synchronously from the headword alone** —
 * no lookup — which is what lets pronounce() play something correct inside
 * the user gesture even for a word it has never seen. Local speechSynthesis
 * remains only as the fully-offline last resort, wired through the
 * playback-error fallback.
 */
export const youdaoUrl = (headword: string): string =>
  `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(norm(headword))}&type=2`

/** null = looked up, dictionaryapi has no recording (legacy value; treated the same as absent-but-known: youdao). absent = never looked up. */
type UrlMap = Record<string, string | null>

function readUrlMap(): UrlMap {
  try {
    const raw = localStorage.getItem(URL_CACHE_KEY)
    const v: unknown = raw === null ? {} : JSON.parse(raw)
    return typeof v === 'object' && v !== null ? (v as UrlMap) : {}
  } catch {
    return {}
  }
}

function writeUrlMap(map: UrlMap): void {
  try { localStorage.setItem(URL_CACHE_KEY, JSON.stringify(map)) } catch { /* quota — the cache is an optimisation, not state */ }
}

/**
 * Picks the recording to use from a dictionaryapi.dev response.
 *
 * Prefers `-us` audio because every phonetic in this library is American;
 * otherwise takes the first non-empty URL. Returns null when the entry has
 * no audio at all — a real case (abrogate), and the reason TTS stays.
 * Exported for tests.
 */
export function pickAudioUrl(data: unknown): string | null {
  if (!Array.isArray(data)) return null
  const urls: string[] = []
  for (const entry of data) {
    const phonetics = (entry as { phonetics?: unknown }).phonetics
    if (!Array.isArray(phonetics)) continue
    for (const p of phonetics) {
      const audio = (p as { audio?: unknown }).audio
      if (typeof audio === 'string' && audio !== '') urls.push(audio)
    }
  }
  return urls.find(u => /-us\.[a-z0-9]+$/i.test(u)) ?? urls[0] ?? null
}

/** In-flight lookups, so a card that mounts twice doesn't fetch twice. */
const pending = new Map<string, Promise<void>>()

const norm = (s: string): string => s.trim().toLowerCase()

/**
 * Resolves and caches the recording for a headword, without playing it.
 *
 * Phrases skip the dictionary lookup — it has no audio for "bite the
 * bullet" — and go straight to youdao, which pronounces connected phrases
 * properly. For single words, a dictionaryapi human recording is preferred
 * and youdao fills every gap (404, or an entry with no audio), so the map
 * never records "nothing to play" any more.
 *
 * Only dictionaryapi bodies are pre-pulled into the cache here: that host
 * sends CORS headers, so cache.add works. Youdao doesn't, and a cors-mode
 * fetch of it would reject — its bodies enter the same cache via the
 * service worker's runtime rule the first time one is played instead.
 */
export function preparePronunciation(headword: string): void {
  const key = norm(headword)
  if (key === '') return
  const map = readUrlMap()
  if (/\s/.test(key)) {
    if (!(key in map)) { map[key] = youdaoUrl(key); writeUrlMap(map) }
    return
  }
  if (!navigator.onLine) return
  if (key in map || pending.has(key)) return

  const job = (async () => {
    try {
      const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`)
      // 404 is a real answer (word not in their dictionary): settle on the
      // server voice so it isn't asked again. Other failures stay
      // unrecorded and retry on a later mount.
      if (!res.ok && res.status !== 404) return
      const url = (res.ok ? pickAudioUrl(await res.json()) : null) ?? youdaoUrl(key)
      const m = readUrlMap()
      m[key] = url
      writeUrlMap(m)
      // Pull the body into the cache now, while we're certainly online —
      // this is what makes the recording replayable offline later.
      if (url.startsWith('https://api.dictionaryapi.dev/') && 'caches' in window) {
        const cache = await caches.open(AUDIO_CACHE)
        if ((await cache.match(url)) === undefined) await cache.add(url)
      }
    } catch { /* offline or blocked — retry on a future mount */ }
  })().finally(() => pending.delete(key))
  pending.set(key, job)
}

/**
 * Says the word: the known human recording if there is one, the server
 * voice otherwise. Local TTS only through the playback-error fallback.
 *
 * Synchronous by contract — see the module comment. The `onerror` fallback
 * covers the gap where a URL exists but the body isn't reachable (cache
 * evicted, offline, CDN down): a wrong-sounding word is still better than
 * a silent button.
 */
/** The recording currently playing, so a re-tap restarts instead of overlapping — the same job speechSynthesis.cancel() does for TTS. */
let playing: HTMLAudioElement | null = null

export function pronounce(headword: string): void {
  const known = readUrlMap()[norm(headword)]
  // An unknown word is not a reason to fall back to the broken local
  // engine: the server-voice URL needs no lookup, so play that now and let
  // the prepare (kicked below) upgrade the map to a human recording for
  // next time. A legacy `null` (recorded back when "no dictionary audio"
  // meant "use TTS") takes the same path.
  const url = typeof known === 'string' ? known : youdaoUrl(headword)
  if (typeof known !== 'string') preparePronunciation(headword)

  // Silence both channels before starting: a replay tapped mid-playback
  // must restart the word, not layer a second copy over the first.
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  playing?.pause()
  const audio = new Audio(url)
  playing = audio
  // One flag guarding both handlers: a failed load can reject play() AND
  // fire onerror, and without the guard the word was spoken twice.
  // Measured in the browser — a blocked mp3 produced two TTS utterances.
  let fellBack = false
  const fallBack = () => {
    if (fellBack) return
    fellBack = true
    speak(headword)
  }
  audio.onerror = fallBack
  void audio.play().catch(fallBack)
}
