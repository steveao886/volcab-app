import type { Grade, ProgressEntry } from '../types'

export const LEARNING_STEPS = 2      // Learning steps: reappears at 1 minute and 10 minutes within the same session
export const MIN_EASE = 1.3
/** Ease a word starts on. Only "easy" ever raises it, so a word answered "good" every time sits here forever — which is what makes distance below it a usable difficulty signal. */
export const INITIAL_EASE = 2.5
export const MAX_INTERVAL_DAYS = 365
const GRADUATE_DAYS = 1
const EASY_GRADUATE_DAYS = 4

export function todayStr(now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return todayStr(new Date(y, m - 1, d + days))
}

const freshEntry = (now: Date): ProgressEntry => ({
  state: 'learning', ease: INITIAL_EASE, intervalDays: 0, due: todayStr(now),
  stepIndex: 0, reps: 0, lapses: 0, lastReviewedAt: now.toISOString(),
})

// ±5% random fuzz; no fuzzing within 3 days
function fuzz(days: number, rng: () => number): number {
  if (days < 3) return Math.min(days, MAX_INTERVAL_DAYS)
  const factor = 1 + (rng() * 2 - 1) * 0.05
  return Math.min(MAX_INTERVAL_DAYS, Math.max(1, Math.round(days * factor)))
}

export const MIN_INTERVAL_MODIFIER = 0.5
export const MAX_INTERVAL_MODIFIER = 3

/** Undefined means "never configured", which must behave exactly as it did before the setting existed. Out-of-range values are clamped rather than rejected — this comes off a synced settings blob, and the read side never throws. */
export function clampIntervalModifier(v: number | undefined): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 1
  return Math.min(MAX_INTERVAL_MODIFIER, Math.max(MIN_INTERVAL_MODIFIER, v))
}

/**
 * @param intervalModifier Multiplies every **review-phase** interval, the
 * one knob SM-2 doesn't have. Ease only ever rises when you press "easy"
 * (+0.15), so a word answered "good" every time stays at ×2.5 forever no
 * matter how easy it actually is for you — the algorithm can punish but it
 * can't learn that you are beating its target. Measured retention on the
 * real library was 97.8% against the 90% that SM-2's defaults aim for,
 * which is what this exists to close.
 *
 * Deliberately **not** applied to the graduating intervals: those are the
 * output of the learning steps, and stretching a word's very first review
 * out is a different decision from stretching the ones after it.
 *
 * Note that it compounds. At 1.3 the effective multiplier per review goes
 * from 2.5 to 3.25, so five reviews in the interval is 1.3^5 ≈ 3.7 times
 * longer, not 30%. Small numbers here move fast.
 */
export function gradeWord(
  prev: ProgressEntry | undefined,
  grade: Grade,
  now: Date,
  rng: () => number = Math.random,
  intervalModifier = 1,
): ProgressEntry {
  const e = prev && prev.state !== 'new' ? { ...prev } : freshEntry(now)
  e.reps += 1
  e.lastReviewedAt = now.toISOString()
  const today = todayStr(now)

  if (e.state === 'learning') {
    if (grade === 'again') { e.stepIndex = 0; e.due = today }
    else if (grade === 'hard') { e.due = today }
    else if (grade === 'easy') graduate(e, EASY_GRADUATE_DAYS, today, rng)
    else if (e.stepIndex + 1 < LEARNING_STEPS) { e.stepIndex += 1; e.due = today }
    else graduate(e, GRADUATE_DAYS, today, rng)
    return e
  }

  // review phase
  if (grade === 'again') {
    e.lapses += 1
    e.ease = Math.max(MIN_EASE, e.ease - 0.2)
    e.state = 'learning'
    e.stepIndex = 0
    e.intervalDays = 0
    e.due = today
    return e
  }
  let next: number
  if (grade === 'hard') {
    e.ease = Math.max(MIN_EASE, e.ease - 0.15)
    next = e.intervalDays * 1.2
  } else if (grade === 'good') {
    next = e.intervalDays * e.ease
  } else {
    e.ease += 0.15
    next = e.intervalDays * e.ease * 1.3
  }
  // The modifier lands here, before the "must grow by at least a day" floor
  // and the fuzz, so a modifier below 1 can still shorten an interval while
  // never letting one stand still.
  e.intervalDays = fuzz(Math.max(e.intervalDays + 1, Math.round(next * clampIntervalModifier(intervalModifier))), rng)
  e.due = addDays(today, e.intervalDays)
  return e
}

function graduate(e: ProgressEntry, days: number, today: string, rng: () => number) {
  e.state = 'review'
  e.stepIndex = 0
  e.intervalDays = fuzz(days, rng)
  e.due = addDays(today, e.intervalDays)
}

/** Calendar-day difference between two YYYY-MM-DD strings, parsed as local dates (same convention as addDays). */
function diffDays(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return Math.round((new Date(ty, tm - 1, td).getTime() - new Date(fy, fm - 1, fd).getTime()) / 86400_000)
}

/**
 * What each grade would do to this card's schedule, as printable labels,
 * for the review page to show under the four grade buttons — grading
 * stops being a feeling and becomes choosing a consequence.
 *
 * Runs the real scheduler per grade: hardcoded numbers would print
 * intervals gradeWord never produces, and a wrong preview is worse than
 * none. The fixed rng of 0.5 makes fuzz's factor exactly 1, so the
 * preview shows the unfuzzed interval while the actual write still
 * fuzzes ±5% — off by at most ±5% beyond 3 days, deterministic enough
 * to test.
 *
 * Every same-day outcome reads 稍后: learning steps and lapses requeue
 * within the session by queue position, not by clock (see
 * LEARNING_STEPS), so a minutes figure would be an invention.
 *
 * Labels stay in days all the way to 365 天 — converting to 月/年 would
 * round away exactly the magnitude this exists to show.
 */
export function previewIntervals(
  prev: ProgressEntry | undefined,
  now: Date,
  intervalModifier = 1,
): Record<Grade, string> {
  const today = todayStr(now)
  const out = {} as Record<Grade, string>
  for (const g of ['again', 'hard', 'good', 'easy'] as const) {
    // gradeWord copies before mutating, so prev itself is never touched.
    const next = gradeWord(prev, g, now, () => 0.5, intervalModifier)
    out[g] = next.due <= today ? '稍后' : `${diffDays(today, next.due)} 天`
  }
  return out
}
