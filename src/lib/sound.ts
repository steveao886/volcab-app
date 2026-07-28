import type { Grade } from '../types'

/**
 * The sound-effects module (spec §3). Synthesized live via Web Audio, no audio files
 * involved — saves on licensing, doesn't grow the Service Worker's precache size, and works
 * offline naturally. Only exposes semantic functions externally
 * (playGrade / playQuizResult / playSessionDone); callers never touch Web Audio directly.
 *
 * Sound plays in exactly three places (spec §3.2): the four grading buttons, quiz
 * correct/incorrect, and review session completion. Card flips and bottom-nav switches are
 * deliberately silent — every card gets flipped, and adding sound there would quickly turn
 * into noise — so no new call sites should be added beyond these three functions.
 *
 * Enabled by default; the caller computes `enabled` from progress.settings.soundEnabled and
 * passes it explicitly on every call — this module never touches global state, keeping it
 * pure and testable.
 *
 * iOS requires the AudioContext to be created/resumed within the call stack of a user
 * gesture, or it silently stops working later (the most common failure mode for this kind of
 * feature). The three play* functions are only ever called synchronously into tone() from
 * gesture handlers like button clicks or keyboard grading, so context creation and resume()
 * both happen within that same call stack — there's no need for a separate "unlock" entry
 * point, since the first real interaction is itself the first playGrade/playQuizResult call.
 */

export type AudioContextFactory = () => AudioContext

function createDefaultContext(): AudioContext {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) throw new Error('Web Audio API 不可用')
  return new Ctor()
}

let factory: AudioContextFactory = createDefaultContext
let cached: AudioContext | null = null

/**
 * For tests only, to inject a fake AudioContext factory so assertions can check what nodes
 * and parameters were called rather than actually producing sound — happy-dom has no Web
 * Audio, and that's the environment the test suite actually runs in. Pass null to restore
 * the default factory. Either way, the cached instance is cleared, guaranteeing the next
 * playback uses the new factory rather than a fake context left over from the previous test.
 */
export function setAudioContextFactory(f: AudioContextFactory | null): void {
  factory = f ?? createDefaultContext
  cached = null
}

/**
 * Lazily creates and caches a shared AudioContext. Returns null when the factory is
 * unavailable (happy-dom, a browser without Web Audio support, iOS private-mode
 * restrictions, etc.), letting the caller degrade silently — sound effects should never
 * throw and interrupt a real interaction.
 */
function getContext(): AudioContext | null {
  if (!cached) {
    try {
      cached = factory()
    } catch {
      return null
    }
  }
  // iOS requires resume() to happen within the call stack of a user gesture; playGrade /
  // playQuizResult / playSessionDone only ever reach here synchronously from gesture
  // handlers like clicks or keypresses, satisfying that condition. resume() itself is
  // async — this doesn't wait for it or let it block subsequent node creation and playback.
  if (cached.state === 'suspended') {
    void cached.resume().catch(() => {})
  }
  return cached
}

interface ToneOptions {
  type?: OscillatorType
  /** Peak gain, defaults to 0.12 — quiet, so it doesn't get confused with system notification sounds */
  gain?: number
  delayMs?: number
}

/**
 * A single short tone: on the order of a hundred milliseconds, with a 10ms linear fade-in
 * to avoid a startup click, followed by an exponential decay to near-zero. Every Web Audio
 * detail related to sound effects is contained in this one function.
 */
function tone(freq: number, durationMs: number, opts: ToneOptions = {}): void {
  const ctx = getContext()
  if (!ctx) return
  try {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = opts.type ?? 'sine'
    osc.frequency.value = freq
    const start = ctx.currentTime + (opts.delayMs ?? 0) / 1000
    const dur = durationMs / 1000
    const peak = opts.gain ?? 0.12
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(peak, start + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(start)
    osc.stop(start + dur + 0.02)
  } catch {
    // Node creation / parameter errors: swallowed. Sound is decoration, and must never crash a grading action or an answer check.
  }
}

/** A missing progress.settings.soundEnabled (legacy data, or a device that hasn't synced this field yet) is treated as enabled. */
export function isSoundEnabled(settings: { soundEnabled?: boolean }): boolean {
  return settings.soundEnabled ?? true
}

/**
 * Pitch rises across the four grades: again (dark/low) → hard → good → easy (bright/high),
 * matching the existing hot-to-cool four-color temperature band one-to-one (--grade-again
 * is danger, --grade-easy is info, see tokens.css). Notes are the four natural tones within
 * a perfect fifth, stepping upward without sounding harsh.
 */
const GRADE_FREQ: Record<Grade, number> = {
  again: 220, // A3 — darkest, lowest
  hard: 262, // C4
  good: 349, // F4
  easy: 440, // A4 — brightest, highest
}

export function playGrade(grade: Grade, enabled: boolean): void {
  if (!enabled) return
  tone(GRADE_FREQ[grade], 90)
}

/** Correct/incorrect are distinguished by both timbre (sine vs. square) and pitch — more than one dimension differs. */
export function playQuizResult(correct: boolean, enabled: boolean): void {
  if (!enabled) return
  if (correct) tone(660, 90)
  else tone(196, 130, { type: 'square', gain: 0.09 })
}

/** Session complete: a two-note rising phrase, longer than a single grading tone, giving a clear but still restrained sense of closure. */
export function playSessionDone(enabled: boolean): void {
  if (!enabled) return
  tone(440, 110)
  tone(660, 160, { delayMs: 100 })
}
