import type { ProgressEntry } from '../types'

/**
 * 复习会话的队列状态机 —— 纯函数,不碰 React。
 *
 * 会话开始时用 buildQueue() 的 due+fresh 建一次(buildSessionQueue),
 * 之后只能通过 advance() 变化。绝不能在会话中途拿 buildQueue() 的新结果
 * 整个替换 ids —— grade() 会改 progress,现算的队列会在用户眼皮底下重排。
 */
export interface SessionQueue {
  /** 待复习的词 id,队列。ids[0] 就是当前展示的卡,清空即会话完成 */
  ids: string[]
  /** 已打分的次数,即进度分子 x */
  seen: number
  /** 累计排入队列的卡片总数(含学习步长内的重现),即进度分母 y。
   *  重来/学习步长会让它随会话增长,这样 x/y 不会在卡片被塞回队尾时显得停滞或倒退。 */
  total: number
}

/** 会话队列 = due 词(到期复习)在前,fresh 词(今日新词额度内)在后。 */
export function buildSessionQueue(due: readonly string[], fresh: readonly string[]): SessionQueue {
  const ids = [...due, ...fresh]
  return { ids, seen: 0, total: ids.length }
}

/** 队首,即当前应展示的卡;队列已清空则为 undefined。 */
export function currentId(q: SessionQueue): string | undefined {
  return q.ids[0]
}

export function isDone(q: SessionQueue): boolean {
  return q.ids.length === 0
}

/**
 * 打分之后推进队列。
 *
 * entry 必须是调用方在 grade() 落库之后、从 progress.words[id] **读回**的结果 ——
 * 这里不重算 SRS 规则(那是 srs.ts 的职责),只看落库后的状态做队列决策,
 * 否则两处对"学习步长有没有走完"的判断迟早会对不上。
 *
 * 若该词打分后仍处于 learning 且 due 仍是今天 —— 说明会话内的学习步长
 * (1min/10min 重现)还没走完 —— 把它重新插到队尾;否则彻底出队。
 *
 * 前提:id 必须是 currentId(q)(即 q.ids[0])—— 调用方只应该对当前展示的卡打分。
 */
export function advance(
  q: SessionQueue,
  id: string,
  entry: ProgressEntry | undefined,
  today: string,
): SessionQueue {
  const rest = q.ids.slice(1)
  const recycle = entry !== undefined && entry.state === 'learning' && entry.due <= today
  return {
    ids: recycle ? [...rest, id] : rest,
    seen: q.seen + 1,
    total: recycle ? q.total + 1 : q.total,
  }
}
