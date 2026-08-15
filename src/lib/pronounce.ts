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
 * **A resolved recording is not a playable one**, and conflating the two
 * kept this bug alive through three fixes. Measured against the live
 * services on 2026-08-05: every api.dictionaryapi.dev media mp3 returns 502
 * (conflate, inflate, abrogate, ubiquitous, cat — the entire host), while
 * its JSON API still advertises those URLs and youdao still serves real
 * audio. Tier 1 therefore resolves and then fails at the `<audio>` element
 * (MEDIA_ERR_SRC_NOT_SUPPORTED, confirmed in-browser). Two rules follow,
 * and both are load-bearing:
 *
 * - **A failure at any rung falls to the next rung, never to the bottom.**
 *   The error path used to call speak() directly, so a dead tier 1 skipped
 *   the working tier 2 and landed on the one engine that says "con f late".
 * - **Nothing is remembered until its body has actually arrived**, and a
 *   URL that fails at playback is forgotten. The map lives in localStorage
 *   and prepare() early-returns on `key in map`, so a URL recorded once is
 *   never re-examined — a dead entry written in June survives every later
 *   code fix, which is precisely why shipping one appeared to change
 *   nothing.
 *
 * A third rule guards the same bottom rung from the other side: **only a
 * real failure counts as one.** Restarting a clip interrupts the previous
 * one, and an interrupted play() rejects — so for as long as that read as a
 * failure, tapping the speak button twice made the local engine read the
 * word over the top of the restart. See the guards on play().
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
 * Drops a remembered URL that turned out not to play.
 *
 * Deleting rather than overwriting with the server voice is deliberate: an
 * absent key is the one state prepare() will look at again, so if the media
 * host comes back the human recording returns on its own.
 */
function forgetUrl(key: string): void {
  const map = readUrlMap()
  if (!(key in map)) return
  delete map[key]
  writeUrlMap(map)
}

/**
 * Whether the body is really there, warming the cache with it on the way.
 *
 * The verdict comes from the fetch alone; cache warming is best-effort on
 * top. Deciding reachability inside the same try as the Cache API would let
 * a storage hiccup condemn a perfectly good recording.
 */
async function bodyArrives(url: string): Promise<boolean> {
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    return false
  }
  if (!res.ok) return false
  try {
    if ('caches' in window) {
      const cache = await caches.open(AUDIO_CACHE)
      if ((await cache.match(url)) === undefined) await cache.put(url, res.clone())
    }
  } catch { /* the recording is still good; only the offline copy is missing */ }
  return true
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
 * A dictionaryapi URL is only recorded once its body has actually been
 * fetched — see bodyArrives. That host sends CORS headers, so the check is
 * readable; youdao does not, which is why its bodies are never fetched here
 * and instead enter the cache through the service worker's runtime rule the
 * first time one is played.
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
      const found = res.ok ? pickAudioUrl(await res.json()) : null
      // Verified before it is trusted, and the fetch doubles as the warm-up
      // that makes the recording replayable offline. An advertised URL whose
      // body 502s must never reach the map: prepare() never looks at a key
      // twice, so recording one is permanent.
      const url = found !== null && await bodyArrives(found) ? found : youdaoUrl(key)
      const m = readUrlMap()
      m[key] = url
      writeUrlMap(m)
    } catch { /* offline or blocked — retry on a future mount */ }
  })().finally(() => pending.delete(key))
  pending.set(key, job)
}

/** The recording currently playing, so a re-tap restarts instead of overlapping — the same job speechSynthesis.cancel() does for TTS. */
let playing: HTMLAudioElement | null = null

/**
 * Plays one URL, calling `onFail` if it doesn't start.
 *
 * Two guards, each for a different way of reaching `onFail` twice or wrongly:
 *
 * - **One flag for both handlers.** A failed load can reject play() AND fire
 *   onerror, and without the flag the fallback ran twice. Measured in the
 *   browser — a blocked mp3 produced two TTS utterances.
 * - **A superseded element's failure is not this play's failure.** The
 *   `pause()` above is *this module interrupting itself*, and in Chrome
 *   pausing an element whose play() has not settled yet rejects that promise
 *   with AbortError ("The play() request was interrupted by a call to
 *   pause()"). Nothing distinguished that from "this recording won't play",
 *   so an ordinary re-tap during loading dropped straight to the bottom rung
 *   — the one engine this whole file exists to route around — and layered it
 *   over the restarted clip. Measured in Chrome with two taps 0ms apart:
 *   Microsoft David begins reading at 24ms while the replacement youdao clip
 *   is still fetching and only becomes audible at 435ms. Comparing against
 *   `playing` rather than sniffing `err.name` also covers the onerror half,
 *   and needs no error-string matching.
 */
function play(url: string, onFail: () => void): void {
  playing?.pause()
  const audio = new Audio(url)
  playing = audio
  let failed = false
  const fail = () => {
    if (failed || playing !== audio) return
    failed = true
    onFail()
  }
  audio.onerror = fail
  void audio.play().catch(fail)
}

/**
 * Says the word, descending the ladder one rung at a time.
 *
 * Synchronous by contract — see the module comment; every URL it might
 * reach is either already in the map or derivable from the headword.
 *
 * The rung that matters is the middle one. A remembered recording that
 * won't play is not a reason to drop to local synthesis — that engine is
 * the whole problem this file exists to route around — so the server voice
 * is tried first, and the dead URL is forgotten on the way past so the next
 * tap doesn't repeat the failed request.
 */
export function pronounce(headword: string): void {
  const key = norm(headword)
  const known = readUrlMap()[key]
  const server = youdaoUrl(headword)
  // An unknown word is not a reason to fall back to the broken local
  // engine: the server-voice URL needs no lookup, so play that now and let
  // the prepare (kicked below) upgrade the map to a human recording for
  // next time. A legacy `null` (recorded back when "no dictionary audio"
  // meant "use TTS") takes the same path.
  const url = typeof known === 'string' ? known : server
  if (typeof known !== 'string') preparePronunciation(headword)

  // Silence both channels before starting: a replay tapped mid-playback
  // must restart the word, not layer a second copy over the first.
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()

  const lastResort = () => speak(headword)
  if (url === server) {
    play(server, lastResort)
    return
  }
  play(url, () => {
    forgetUrl(key)
    play(server, lastResort)
  })
}
