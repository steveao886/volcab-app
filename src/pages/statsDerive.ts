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

export interface CoverageBand { label: string; range: string; mastered: number; total: number }
export interface UsageCoverage {
  bands: CoverageBand[]
  /** 头条数字:最常用那一档的掌握情况。total 为 0 时 ratio 记 0。 */
  headline: { mastered: number; total: number; ratio: number }
}

/**
 * 档位按 usageScore 切。分界点是照着**真实词库分布**定的
 * (7–10 共 77 词 / 5–6 共 260 词 / 1–4 共 139 词),不是拍脑袋的等分:
 * 8 分以上全库只有 9 个词,单独成档的话「9 个里掌握了 3 个」纯属噪音。
 */
const BANDS = [
  { label: '最常用', range: '7–10', min: 7, max: 10 },
  { label: '常见', range: '5–6', min: 5, max: 6 },
  { label: '少见', range: '1–4', min: 1, max: 4 },
] as const

/**
 * 按遇见概率分档的掌握率。
 *
 * 统计页原本数的是总量(复习了多少、掌握了多少),但**总量会说谎**:学完 300 个
 * 3 分词的成就感是假的。真正该看的是「你在最常用的那批词上走到哪了」。
 *
 * 「掌握」沿用 reviewProgress 与 masteryBreakdown 的口径:state === 'review'。
 * 三处必须一致,否则同一页上会出现两个互相矛盾的「掌握数」。
 *
 * 缺 usageScore 的词不进任何一档 —— 未评分不等于任何一个档位,硬塞进去会让
 * 分母凭空变大、掌握率被稀释。
 */
export function usageCoverage(words: Word[], progress: Progress): UsageCoverage {
  const bands: CoverageBand[] = BANDS.map(b => {
    let mastered = 0, total = 0
    for (const w of words) {
      const s = w.usageScore
      if (s === undefined || s < b.min || s > b.max) continue
      total++
      if (progress.words[w.id]?.state === 'review') mastered++
    }
    return { label: b.label, range: b.range, mastered, total }
  })
  const top = bands[0]
  return {
    bands,
    headline: { mastered: top.mastered, total: top.total, ratio: top.total === 0 ? 0 : top.mastered / top.total },
  }
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
