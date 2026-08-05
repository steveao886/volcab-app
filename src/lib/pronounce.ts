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
 * dictionaryapi.dev serves recorded human pronunciations for most of it
 * (conflate-us.mp3 exists; abrogate has none), and the app already depends
 * on that API for the add-word form. So: play the recording when one is
 * known, fall back to TTS when it isn't, and never block on the network at
 * tap time.
 *
 * iOS shapes the design: audio must start inside a user gesture, so
 * `pronounce()` is synchronous — it plays only what is already prepared.
 * Callers with a mount point (the review card, the audio quiz) call
 * `preparePronunciation()` when the word appears, so the recording is
 * usually ready before the first tap. When it isn't, that tap falls back
 * to TTS and the fetch keeps running for the next one.
 */

/** localStorage key for the headword → audio URL map. Not in lib/storage.ts's KEYS: that registry is for sync/session state the logout path must clear, and a pronunciation cache should survive logout. */
const URL_CACHE_KEY = 'volcab.audioUrls'
/** Cache API bucket for the mp3 bodies themselves, so a once-heard word replays offline. */
const AUDIO_CACHE = 'volcab-pronunciations'

/** null = looked up, no recording exists (TTS is the answer); absent = never looked up. */
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
 * Phrases are skipped outright: the dictionary has no audio for "bite the
 * bullet", and unlike single C1/C2 words, a phrase is made of words every
 * TTS lexicon knows, so synthesis is already acceptable there.
 */
export function preparePronunciation(headword: string): void {
  const key = norm(headword)
  if (key === '' || /\s/.test(key)) return
  if (!navigator.onLine) return
  const map = readUrlMap()
  if (key in map || pending.has(key)) return

  const job = (async () => {
    try {
      const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`)
      // 404 is a real answer (word not in their dictionary): record "no
      // recording" so it isn't asked again. Other failures stay unrecorded
      // and retry on a later mount.
      if (!res.ok && res.status !== 404) return
      const url = res.ok ? pickAudioUrl(await res.json()) : null
      const m = readUrlMap()
      m[key] = url
      writeUrlMap(m)
      // Pull the body into the cache now, while we're certainly online —
      // this is what makes the recording replayable offline later.
      if (url !== null && 'caches' in window) {
        const cache = await caches.open(AUDIO_CACHE)
        if ((await cache.match(url)) === undefined) await cache.add(url)
      }
    } catch { /* offline or blocked — retry on a future mount */ }
  })().finally(() => pending.delete(key))
  pending.set(key, job)
}

/**
 * Says the word: the known recording if there is one, TTS otherwise.
 *
 * Synchronous by contract — see the module comment. The `onerror` fallback
 * covers the gap where a URL is known but the body isn't reachable (cache
 * evicted, offline, CDN down): a wrong-sounding word is still better than
 * a silent button.
 */
/** The recording currently playing, so a re-tap restarts instead of overlapping — the same job speechSynthesis.cancel() does for TTS. */
let playing: HTMLAudioElement | null = null

export function pronounce(headword: string): void {
  const url = readUrlMap()[norm(headword)]
  if (typeof url === 'string') {
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
    return
  }
  if (url === undefined) preparePronunciation(headword)  // unknown yet: warm it for next time
  speak(headword)
}
