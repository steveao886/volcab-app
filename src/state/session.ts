import { storage } from '../lib/storage'
import { emptyProgress } from '../types'
import type { Progress, Word } from '../types'
import { isProgress, isWord, isWordsOp } from './sync'
import type { WordsOp } from './sync'

/**
 * localStorage 里的本机会话:缓存、待推送队列,以及由它们推导出的启动状态。
 *
 * 和 sync.ts 一样不依赖 React —— 「刷新后该进哪个 phase」「换账号登录时本地
 * 欠账怎么办」这两件事最容易写错又最难在组件里测,所以摘成纯函数。
 */

export interface BootSnapshot {
  phase: 'boot' | 'login' | 'ready'
  owner: string | null
  words: Word[]
  progress: Progress
}

/** 缓存形状不对就当没有,免得一份坏缓存把整个 App 带崩 */
export function cachedProgress(): Progress | null {
  const p = storage.get<unknown>('progress')
  return isProgress(p) ? p : null
}

export function cachedWords(): Word[] | null {
  const w = storage.get<unknown>('words')
  return Array.isArray(w) && w.length > 0 && w.every(isWord) ? w : null
}

/**
 * 尚未确认推上远端的词库增删。
 *
 * progress 用一个 dirty 布尔就够(整份重推),词库不行:冲突时要在重新拉回的
 * 远端副本上**重放具体动作**,所以必须留住动作本身。只存在内存里的话,推送
 * 失败后关掉页面,下次启动 boot 会拿远端覆盖本地缓存,这条改动就没了。
 */
export function pendingOps(): WordsOp[] {
  const raw = storage.get<unknown>('wordOps')
  if (!Array.isArray(raw)) return []
  return raw.filter(isWordsOp)
}

export function setPendingOps(ops: WordsOp[]): void {
  if (ops.length === 0) storage.remove('wordOps')
  else storage.set('wordOps', ops)
}

export function appendPendingOp(op: WordsOp): WordsOp[] {
  const next = [...pendingOps(), op]
  setPendingOps(next)
  return next
}

/** 首帧状态:有完整缓存就直接可用,远端放到后台拉 */
export function bootSnapshot(isDev: boolean): BootSnapshot {
  const idle: BootSnapshot = { phase: 'login', owner: null, words: [], progress: emptyProgress() }
  const token = storage.get<string>('token')
  const owner = storage.get<string>('owner')

  // 开发演示模式没有 token,刷新后自动回到演示,免得每次调页面都要重新点一次
  if (isDev && !token && owner === 'demo') return { ...idle, phase: 'boot', owner }
  if (!token || !owner) return idle

  const words = cachedWords()
  const progress = cachedProgress()
  if (words && progress) return { phase: 'ready', owner, words, progress }
  return { ...idle, phase: 'boot', owner }
}

export interface CarryOver {
  /** 需要并回远端的本地进度;null 表示本地没有欠账 */
  progress: Progress | null
  /** 需要在远端副本上重放的词库改动 */
  ops: WordsOp[]
  /** 有欠账但属于别的账号,已经丢弃 —— 必须告诉用户,不能静默 */
  discardedOwner: string | null
}

/**
 * 重新登录时,本机上没推完的东西哪些能带过去。
 *
 * token 被撤销会把本机停在「有未推送改动」的状态,重新登录若直接拿远端覆盖
 * 就等于吞掉那段复习记录。但跨账号合并同样不行 —— 那是把别人的数据混进来。
 * 所以:同账号带走,换账号丢弃 + 报出丢的是谁。
 */
export function carryOverFor(owner: string): CarryOver {
  const previous = storage.get<string>('owner')
  const dirty = storage.get<boolean>('dirty') === true
  const ops = pendingOps()
  const progress = dirty ? cachedProgress() : null

  if (previous === null || previous === owner) return { progress, ops, discardedOwner: null }

  const hadWork = progress !== null || ops.length > 0
  return { progress: null, ops: [], discardedOwner: hadWork ? previous : null }
}
