import { addDays } from '../lib/srs'
import type { Progress, Word } from '../types'

export interface DayPoint { date: string; reviewed: number; newLearned: number }
export interface AccuracyPoint { date: string; accuracy: number | null }
export interface Mastery { new: number; learning: number; review: number; total: number }
export interface Totals { totalReviewed: number; activeDays: number; avgNewPerActiveDay: number }

/** 从 today 往回数 days 天的连续序列;缺失的日子补 0,图表才不会有断口。 */
export function dailySeries(progress: Progress, today: string, days: number): DayPoint[] {
  const out: DayPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i)
    const s = progress.dailyStats[date]
    out.push({ date, reviewed: s?.reviewed ?? 0, newLearned: s?.newLearned ?? 0 })
  }
  return out
}

/** 正确率。当天没复习时为 null —— 0% 会让折线掉到底,谎称「那天全错了」。 */
export function accuracySeries(progress: Progress, today: string, days: number): AccuracyPoint[] {
  const out: AccuracyPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i)
    const s = progress.dailyStats[date]
    out.push({ date, accuracy: s && s.reviewed > 0 ? s.correct / s.reviewed : null })
  }
  return out
}

/** 词库掌握分布。progress 里没有记录的词视为未学。 */
export function masteryBreakdown(words: Word[], progress: Progress): Mastery {
  const m: Mastery = { new: 0, learning: 0, review: 0, total: words.length }
  for (const w of words) {
    const st = progress.words[w.id]?.state
    if (st === 'review') m.review++
    else if (st === 'learning') m.learning++
    else m.new++
  }
  return m
}

/** 累计量。平均只按「有复习的天」算 —— 把没打开 app 的日子算进分母会低估强度。 */
export function cumulativeTotals(progress: Progress): Totals {
  const days = Object.values(progress.dailyStats)
  const active = days.filter(d => d.reviewed > 0)
  const totalReviewed = days.reduce((n, d) => n + d.reviewed, 0)
  const totalNew = active.reduce((n, d) => n + d.newLearned, 0)
  return {
    totalReviewed,
    activeDays: active.length,
    avgNewPerActiveDay: active.length === 0 ? 0 : totalNew / active.length,
  }
}
