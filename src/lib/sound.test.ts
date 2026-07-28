import { afterEach, describe, expect, it, vi } from 'vitest'
import { isSoundEnabled, playGrade, playQuizResult, playSessionDone, setAudioContextFactory } from './sound'

/**
 * Does not assert "what was heard" — happy-dom has no Web Audio, so asserting audio output is
 * neither possible nor meaningful (the ear is the real acceptance check, see spec §3.4, which
 * requires verification on a real device).
 * This file only tests three things that are testable and worth testing:
 *  1. When disabled, AudioContext is never touched at all (a true no-op, not "plays but muted")
 *  2. It never throws when AudioContext is unavailable (happy-dom is exactly that environment,
 *     and it's also the environment the suite actually runs in — it must degrade gracefully
 *     instead of crashing)
 *  3. The on/off check correctly reads soundEnabled (undefined counts as true)
 * The factory is injected via setAudioContextFactory, and the assertions are about "which
 * nodes/parameters were called," not about actually producing sound.
 */

interface FakeGainParam {
  setValueAtTime: ReturnType<typeof vi.fn>
  linearRampToValueAtTime: ReturnType<typeof vi.fn>
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>
}

interface FakeOscillator {
  type: OscillatorType
  frequency: { value: number }
  connect: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

interface FakeGain {
  gain: FakeGainParam
  connect: ReturnType<typeof vi.fn>
}

function makeFakeContext(state: AudioContextState = 'running') {
  const oscillators: FakeOscillator[] = []
  const gains: FakeGain[] = []
  const resume = vi.fn().mockResolvedValue(undefined)
  const createOscillator = vi.fn((): FakeOscillator => {
    const osc: FakeOscillator = {
      type: 'sine',
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }
    oscillators.push(osc)
    return osc
  })
  const createGain = vi.fn((): FakeGain => {
    const gain: FakeGain = {
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    }
    gains.push(gain)
    return gain
  })
  const ctx = {
    state,
    currentTime: 0,
    destination: {},
    resume,
    createOscillator,
    createGain,
  }
  return { ctx: ctx as unknown as AudioContext, oscillators, gains, resume, createOscillator, createGain }
}

afterEach(() => {
  setAudioContextFactory(null)
})

describe('isSoundEnabled', () => {
  it('undefined counts as enabled (old data / a device that has not synced this field yet)', () => {
    expect(isSoundEnabled({})).toBe(true)
  })
  it('explicit true is enabled', () => {
    expect(isSoundEnabled({ soundEnabled: true })).toBe(true)
  })
  it('explicit false is disabled', () => {
    expect(isSoundEnabled({ soundEnabled: false })).toBe(false)
  })
})

describe('no-op when disabled', () => {
  it('playGrade(enabled=false) never touches AudioContext', () => {
    const factory = vi.fn()
    setAudioContextFactory(factory)
    playGrade('good', false)
    expect(factory).not.toHaveBeenCalled()
  })

  it('playQuizResult(enabled=false) never touches AudioContext', () => {
    const factory = vi.fn()
    setAudioContextFactory(factory)
    playQuizResult(true, false)
    playQuizResult(false, false)
    expect(factory).not.toHaveBeenCalled()
  })

  it('playSessionDone(enabled=false) never touches AudioContext', () => {
    const factory = vi.fn()
    setAudioContextFactory(factory)
    playSessionDone(false)
    expect(factory).not.toHaveBeenCalled()
  })
})

describe('graceful degradation when AudioContext is unavailable', () => {
  it('the factory throws (the real situation when happy-dom lacks Web Audio): none of the three functions throw', () => {
    setAudioContextFactory(() => {
      throw new Error('AudioContext is not defined')
    })
    expect(() => playGrade('again', true)).not.toThrow()
    expect(() => playQuizResult(true, true)).not.toThrow()
    expect(() => playQuizResult(false, true)).not.toThrow()
    expect(() => playSessionDone(true)).not.toThrow()
  })

  it('also does not throw when no factory is injected and it falls back to the missing global window.AudioContext (happy-dom\'s default state)', () => {
    expect(() => playGrade('easy', true)).not.toThrow()
  })

  it('an error thrown during node creation does not propagate out', () => {
    const { ctx, createOscillator } = makeFakeContext()
    createOscillator.mockImplementation(() => {
      throw new Error('boom')
    })
    setAudioContextFactory(() => ctx)
    expect(() => playGrade('good', true)).not.toThrow()
  })
})

describe('actually produces sound when enabled (asserts calls, not perceived sound)', () => {
  it('playGrade creates an oscillator and gain node, and calls start/stop', () => {
    const { ctx, oscillators, gains } = makeFakeContext()
    setAudioContextFactory(() => ctx)
    playGrade('good', true)
    expect(oscillators).toHaveLength(1)
    expect(gains).toHaveLength(1)
    expect(oscillators[0].connect).toHaveBeenCalledWith(gains[0])
    expect(gains[0].connect).toHaveBeenCalledWith(ctx.destination)
    expect(oscillators[0].start).toHaveBeenCalled()
    expect(oscillators[0].stop).toHaveBeenCalled()
  })

  it('the four grading tones rise strictly in pitch (again < hard < good < easy), matching a hot-to-cool temperature scale', () => {
    const grades = ['again', 'hard', 'good', 'easy'] as const
    const freqs = grades.map(g => {
      const { ctx, oscillators } = makeFakeContext()
      setAudioContextFactory(() => ctx)
      playGrade(g, true)
      return oscillators[0].frequency.value
    })
    expect(freqs[0]).toBeLessThan(freqs[1])
    expect(freqs[1]).toBeLessThan(freqs[2])
    expect(freqs[2]).toBeLessThan(freqs[3])
  })

  it('quiz correct and incorrect results are distinguishable by timbre/pitch', () => {
    const correctCtx = makeFakeContext()
    setAudioContextFactory(() => correctCtx.ctx)
    playQuizResult(true, true)

    const wrongCtx = makeFakeContext()
    setAudioContextFactory(() => wrongCtx.ctx)
    playQuizResult(false, true)

    const correctOsc = correctCtx.oscillators[0]
    const wrongOsc = wrongCtx.oscillators[0]
    const distinguishable =
      correctOsc.type !== wrongOsc.type || correctOsc.frequency.value !== wrongOsc.frequency.value
    expect(distinguishable).toBe(true)
  })

  it('playSessionDone is longer/more complex than a single grading tone: it triggers at least one sound', () => {
    const { ctx, oscillators } = makeFakeContext()
    setAudioContextFactory(() => ctx)
    playSessionDone(true)
    expect(oscillators.length).toBeGreaterThanOrEqual(1)
  })

  it('attempts to resume when AudioContext is suspended (iOS not yet unlocked) — this is the only fix for iOS\'s silent failure', () => {
    const { ctx, resume } = makeFakeContext('suspended')
    setAudioContextFactory(() => ctx)
    playGrade('again', true)
    expect(resume).toHaveBeenCalled()
  })
})
