import { addDays } from '../lib/srs'
import type { Progress, Word } from '../types'

export interface DayPoint { date: string; reviewed: number; newLearned: number }
export interface AccuracyPoint { date: string; accuracy: number | null }
export interface Mastery { new: number; learning: number; review: number; total: number }
export interface Totals { totalReviewed: number; activeDays: number; avgNewPerActiveDay: number }

/** A continuous series counting back `days` days from today; missing days are filled with 0 so the chart doesn't have gaps. */
export function dailySeries(progress: Progress, today: string, days: number): DayPoint[] {
  const out: DayPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i)
    const s = progress.dailyStats[date]
    out.push({ date, reviewed: s?.reviewed ?? 0, newLearned: s?.newLearned ?? 0 })
  }
  return out
}

/** Accuracy. null on a day with no review — 0% would drop the line to the bottom, falsely claiming "everything was wrong that day". */
export function accuracySeries(progress: Progress, today: string, days: number): AccuracyPoint[] {
  const out: AccuracyPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i)
    const s = progress.dailyStats[date]
    out.push({ date, accuracy: s && s.reviewed > 0 ? s.correct / s.reviewed : null })
  }
  return out
}

/** Library mastery breakdown. A word with no record in progress is treated as not yet learned. */
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
  /** The headline number: mastery status of the most-common-words band. ratio is recorded as 0 when total is 0. */
  headline: { mastered: number; total: number; ratio: number }
}

/**
 * Bands are split by usageScore. The cutoffs are set based on the
 * **actual library distribution** (77 words for 7–10 / 260 words for 5–6 /
 * 139 words for 1–4), not an arbitrary even split: only 9 words in the
 * whole library score above 8, so giving that its own band would make
 * "mastered 3 out of 9" pure noise.
 */
const BANDS = [
  { label: '最常用', range: '7–10', min: 7, max: 10 },
  { label: '常见', range: '5–6', min: 5, max: 6 },
  { label: '少见', range: '1–4', min: 1, max: 4 },
] as const

/**
 * Mastery rate banded by usage score.
 *
 * The stats page originally just counted totals (how many reviewed, how
 * many mastered), but **totals can lie**: the sense of achievement from
 * finishing 300 words scoring a 3 is hollow. What actually matters is "how
 * far along are you on the most commonly used words".
 *
 * "Mastered" follows the same definition as reviewProgress and
 * masteryBreakdown: state === 'review'. All three must stay consistent,
 * otherwise the same page would show two contradictory "mastered counts".
 *
 * Words missing a usageScore go into no band at all — unscored doesn't
 * equal any particular band, and forcing it in would inflate the
 * denominator out of nowhere, diluting the mastery rate.
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

/** Cumulative totals. The average only counts "days with a review" — including days the app was never opened in the denominator would understate intensity. */
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
