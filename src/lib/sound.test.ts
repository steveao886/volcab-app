import { afterEach, describe, expect, it, vi } from 'vitest'
import { isSoundEnabled, playGrade, playQuizResult, playSessionDone, setAudioContextFactory } from './sound'

/**
 * 不断言"听到了什么"——happy-dom 没有 Web Audio,断言音频输出无从谈起,
 * 也没有意义(耳朵才是真正的验收,见 spec §3.4,须真机验证)。
 * 这里只测三件可测、有价值的事:
 *  1. 关闭时彻底不碰 AudioContext(no-op,不是"播放但静音")
 *  2. AudioContext 不可用时绝不抛错(happy-dom 正是这种环境,也是套件实际
 *     运行的环境——必须优雅降级而不是崩溃)
 *  3. 开关判定正确读取 soundEnabled(undefined 视为 true)
 * 工厂通过 setAudioContextFactory 注入,断言的是"调用了什么节点/参数",
 * 不是真的产生声音。
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
  it('undefined 视为开启(旧数据 / 尚未同步过该字段的设备)', () => {
    expect(isSoundEnabled({})).toBe(true)
  })
  it('显式 true 为开启', () => {
    expect(isSoundEnabled({ soundEnabled: true })).toBe(true)
  })
  it('显式 false 为关闭', () => {
    expect(isSoundEnabled({ soundEnabled: false })).toBe(false)
  })
})

describe('关闭时的 no-op', () => {
  it('playGrade(enabled=false) 完全不碰 AudioContext', () => {
    const factory = vi.fn()
    setAudioContextFactory(factory)
    playGrade('good', false)
    expect(factory).not.toHaveBeenCalled()
  })

  it('playQuizResult(enabled=false) 完全不碰 AudioContext', () => {
    const factory = vi.fn()
    setAudioContextFactory(factory)
    playQuizResult(true, false)
    playQuizResult(false, false)
    expect(factory).not.toHaveBeenCalled()
  })

  it('playSessionDone(enabled=false) 完全不碰 AudioContext', () => {
    const factory = vi.fn()
    setAudioContextFactory(factory)
    playSessionDone(false)
    expect(factory).not.toHaveBeenCalled()
  })
})

describe('AudioContext 不可用时优雅降级', () => {
  it('工厂抛错(happy-dom 没有 Web Audio 时的真实情况):三个函数都不抛', () => {
    setAudioContextFactory(() => {
      throw new Error('AudioContext is not defined')
    })
    expect(() => playGrade('again', true)).not.toThrow()
    expect(() => playQuizResult(true, true)).not.toThrow()
    expect(() => playQuizResult(false, true)).not.toThrow()
    expect(() => playSessionDone(true)).not.toThrow()
  })

  it('未注入任何工厂、依赖全局 window.AudioContext 缺失时也不抛(happy-dom 的默认状态)', () => {
    expect(() => playGrade('easy', true)).not.toThrow()
  })

  it('节点创建过程中抛错也不冒泡出去', () => {
    const { ctx, createOscillator } = makeFakeContext()
    createOscillator.mockImplementation(() => {
      throw new Error('boom')
    })
    setAudioContextFactory(() => ctx)
    expect(() => playGrade('good', true)).not.toThrow()
  })
})

describe('开启时实际发声(断言调用,不断言听感)', () => {
  it('playGrade 创建振荡器与增益节点,并 start/stop', () => {
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

  it('四档打分音音高严格上行(重来 < 困难 < 良好 < 简单),对应热→冷温度带', () => {
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

  it('测验判对与判错在音色/音高上可区分', () => {
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

  it('playSessionDone 比单个打分音更长/更复杂:至少触发一次发声', () => {
    const { ctx, oscillators } = makeFakeContext()
    setAudioContextFactory(() => ctx)
    playSessionDone(true)
    expect(oscillators.length).toBeGreaterThanOrEqual(1)
  })

  it('AudioContext 处于 suspended(iOS 未解锁)时会尝试 resume——这是 iOS 静默失败的唯一解法', () => {
    const { ctx, resume } = makeFakeContext('suspended')
    setAudioContextFactory(() => ctx)
    playGrade('again', true)
    expect(resume).toHaveBeenCalled()
  })
})
