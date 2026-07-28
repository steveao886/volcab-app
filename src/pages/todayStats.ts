import { addDays } from '../lib/srs'
import type { DailyStat, Progress, Word } from '../types'

/**
 * The review streak, in consecutive days.
 *
 * Rules:
 * - Count backward from today, counting consecutive days with `reviewed > 0`;
 * - Not having reviewed yet today doesn't count as a broken streak —
 *   opening the app in the morning shouldn't make the streak counter drop
 *   by a day before you've even done anything; in that case counting
 *   starts from yesterday instead;
 * - If today has already been reviewed, today is included and counting
 *   continues backward from today;
 * - Aside from today, any day that's missing or has reviewed=0 truncates
 *   the count (missing is treated as 0, not skipped over).
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
  /** Count of words that have entered the review stage (mastered) */
  count: number
  total: number
  /** count / total, 0 when the library is empty */
  ratio: number
}

/** Overall progress: the proportion of words in the library with state === 'review'. An entry absent from progress.words is treated as new. */
export function reviewProgress(words: Word[], progress: Progress): ReviewProgress {
  const total = words.length
  if (total === 0) return { count: 0, total: 0, ratio: 0 }
  let count = 0
  for (const w of words) {
    if (progress.words[w.id]?.state === 'review') count += 1
  }
  return { count, total, ratio: count / total }
}
