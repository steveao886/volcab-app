import { LAPSE_SESSION_SIZE, rankStrugglingWords } from './queue'
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
 * per-review multiplier goes from 2.5 to 3.25, and the interval pulls away
 * from a plain schedule every review until MAX_INTERVAL_DAYS clips it — at
 * the current ceiling that is the fourth one. Moving 30% at a time and
 * re-measuring gets to the same place without betting the schedule on a
 * noisy estimate.
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
  /** Steady-state cards a day from the schedule alone: the sum of 1/interval over every started word. */
  duePerDay: number
  /** Cards the lapse drill costs on a day it is taken — the struggling words, capped at the session size. */
  lapseDrill: number
  /** Words never started; when this hits zero, newPerDay stops meaning anything. */
  unlearned: number
}

/**
 * What a new word costs on the day it is learned.
 *
 * LEARNING_STEPS grades to graduate, **plus one**: graduating on "good"
 * lands the word at an interval of GRADUATE_DAYS = 1, which is exactly the
 * consolidation drill's ceiling (CONSOLIDATE_MAX_INTERVAL_DAYS), so it is
 * seen a third time the same evening. Charging only the learning steps was
 * a third of the error that produced "126 cards a day means you have room
 * for 50 new words".
 */
const GRADES_PER_NEW_WORD = LEARNING_STEPS + 1

/**
 * Whether the daily new-word count fits the review load it creates.
 *
 * The comparison is between two card counts per day: what a day at this
 * setting actually costs, and what the user has been doing. **Both sides
 * must count the same cards.** dailyStats.reviewed — the source of
 * `sustained` — is written by practiceGrade as well as grade (see
 * store.tsx; the drills are deliberately counted so they keep the streak
 * alive), so the projection has to include the drills too, or the drill
 * work reads as spare capacity for new words. It did, and the advice was
 * to more than double an intake that was already full.
 *
 * The lapse drill is a fixed daily cost that does not move with the
 * intake, so it comes off the top on both sides.
 *
 * Not modelled, on purpose: "again" re-shows, which are a property of the
 * day rather than of the setting; and the future reviews today's new words
 * will generate, which enter duePerDay as soon as they exist. See
 * docs/superpowers/specs/2026-08-06-daily-load-design.md.
 *
 * Recommending *upward* additionally requires unlearned words to exist.
 * There is no point advising a bigger daily intake against an empty pool.
 */
export function recommendNewPerDay(current: number, load: LoadInputs): NewPerDayAdvice {
  const { sustained, activeDays, duePerDay, lapseDrill, unlearned } = load
  if (activeDays < MIN_LOAD_DAYS || sustained <= 0) {
    return { kind: 'insufficient', activeDays, needed: MIN_LOAD_DAYS }
  }
  if (unlearned === 0) return { kind: 'exhausted' }

  const fixed = duePerDay + lapseDrill
  const projected = fixed + current * GRADES_PER_NEW_WORD
  const ratio = projected / sustained
  if (Math.abs(ratio - 1) <= LOAD_TOLERANCE) return { kind: 'ok', projected, sustained }

  // Solve for the intake that makes the projection match what is sustainable.
  const fitted = Math.round((sustained - fixed) / GRADES_PER_NEW_WORD)
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
): LoadInputs {
  // Per **calendar** day, from the first day of study in the window onward.
  //
  // This used to divide by the active days alone, on the reasoning that a
  // day off isn't evidence of a smaller appetite. But the projection it gets
  // compared against is per calendar day, and the schedule doesn't take the
  // day off — the words come due anyway and land on the next session. Two
  // rest days a week inflated the measured capacity by 40% and the advice
  // read the difference as room for more new words.
  //
  // Days *before* the first review in the window are still excluded: they
  // are days the habit didn't exist yet, and counting them would tell
  // someone a week into the app that they can't sustain what they are
  // visibly sustaining.
  const firstActive = recentDays.findIndex(d => d.reviewed > 0)
  const span = firstActive === -1 ? 0 : recentDays.length - firstActive
  const active = recentDays.filter(d => d.reviewed > 0)
  const sustained = span === 0 ? 0 : recentDays.reduce((n, d) => n + d.reviewed, 0) / span

  // Steady state, not a forecast window. A word on a five-day interval is a
  // fifth of a card a day, forever; a word still in the learning phase
  // (intervalDays 0) is one a day. This replaced a mean over the next seven
  // days of `due` dates, which counted each word at most once however often
  // it was really going to come round — undercounting exactly the short
  // intervals that fill the day, and by an amount that depended on how far
  // ahead the chart happened to look.
  let duePerDay = 0
  let unlearned = 0
  for (const w of words) {
    const e = progress.words[w.id]
    if (!e || e.state === 'new') { unlearned++; continue }
    duePerDay += 1 / Math.max(1, e.intervalDays)
  }

  return {
    sustained,
    activeDays: active.length,
    duePerDay,
    lapseDrill: Math.min(LAPSE_SESSION_SIZE, rankStrugglingWords(words, progress).length),
    unlearned,
  }
}
