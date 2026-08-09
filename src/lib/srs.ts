import type { Grade, ProgressEntry } from '../types'

export const LEARNING_STEPS = 2      // Learning steps: reappears at 1 minute and 10 minutes within the same session
export const MIN_EASE = 1.3
/** Ease a word starts on. Only "easy" ever raises it, so a word answered "good" every time sits here forever — which is what makes distance below it a usable difficulty signal. */
export const INITIAL_EASE = 2.5
/**
 * Ceiling on a review interval.
 *
 * Was 365, which in practice meant no ceiling at all — the schedule reached
 * it on its own and words sat a year out. Measured on the live library when
 * this changed: 301 words in the review phase, median interval 12 days, but
 * 19 at 90 days or more and 9 past 180, topping out at the old cap exactly.
 *
 * The argument for a year was that quizzes already catch a forgotten word:
 * questionPool (lib/quiz.ts) filters on `state !== 'new'` and ignores `due`
 * entirely, so a word 119 days out is still drawn every day, and answering
 * it wrong pulls `due` back to today. Simulated against the real library
 * with the app's own weightedShuffle — 310-word pool, 10 questions a
 * session, 8.1 sessions a day — a 119-day word surfaces about every 4 days,
 * and the ones carried furthest surface *more* often, since a low ease and
 * a lapse both raise their draw weight.
 *
 * That safety net is real but conditional: it holds only while the quizzes
 * keep happening, and quiz volume over a single week ranged from 1 session
 * to 17. A cap costs a few more reviews a day and does not depend on a
 * habit holding. 100 rather than 90 or 120 is the round number the user
 * asked for; nothing in the algorithm turns on the exact value.
 *
 * **Forward-looking only.** Entries already scheduled past this keep their
 * `due` date until they next come up, at which point fuzz() clamps them.
 */
export const MAX_INTERVAL_DAYS = 100
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
 * Note that it compounds, up to a point. At 1.3 the effective multiplier
 * per review goes from 2.5 to 3.25, so the interval runs away far faster
 * than the 30% the number looks like — but MAX_INTERVAL_DAYS clips it
 * before the compounding gets far. Starting from one day, 1.3 already
 * reaches the ceiling on the fourth review (107, clipped to 100) against
 * plain 2.5's 50, so the widest gap the modifier can actually open is
 * roughly 2x, not the 3.7x the raw arithmetic gives. Small numbers here
 * still move fast; they just stop sooner than they used to.
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
 * Labels stay in days all the way to MAX_INTERVAL_DAYS — converting to
 * 月/年 would round away exactly the magnitude this exists to show.
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

/**
 * A quiz miss halves this word's interval.
 *
 * The one place practice is allowed to reach the schedule, and it only ever
 * moves it *toward* now. Until this existed, a word you had just failed to
 * recall kept its dates untouched — miss it today and the scheduler went on
 * asserting "you know this, see you in October", having just been shown
 * otherwise. See the 2026-08-09 quiz-demotion spec for why the long-standing
 * "practice must not reshape the schedule" rule is rewritten rather than
 * broken: it was written against practice making intervals *grow*, which is
 * a different accident (gradeWord multiplies whatever interval it finds,
 * knowing nothing about elapsed time).
 *
 * **`due` takes a minimum, and it is not a nicety.** Scheduling from today
 * alone can push a review *further away*: a word on a 30-day interval that
 * falls due tomorrow has already served 29 of those days, so halving to 15
 * and counting from today would move it from tomorrow to a fortnight out —
 * a miss would have promoted it. The minimum is what makes this a demotion
 * in every case rather than in most.
 *
 * Untouched on purpose: `ease` (the difficulty estimate is calibrated on
 * review grades, and doubles as the definition of a struggling word and the
 * main term in difficultyWeight — three readings that quiz results would
 * blur at once), `lapses` (a lapse is forgetting a word you had learned,
 * established on a graded card), `state`, `stepIndex`, `reps` and
 * `lastReviewedAt`.
 *
 * Returns `prev` itself whenever nothing applies, so a no-op writes nothing
 * — the same identity guarantee clearMissed makes in store.tsx, and what
 * keeps "a second miss the same day changes nothing" checkable rather than
 * merely likely.
 */
export function demoteWord(prev: ProgressEntry, today: string): ProgressEntry {
  // Learning-phase words are already on minute-to-day steps that the drill
  // and the learning steps themselves handle; halving there means nothing.
  if (prev.state !== 'review') return prev
  // One per day. Without this the operation is a one-way ratchet — see
  // ProgressEntry.demotedOn.
  if (prev.demotedOn === today) return prev
  const next = Math.max(1, Math.floor(prev.intervalDays / 2))
  const from = addDays(today, next)
  return {
    ...prev,
    intervalDays: next,
    due: from < prev.due ? from : prev.due,
    demotedOn: today,
  }
}
