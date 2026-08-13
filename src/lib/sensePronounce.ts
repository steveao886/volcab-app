/**
 * Which sound each sense of a word should make.
 *
 * A heteronym has two pronunciations and the app can only fetch one. Both
 * recording sources in pronounce.ts key on spelling alone — youdao's dictvoice
 * takes no sense parameter, and dictionaryapi.dev returns a single audio for
 * presage (`presage-uk.mp3`) and a single one for indurate. So the second
 * pronunciation cannot be *fetched*; it can only be *synthesized*, from the
 * respelling authored in `Meaning.speakAs`.
 *
 * That asymmetry — one sense gets a person, the other gets a machine — is what
 * this module exists to arbitrate, and why the answer is computed per word
 * rather than per meaning.
 */

import type { Word } from '../types'

export interface SenseVoice {
  /**
   * `recording` plays the real audio for the headword via pronounce(); `synth`
   * reads a respelling via speak(). The distinction is not internal: the UI
   * marks a synthesized reading so the learner knows which of the two sounds
   * is a machine approximating and which is a person.
   */
  kind: 'recording' | 'synth'
  /** What to hand the player — the headword for a recording, the respelling for synth. */
  text: string
}

/**
 * One voice per meaning, positionally, or null for a meaning that gets no
 * button. Always the same length as `word.meanings`; call sites index it
 * against them, so a short array would silently drop the last button.
 *
 * All-or-nothing per word, and deliberately so. The three outcomes:
 *
 * 1. **No sense diverges** — every `phonetic` is absent or equal to the
 *    word-level one. All null. This is 521 of the library's 523 words, and 36
 *    of the 38 entries spanning more than one part of speech: multiple senses
 *    are not multiple pronunciations, which is the whole premise of
 *    lib/heteronym.ts. They render as they always have.
 *
 * 2. **A sense diverges but nobody wrote its respelling** — also all null,
 *    including the senses that would have worked. A button on the verb and
 *    nothing on the noun reads as "the noun has no pronunciation" rather than
 *    "nobody has written one yet"; falling back to the ordinary layout says
 *    nothing false. The validator makes this an error on the write side, but
 *    an older build on another device can still push it, so the read side
 *    fails closed too.
 *
 * 3. **Otherwise** — the divergent senses synthesize, everything else plays
 *    the recording, because the recording is what the word-level phonetic
 *    describes.
 *
 * Note that a `phonetic` *identical* to the word-level one counts as no
 * divergence. presage's verb sense carries exactly that: it looks like
 * per-sense data and tells you nothing new, and on its own it must not switch
 * the feature on. It still earns its place on screen once buttons exist —
 * that IPA is what labels which button makes which sound.
 */
export function senseVoices(word: Word): (SenseVoice | null)[] {
  // Positional against word.meanings: the respelling this sense needs, or
  // null when the word-level recording already covers it. An empty string is
  // the third state and the interesting one — this sense needs a respelling
  // and does not have one.
  const needed = word.meanings.map(m =>
    m.phonetic !== undefined && m.phonetic !== word.phonetic ? (m.speakAs ?? '').trim() : null,
  )
  const silent = word.meanings.map(() => null)

  if (needed.every(r => r === null)) return silent  // nothing diverges
  if (needed.some(r => r === '')) return silent     // something diverges unwritten

  return needed.map(r =>
    r === null
      ? { kind: 'recording' as const, text: word.headword }
      : { kind: 'synth' as const, text: r },
  )
}
