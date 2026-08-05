import { describe, expect, it } from 'vitest'
import { pickVoice, scoreVoice } from './tts'

/** Only the fields the scoring reads; the real interface carries more. */
const voice = (lang: string, over: Partial<SpeechSynthesisVoice> = {}): SpeechSynthesisVoice =>
  ({ lang, name: lang, default: false, localService: false, voiceURI: lang, ...over }) as SpeechSynthesisVoice

describe('scoreVoice', () => {
  it('refuses every non-English voice outright', () => {
    // The bug this exists to prevent: a Chinese voice handed an English
    // headword reads it in pieces — "conflate" as "con f late".
    expect(scoreVoice(voice('zh-CN', { default: true, localService: true }))).toBe(0)
    expect(scoreVoice(voice('ja-JP'))).toBe(0)
  })

  it('prefers American English, since the phonetics in this app are American', () => {
    expect(scoreVoice(voice('en-US'))).toBeGreaterThan(scoreVoice(voice('en-GB')))
  })

  it('prefers a local voice over one that needs the network', () => {
    expect(scoreVoice(voice('en-US', { localService: true })))
      .toBeGreaterThan(scoreVoice(voice('en-US', { localService: false })))
  })

  it('handles the underscore form some platforms report', () => {
    expect(scoreVoice(voice('en_US'))).toBe(scoreVoice(voice('en-US')))
  })

  it('any English voice still beats none', () => {
    expect(scoreVoice(voice('en-AU'))).toBeGreaterThan(0)
  })
})

describe('pickVoice', () => {
  it('picks the best English voice rather than the first one in the list', () => {
    // The old code took the first `en*` it found, which is whatever order the
    // platform happened to return.
    const list = [voice('en-GB'), voice('zh-CN'), voice('en-US', { localService: true })]
    expect(pickVoice(list)?.lang).toBe('en-US')
  })

  it('returns null rather than a non-English voice', () => {
    expect(pickVoice([voice('zh-CN', { default: true }), voice('ja-JP')])).toBeNull()
  })

  it('returns null for an empty list — this is the state on the first call, before voices load', () => {
    expect(pickVoice([])).toBeNull()
  })

  it('falls back to a non-US English voice when that is all there is', () => {
    expect(pickVoice([voice('zh-CN'), voice('en-GB')])?.lang).toBe('en-GB')
  })
})
