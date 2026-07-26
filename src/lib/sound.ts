import type { Grade } from '../types'

/**
 * 音效模块(spec §3)。Web Audio 现场合成,不引入音频文件——省授权、不增加
 * Service Worker 预缓存体积、天然离线可用。对外只暴露语义化函数
 * (playGrade / playQuizResult / playSessionDone),调用方不接触 Web Audio。
 *
 * 发声只在三处(spec §3.2):四个打分键、测验判对/判错、复习会话完成。
 * 翻面与底部导航切换刻意不发声——每张卡都要翻,加音会迅速变成噪音,
 * 所以这三个函数之外不应该再新增调用点。
 *
 * 默认开启,由调用方通过 progress.settings.soundEnabled 算出 enabled 后
 * 显式传入每次调用——本模块不碰全局状态,保持纯粹、可测。
 *
 * iOS 的 AudioContext 必须在用户手势的调用栈内创建/resume,否则以后静默
 * 失效(此类功能最常见的失败模式)。三个 play* 函数只会从按钮点击/键盘
 * 打分等手势处理器里同步调用到 tone(),context 的创建与 resume() 都发生
 * 在同一个调用栈内,因此不需要另外暴露一个"解锁"入口——首次真实交互
 * 本身就是第一次 playGrade/playQuizResult 调用。
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
 * 仅供测试注入假的 AudioContext 工厂,断言调用了什么节点/参数,而不是
 * 真的产生声音——happy-dom 没有 Web Audio,这也是测试套件实际运行的环境。
 * 传 null 恢复默认工厂。无论哪种情况都会清空已缓存的实例,保证下一次
 * 播放走的是新工厂,而不是上一个测试留下的假 context。
 */
export function setAudioContextFactory(f: AudioContextFactory | null): void {
  factory = f ?? createDefaultContext
  cached = null
}

/**
 * 惰性创建并缓存一个共享 AudioContext。工厂不可用(happy-dom、不支持
 * Web Audio 的浏览器、iOS 隐私模式限制等)时返回 null,由调用方静默降级——
 * 音效永远不该抛错打断真正的交互。
 */
function getContext(): AudioContext | null {
  if (!cached) {
    try {
      cached = factory()
    } catch {
      return null
    }
  }
  // iOS 要求 resume() 发生在用户手势的调用栈内;playGrade / playQuizResult /
  // playSessionDone 只会从点击、按键等手势处理器同步调用到这里,满足这个
  // 条件。resume() 本身是异步的,不等待、不阻塞后续的节点创建与播放。
  if (cached.state === 'suspended') {
    void cached.resume().catch(() => {})
  }
  return cached
}

interface ToneOptions {
  type?: OscillatorType
  /** 峰值增益,默认 0.12——安静,不与系统提示音混淆 */
  gain?: number
  delayMs?: number
}

/**
 * 单个短音:百毫秒量级,10ms 线性淡入避免起振咔哒声,随后指数衰减到
 * 近零。所有音效相关的 Web Audio 细节全部收在这一个函数里。
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
    // 节点创建/参数异常:吞掉。声音是装饰,绝不能让它崩掉一次打分或判题。
  }
}

/** progress.settings.soundEnabled 缺省(旧数据、尚未同步过该字段的设备)视为开启。 */
export function isSoundEnabled(settings: { soundEnabled?: boolean }): boolean {
  return settings.soundEnabled ?? true
}

/**
 * 打分四档音高上行:重来(暗/低)→ 困难 → 良好 → 简单(亮/高),
 * 与既有的热→冷四色温度带一一对应(--grade-again 为 danger,
 * --grade-easy 为 info,见 tokens.css)。音符取五度音程内的四个自然音,
 * 级进上行但不刺耳。
 */
const GRADE_FREQ: Record<Grade, number> = {
  again: 220, // A3 — 最暗、最低
  hard: 262, // C4
  good: 349, // F4
  easy: 440, // A4 — 最亮、最高
}

export function playGrade(grade: Grade, enabled: boolean): void {
  if (!enabled) return
  tone(GRADE_FREQ[grade], 90)
}

/** 判对/判错用音色(正弦 vs 方波)与音高双重区分,不止一个维度不同。 */
export function playQuizResult(correct: boolean, enabled: boolean): void {
  if (!enabled) return
  if (correct) tone(660, 90)
  else tone(196, 130, { type: 'square', gain: 0.09 })
}

/** 会话完成:比单个打分音更长的两音上行,收尾感明确但依旧克制。 */
export function playSessionDone(enabled: boolean): void {
  if (!enabled) return
  tone(440, 110)
  tone(660, 160, { delayMs: 100 })
}
