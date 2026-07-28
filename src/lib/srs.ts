import type { Grade, ProgressEntry } from '../types'

export const LEARNING_STEPS = 2      // Learning steps: reappears at 1 minute and 10 minutes within the same session
export const MIN_EASE = 1.3
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
  state: 'learning', ease: 2.5, intervalDays: 0, due: todayStr(now),
  stepIndex: 0, reps: 0, lapses: 0, lastReviewedAt: now.toISOString(),
})

// ±5% random fuzz; no fuzzing within 3 days
function fuzz(days: number, rng: () => number): number {
  if (days < 3) return Math.min(days, MAX_INTERVAL_DAYS)
  const factor = 1 + (rng() * 2 - 1) * 0.05
  return Math.min(MAX_INTERVAL_DAYS, Math.max(1, Math.round(days * factor)))
}

export function gradeWord(
  prev: ProgressEntry | undefined,
  grade: Grade,
  now: Date,
  rng: () => number = Math.random,
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
  e.intervalDays = fuzz(Math.max(e.intervalDays + 1, Math.round(next)), rng)
  e.due = addDays(today, e.intervalDays)
  return e
}

function graduate(e: ProgressEntry, days: number, today: string, rng: () => number) {
  e.state = 'review'
  e.stepIndex = 0
  e.intervalDays = fuzz(days, rng)
  e.due = addDays(today, e.intervalDays)
}
