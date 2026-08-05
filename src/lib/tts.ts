/**
 * Speaking a headword aloud.
 *
 * This file is shaped by one trap: **`getVoices()` is asynchronous and
 * returns an empty array on the first call.** Measured in this app — 0
 * voices immediately after load, 6 about 1.5 seconds later. The original
 * code called it inline on every `speak()`, so any pronunciation played
 * before the list arrived set no `voice` at all and left the platform to
 * choose. On a Chinese-locale machine, where the installed voices are en-US
 * *and* zh-CN, that choice can land on a Chinese voice, which reads an
 * unrecognised English word by chopping it into pieces — "conflate" comes
 * out as "con f late" instead of /kənˈfleɪt/.
 *
 * So the voice is resolved once at module load, refreshed on
 * `voiceschanged`, and re-resolved on demand if it is still missing. The
 * call itself stays synchronous: iOS only allows speech started inside a
 * user gesture, so awaiting anything here would trade one bug for a worse
 * one.
 */

/**
 * How suitable a voice is for reading an English headword.
 *
 * Higher is better; anything not English scores 0 and is never selected — a
 * Chinese voice reading English is the exact failure this exists to
 * prevent, and leaving the platform to its own default is better than
 * actively choosing that.
 */
export function scoreVoice(v: SpeechSynthesisVoice): number {
  // Some platforms report en_US with an underscore.
  const lang = v.lang.replace('_', '-').toLowerCase()
  if (!lang.startsWith('en')) return 0
  let score = 1
  // The app's phonetics are American throughout, so the accent should match.
  if (lang === 'en-us') score += 4
  // A local voice needs no network and starts without a round trip, which
  // matters on a card you tap and expect to hear immediately.
  if (v.localService) score += 2
  if (v.default) score += 1
  return score
}

/** The best English voice available, or null when the device has none — or has not loaded them yet. */
export function pickVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  let best: SpeechSynthesisVoice | null = null
  let bestScore = 0
  for (const v of voices) {
    const s = scoreVoice(v)
    if (s > bestScore) { bestScore = s; best = v }
  }
  return best
}

let cached: SpeechSynthesisVoice | null = null

function refreshVoice(): void {
  cached = pickVoice(window.speechSynthesis.getVoices())
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  // Warmed at app start so the list has almost always arrived by the time a
  // card is on screen; voiceschanged then keeps it correct if the platform
  // adds voices later.
  refreshVoice()
  window.speechSynthesis.addEventListener('voiceschanged', refreshVoice)
}

export function speak(text: string): void {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'en-US'
  u.rate = 0.9
  // Re-resolve when the warm-up ran before the list existed and no
  // voiceschanged has fired yet. Cheap, and it is the difference between a
  // correct reading and a mangled one.
  if (cached === null) refreshVoice()
  if (cached !== null) u.voice = cached
  window.speechSynthesis.speak(u)
}
