import { rankLapsedWords } from '../lib/queue'
import { addDays } from '../lib/srs'
import type { Progress, Word } from '../types'

export interface DayPoint { date: string; reviewed: number; newLearned: number; correct: number }
export interface AccuracyPoint { date: string; accuracy: number | null }
export interface Mastery { new: number; learning: number; review: number; total: number }
export interface Totals { totalReviewed: number; activeDays: number; avgNewPerActiveDay: number; totalQuizzes: number }

/** A continuous series counting back `days` days from today; missing days are filled with 0 so the chart doesn't have gaps. */
export function dailySeries(progress: Progress, today: string, days: number): DayPoint[] {
  const out: DayPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i)
    const s = progress.dailyStats[date]
    out.push({ date, reviewed: s?.reviewed ?? 0, newLearned: s?.newLearned ?? 0, correct: s?.correct ?? 0 })
  }
  return out
}

export interface WindowSummary {
  reviewed: number
  newLearned: number
  /** Days in the window with at least one review — the denominator behind "you studied N days out of 30". */
  activeDays: number
  /**
   * The busiest day in the window, or null when nothing was reviewed at
   * all. This is what lets the chart print its own y-axis: a bar chart
   * with no number on it is only a shape, and that was the complaint the
   * whole annotation pass came out of.
   */
  peak: DayPoint | null
}

/** Totals for one charted window, so the chart can be labelled instead of left to be eyeballed. */
export function windowSummary(days: DayPoint[]): WindowSummary {
  let reviewed = 0, newLearned = 0, activeDays = 0
  let peak: DayPoint | null = null
  for (const d of days) {
    reviewed += d.reviewed
    newLearned += d.newLearned
    if (d.reviewed > 0) activeDays++
    // Strictly greater, so a tie keeps the earlier day: the peak is a
    // "when did this happen" annotation, and the first time you hit it is
    // the honest answer.
    if (d.reviewed > 0 && (peak === null || d.reviewed > peak.reviewed)) peak = d
  }
  return { reviewed, newLearned, activeDays, peak }
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

export interface DatedAccuracy { date: string; accuracy: number }
export interface AccuracyStats {
  /**
   * Weighted: total correct / total reviewed across the window, **not** the
   * mean of the daily rates. A day with one review would otherwise swing the
   * headline as hard as a day with eighty, and the number is printed as
   * "average accuracy" — that has to mean the accuracy of the reviews, not
   * the accuracy of the days.
   */
  average: number | null
  best: DatedAccuracy | null
  worst: DatedAccuracy | null
  /** The most recent day that had any review; what "how am I doing now" actually asks. */
  latest: DatedAccuracy | null
  ratedDays: number
}

/**
 * Summary numbers for the accuracy chart. Derived from DayPoint rather than
 * AccuracyPoint because the weighted average needs the raw correct/reviewed
 * counts, and reading both series would let them disagree.
 */
export function accuracyStats(days: DayPoint[]): AccuracyStats {
  let correct = 0, reviewed = 0, ratedDays = 0
  let best: DatedAccuracy | null = null
  let worst: DatedAccuracy | null = null
  let latest: DatedAccuracy | null = null
  for (const d of days) {
    if (d.reviewed === 0) continue
    correct += d.correct
    reviewed += d.reviewed
    ratedDays++
    const point = { date: d.date, accuracy: d.correct / d.reviewed }
    // >= / <= so ties resolve to the later day: days arrive oldest-first,
    // and of two equally good days the recent one is the one worth naming.
    if (best === null || point.accuracy >= best.accuracy) best = point
    if (worst === null || point.accuracy <= worst.accuracy) worst = point
    latest = point
  }
  return { average: reviewed === 0 ? null : correct / reviewed, best, worst, latest, ratedDays }
}

export interface ForecastDay { date: string; count: number }
export interface DueForecast {
  /** days[0] is today and also absorbs everything overdue — that is the pile you actually face today. */
  days: ForecastDay[]
  /** Scheduled past the end of the window. Without it the rows look like the whole backlog. */
  beyond: number
  /** Every word currently scheduled, i.e. the sum of days + beyond. */
  total: number
}

/**
 * How much review is coming up.
 *
 * Every other card on the stats page looks backward; this is the only one
 * that answers "what does the next week cost me", which is the question
 * that actually changes what you do today.
 *
 * "Due" matches buildQueue exactly — `state !== 'new' && due <= today` for
 * the first bucket. If the two ever drift, the Today page and this card
 * would print different numbers for the same day, and one of them would be
 * lying.
 */
export function dueForecast(words: Word[], progress: Progress, today: string, span: number): DueForecast {
  const dates = Array.from({ length: span }, (_, i) => addDays(today, i))
  const counts = new Map(dates.map(d => [d, 0]))
  const last = dates[dates.length - 1]
  let beyond = 0, total = 0
  for (const w of words) {
    const e = progress.words[w.id]
    if (!e || e.state === 'new') continue
    total++
    if (e.due <= today) counts.set(today, counts.get(today)! + 1)
    else if (e.due > last) beyond++
    else counts.set(e.due, (counts.get(e.due) ?? 0) + 1)
  }
  return { days: dates.map(date => ({ date, count: counts.get(date)! })), beyond, total }
}

export interface LapseWord { word: Word; lapses: number }
export interface LapseSummary {
  /** Every word with at least one lapse, not just the ones listed below. */
  total: number
  top: LapseWord[]
}

/**
 * The words that keep being forgotten.
 *
 * Ordering is delegated to rankLapsedWords, the same comparator the drill
 * session uses, so the leaderboard and the session it links to never
 * disagree about which word is worst.
 *
 * It deliberately ranks over **everything that has ever lapsed**, while
 * the session additionally drops words that have since matured or were
 * already reviewed today. The two are meant to differ: this is the
 * stats page, and a record of what a word has cost you shouldn't blink out
 * because you happened to drill it an hour ago.
 */
export function lapseSummary(words: Word[], progress: Progress, topN: number): LapseSummary {
  const ranked = rankLapsedWords(words, progress)
  return {
    total: ranked.length,
    top: ranked.slice(0, topN).map(word => ({ word, lapses: progress.words[word.id].lapses })),
  }
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** Parsed as local time on purpose: `new Date('2026-07-29')` is UTC midnight, which lands on the previous day west of Greenwich and would shift every weekday label by one. */
function parseLocal(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Row label for the forecast: 今天 / 明天 for the two days that have names, weekday for the rest. */
export function forecastLabel(date: string, today: string): string {
  if (date === today) return '今天'
  if (date === addDays(today, 1)) return '明天'
  return WEEKDAYS[parseLocal(date).getDay()]
}

/** `M/D` for chart axis ends — the year is noise at this density. */
export function shortDate(date: string): string {
  const [, m, d] = date.split('-').map(Number)
  return `${m}/${d}`
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
    // Counted over every day, not just active ones: a quiz can be taken on
    // a day with no scheduled review at all, and those sessions still
    // happened.
    totalQuizzes: days.reduce((n, d) => n + d.quizTaken, 0),
  }
}
