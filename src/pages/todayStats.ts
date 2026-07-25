import { addDays } from '../lib/srs'
import type { DailyStat, Progress, Word } from '../types'

/**
 * 连续复习天数(streak)。
 *
 * 规则:
 * - 从今天起往前数,数「reviewed > 0」的连续天数;
 * - 今天还没复习不算断签 —— 早上打开 App 时连胜条不应该先掉一天,
 *   这种情况下改从昨天起往前数;
 * - 今天已经复习过,则今天计入,并继续从今天往前数;
 * - 除今天外,任何一天缺失或 reviewed=0 都会截断计数(缺失视为 0,不是跳过)。
 */
export function computeStreak(
  dailyStats: Record<string, DailyStat>,
  today: string,
): number {
  let count = (dailyStats[today]?.reviewed ?? 0) > 0 ? 1 : 0
  let cursor = addDays(today, -1)
  while ((dailyStats[cursor]?.reviewed ?? 0) > 0) {
    count += 1
    cursor = addDays(cursor, -1)
  }
  return count
}

export interface ReviewProgress {
  /** 已进入 review 阶段(已掌握)的词数 */
  count: number
  total: number
  /** count / total,词库为空时为 0 */
  ratio: number
}

/** 总进度:词库里 state === 'review' 的词数占比。词条缺席于 progress.words 视为 new。 */
export function reviewProgress(words: Word[], progress: Progress): ReviewProgress {
  const total = words.length
  if (total === 0) return { count: 0, total: 0, ratio: 0 }
  let count = 0
  for (const w of words) {
    if (progress.words[w.id]?.state === 'review') count += 1
  }
  return { count, total, ratio: count / total }
}
