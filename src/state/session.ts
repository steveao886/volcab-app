import { storage } from '../lib/storage'
import { emptyProgress } from '../types'
import type { Progress, StagingItem, Word } from '../types'
import { isProgress, isStagingItem, isWord, isWordsOp, mergeStaging } from './sync'
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
  /** 生词暂存区。**不参与 phase 判定** —— 见 bootSnapshot 里的说明 */
  staging: StagingItem[]
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

/** 同上;暂存区可以是空数组(合法的「没攒任何词」),所以不像 cachedWords 那样要求非空 */
export function cachedStaging(): StagingItem[] | null {
  const s = storage.get<unknown>('staging')
  return Array.isArray(s) && s.every(isStagingItem) ? s : null
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

/**
 * 尚未推上远端的收词。与 wordOps 同一套机制、同样的理由(推送失败后关掉页面,
 * 下次启动会拿远端覆盖本地缓存),只是队列元素就是条目本身 —— 暂存区只有
 * 「追加」一种动作,并集合并即重放,不需要额外的动作描述。
 */
export function pendingStaging(): StagingItem[] {
  const raw = storage.get<unknown>('stagingOps')
  if (!Array.isArray(raw)) return []
  return raw.filter(isStagingItem)
}

export function setPendingStaging(items: StagingItem[]): void {
  if (items.length === 0) storage.remove('stagingOps')
  else storage.set('stagingOps', items)
}

/** 并集追加:同一个词按下两次「加入待补全」只会排队一条 */
export function appendPendingStaging(it: StagingItem): StagingItem[] {
  const next = mergeStaging(pendingStaging(), [it])
  setPendingStaging(next)
  return next
}

/** 首帧状态:有完整缓存就直接可用,远端放到后台拉 */
export function bootSnapshot(isDev: boolean): BootSnapshot {
  // 暂存区不参与 phase 判定:缓存缺失或损坏只表示「暂存区是空的」,
  // 绝不能因此把一个词库和进度都齐全的本机拖回 boot 态去等网络。
  const staging = cachedStaging() ?? []
  const idle: BootSnapshot = {
    phase: 'login', owner: null, words: [], progress: emptyProgress(), staging,
  }
  const token = storage.get<string>('token')
  const owner = storage.get<string>('owner')

  // 开发演示模式没有 token,刷新后自动回到演示,免得每次调页面都要重新点一次
  if (isDev && !token && owner === 'demo') return { ...idle, phase: 'boot', owner }
  if (!token || !owner) return idle

  const words = cachedWords()
  const progress = cachedProgress()
  if (words && progress) return { phase: 'ready', owner, words, progress, staging }
  return { ...idle, phase: 'boot', owner }
}

export interface CarryOver {
  /** 需要并回远端的本地进度;null 表示本地没有欠账 */
  progress: Progress | null
  /** 需要在远端副本上重放的词库改动 */
  ops: WordsOp[]
  /** 需要并进远端暂存区的收词 */
  staging: StagingItem[]
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
  const staging = pendingStaging()
  const progress = dirty ? cachedProgress() : null

  if (previous === null || previous === owner) return { progress, ops, staging, discardedOwner: null }

  const hadWork = progress !== null || ops.length > 0 || staging.length > 0
  return { progress: null, ops: [], staging: [], discardedOwner: hadWork ? previous : null }
}
