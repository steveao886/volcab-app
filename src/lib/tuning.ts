import { clampIntervalModifier, LEARNING_STEPS } from './srs'
import type { Progress, Word } from '../types'

/**
 * Turns the numbers the app already records into advice about the two
 * settings the user can actually move.
 *
 * Everything here returns **structured** advice, not sentences: the page
 * renders the Chinese. That keeps the reasoning testable and stops the
 * thresholds from being restated in three places.
 *
 * The governing rule is that a recommendation must be refusable. Both
 * functions can answer "not enough data to say", and they do so on real
 * thresholds rather than producing a confident number from four days of
 * history. A tuning knob that always has an opinion is worse than one that
 * admits when it doesn't.
 */

/** The retention spaced repetition aims at. SM-2's defaults are built around it and FSRS takes it as its default request. */
export const TARGET_RETENTION = 0.9

/**
 * Scheduled reviews needed before the interval modifier is worth touching.
 *
 * At 150 reviews a 90% observation carries a 95% interval of roughly
 * ±5 points, which is just tight enough to tell "on target" from "clearly
 * above it". Below that the estimate moves further than the setting would.
 * The first time this was measured by hand there were 7 lapses over ~317
 * reviews and even that only supported a cautious move.
 */
export const MIN_RETENTION_SAMPLE = 150

/**
 * The most the modifier is allowed to move in one step, as a fraction.
 *
 * The arithmetic answer can be extreme — at 97.8% observed retention the
 * multiplier that lands on 90% is 4.7x — and acting on it would be
 * indefensible off a few hundred reviews. It also compounds: at 1.3 the
 * per-review multiplier goes from 2.5 to 3.25, so five reviews in the
 * interval is already ~3.7x longer. Moving 30% at a time and re-measuring
 * gets to the same place without betting the schedule on a noisy estimate.
 */
const MAX_STEP = 0.3

/**
 * How many days of retention evidence to read, given when the modifier was
 * last changed.
 *
 * Retention is only evidence about the setting it was measured under. Once
 * the modifier moves, every earlier review was scheduled under the old one,
 * and reusing it is what lets a user press "apply" three times and ratchet
 * the schedule 2.2x on a sample that never changed — the exact
 * over-application MAX_STEP exists to prevent. Narrowing the window instead
 * makes the advice go quiet until the new setting has actually been tested.
 *
 * `tunedOn` absent means the modifier has never been touched, so the whole
 * window is fair game.
 */
export function retentionWindowDays(tunedOn: string | null, today: string, maxDays: number): number {
  if (tunedOn === null) return maxDays
  const day = 86_400_000
  const elapsed = Math.floor((Date.parse(today) - Date.parse(tunedOn)) / day)
  if (!Number.isFinite(elapsed)) return maxDays
  return Math.min(maxDays, Math.max(0, elapsed))
}

export type ModifierAdvice =
  | { kind: 'insufficient'; reviewed: number; needed: number }
  | { kind: 'ok'; retention: number; reviewed: number }
  | { kind: 'adjust'; retention: number; reviewed: number; from: number; to: number }

/**
 * What the interval modifier should be, given measured retention.
 *
 * Under an exponential forgetting curve, retention R at the current
 * intervals becomes the target R* if every interval is scaled by
 * ln(R*)/ln(R) — remembering more than you were aiming for means the
 * intervals are shorter than they need to be. That ratio is then damped by
 * MAX_STEP and rounded to the tenth the setting accepts.
 *
 * `retention` must come from reviewPhase/reviewPhaseCorrect. The
 * headline accuracy figure counts new words being learned and ran seven
 * points below true retention on the real library, which would push the
 * intervals the wrong way.
 */
export function recommendIntervalModifier(
  correct: number,
  reviewed: number,
  current: number | undefined,
): ModifierAdvice {
  const from = clampIntervalModifier(current)
  if (reviewed < MIN_RETENTION_SAMPLE) {
    return { kind: 'insufficient', reviewed, needed: MIN_RETENTION_SAMPLE }
  }
  const retention = correct / reviewed
  // A perfect score gives ln(1) = 0 and an infinite ratio; the damping below
  // would rescue it, but the intent is clearer stated than relied upon.
  const raw = retention >= 1 ? 1 + MAX_STEP : Math.log(TARGET_RETENTION) / Math.log(retention)
  const step = Math.min(1 + MAX_STEP, Math.max(1 - MAX_STEP, raw))
  const to = clampIntervalModifier(Math.round(from * step * 10) / 10)
  return to === from
    ? { kind: 'ok', retention, reviewed }
    : { kind: 'adjust', retention, reviewed, from, to }
}

/** Days of history before the daily-load comparison means anything — two weeks covers a normal run of uneven days. */
export const MIN_LOAD_DAYS = 7

/** How far the projection may sit from demonstrated volume before it is worth mentioning. Below this it is noise. */
const LOAD_TOLERANCE = 0.15

export type NewPerDayAdvice =
  | { kind: 'insufficient'; activeDays: number; needed: number }
  | { kind: 'exhausted' }
  | { kind: 'ok'; projected: number; sustained: number }
  | { kind: 'adjust'; projected: number; sustained: number; from: number; to: number }

export interface LoadInputs {
  /** Mean cards actually graded per active day — what the user has demonstrably sustained. */
  sustained: number
  activeDays: number
  /** Mean words per day coming due over the forecast horizon. */
  duePerDay: number
  /** Words never started; when this hits zero, newPerDay stops meaning anything. */
  unlearned: number
}

/**
 * Whether the daily new-word count fits the review load it creates.
 *
 * The comparison is between two card counts per day: what the schedule is
 * about to ask for, and what the user has actually been doing. Projected
 * load is the words coming due plus the cost of the day's new words, which
 * is LEARNING_STEPS grades each — that is the count from srs.ts, not an
 * estimate, since a new word answered "good" is graded once per step before
 * it graduates.
 *
 * Recommending *upward* additionally requires unlearned words to exist.
 * There is no point advising a bigger daily intake against an empty pool.
 */
export function recommendNewPerDay(current: number, load: LoadInputs): NewPerDayAdvice {
  const { sustained, activeDays, duePerDay, unlearned } = load
  if (activeDays < MIN_LOAD_DAYS || sustained <= 0) {
    return { kind: 'insufficient', activeDays, needed: MIN_LOAD_DAYS }
  }
  if (unlearned === 0) return { kind: 'exhausted' }

  const projected = duePerDay + current * LEARNING_STEPS
  const ratio = projected / sustained
  if (Math.abs(ratio - 1) <= LOAD_TOLERANCE) return { kind: 'ok', projected, sustained }

  // Solve for the intake that makes the projection match what is sustainable.
  const fitted = Math.round((sustained - duePerDay) / LEARNING_STEPS)
  const to = Math.min(50, Math.max(1, fitted))
  // Never advise adding words that don't exist, and never advise a change the
  // clamp just undid.
  const capped = to > current ? Math.min(to, current + unlearned) : to
  return capped === current
    ? { kind: 'ok', projected, sustained }
    : { kind: 'adjust', projected, sustained, from: current, to: capped }
}

/** Pulls the load figures out of progress + the library, so the page doesn't assemble them itself. */
export function loadInputs(
  words: Word[],
  progress: Progress,
  recentDays: { reviewed: number }[],
  dueNext: number[],
): LoadInputs {
  const active = recentDays.filter(d => d.reviewed > 0)
  const sustained = active.length === 0 ? 0 : active.reduce((n, d) => n + d.reviewed, 0) / active.length
  const duePerDay = dueNext.length === 0 ? 0 : dueNext.reduce((n, c) => n + c, 0) / dueNext.length
  let unlearned = 0
  for (const w of words) {
    const e = progress.words[w.id]
    if (!e || e.state === 'new') unlearned++
  }
  return { sustained, activeDays: active.length, duePerDay, unlearned }
}
