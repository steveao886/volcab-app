import type { Grade, ProgressEntry } from '../types'

export const LEARNING_STEPS = 2      // Learning steps: reappears at 1 minute and 10 minutes within the same session
export const MIN_EASE = 1.3
/** Ease a word starts on. Only "easy" ever raises it, so a word answered "good" every time sits here forever — which is what makes distance below it a usable difficulty signal. */
export const INITIAL_EASE = 2.5
/**
 * Ceiling on a review interval.
 *
 * **21 since 2026-11-12, and this time the number is measured.** The review
 * history rebuilt from the data repo's 3,011 progress commits, 5,647 due
 * review-phase grades, by the real gap since the previous review: 95.5%
 * remembered at 4-7 days, 92.2% at 8-14, 88.1% at 15-30, 68.9% at 31-60
 * (n=315), 43.1% past 60 (n=51). A fitted curve puts almost no weight on
 * the gap a word last survived (exponent 0.024), so how long the gap is
 * matters and how the schedule got there does not: 90% at about 18 days,
 * 85% at 24, 80% at 29. Simulated at steady state, per 1,000 words, the
 * ceiling at 21 costs 65.7 reviews and 19.5 minutes a day against 54.5 and
 * 17.5 at 100, and what can be recalled at a random moment goes from 79.9%
 * to 94.2%. Below 21 the cost keeps rising and the gain stops, because
 * 4.3% of misses do not depend on the gap at all.
 *
 * **Do not move it without re-measuring.** The spec lists what would show
 * it is too low (retention at 19-23 day gaps at 93% or more over 300
 * reviews) and what would show one ceiling is the wrong shape:
 * docs/superpowers/specs/2026-11-12-interval-ceiling-design.md.
 *
 * It is also MATURE_INTERVAL_DAYS (queue.ts), and that is relied on: a
 * word at the ceiling lands on exactly 21 for every passing grade, since
 * max(21 + 1, ...) is at least 22 and 22 x 0.95 still rounds to 21. Fuzz
 * that could return 20 would take a word out of 记牢 on a pass.
 *
 * History. It was 365, which meant no ceiling: the schedule reached it and
 * words sat a year out. Then 100, a round number the user asked for, on the
 * argument that quizzes catch a forgotten word in between (questionPool
 * ignores `due`). That net held only while quizzes were played, 8.1
 * sessions a day when it was simulated; from October 2026 they ran at 0 to
 * 6 sessions a week.
 *
 * **Forward-looking only.** Entries already scheduled past this keep their
 * `due` date until they next come up, at which point fuzz() clamps them.
 * The entries written under the 100-day ceiling were rewritten once, by
 * scripts/pull-back-intervals.ts.
 */
export const MAX_INTERVAL_DAYS = 21
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
  startedOn: todayStr(now),
})

// ±5% random fuzz; no fuzzing within 3 days
function fuzz(days: number, rng: () => number): number {
  if (days < 3) return Math.min(days, MAX_INTERVAL_DAYS)
  const factor = 1 + (rng() * 2 - 1) * 0.05
  return Math.min(MAX_INTERVAL_DAYS, Math.max(1, Math.round(days * factor)))
}

/**
 * The floor below which a related-word collision is left alone, and the
 * furthest the date may be pushed.
 *
 * The floor is `fuzz`'s own threshold above, for the same reason: at one or
 * two days the word is still consolidating and a day's delay is a 50–100%
 * change. From three days up a one-day push is at most a third, and falls
 * away fast. Reusing the number also keeps the nudge out of the learning
 * steps and the lapse path (`again` sets `due = today`, interval 0) without
 * either needing a special case.
 */
const NUDGE_MIN_INTERVAL_DAYS = 3
const MAX_NUDGE_DAYS = 2

/**
 * Moves `due` forward off a date a related word already occupies.
 *
 * **Forward only, and `intervalDays` is deliberately not moved with it.**
 * Both halves of that are the same argument, and it is the mirror of the one
 * `demoteWord` below is built on. `gradeWord` computes `next = intervalDays
 * * ease` knowing nothing about elapsed time, so:
 *
 * - pulling `due` *backward* makes the next interval grow as if the full one
 *   had been served when it had not — a systematic over-estimate, and the
 *   bug `71fba29` was;
 * - pushing it *forward* means slightly more time was served than the
 *   interval claims, so the next interval is if anything under-estimated,
 *   which is the safe direction to be wrong in;
 * - adding the nudge to `intervalDays` as well would compound it through
 *   every future review, turning a one-day courtesy into a growing one.
 *
 * Fails open: when every date in reach is also taken, the honest date wins.
 * Spacing is a nicety and the schedule is not.
 */
function nudgePastRelatives(
  due: string,
  intervalDays: number,
  dueTaken: ((due: string) => boolean) | undefined,
): string {
  if (dueTaken === undefined || intervalDays < NUDGE_MIN_INTERVAL_DAYS) return due
  for (let d = 0; d <= MAX_NUDGE_DAYS; d++) {
    const candidate = addDays(due, d)
    if (!dueTaken(candidate)) return candidate
  }
  return due
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
  dueTaken?: (due: string) => boolean,
): ProgressEntry {
  const e = prev && prev.state !== 'new' ? { ...prev } : freshEntry(now)
  e.reps += 1
  e.lastReviewedAt = now.toISOString()
  const today = todayStr(now)

  if (e.state === 'learning') {
    if (grade === 'again') { e.stepIndex = 0; e.due = today }
    else if (grade === 'hard') { e.due = today }
    else if (grade === 'easy') graduate(e, EASY_GRADUATE_DAYS, today, rng, dueTaken)
    else if (e.stepIndex + 1 < LEARNING_STEPS) { e.stepIndex += 1; e.due = today }
    else graduate(e, GRADUATE_DAYS, today, rng, dueTaken)
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
  e.due = nudgePastRelatives(addDays(today, e.intervalDays), e.intervalDays, dueTaken)
  return e
}

function graduate(
  e: ProgressEntry,
  days: number,
  today: string,
  rng: () => number,
  dueTaken?: (due: string) => boolean,
) {
  e.state = 'review'
  e.stepIndex = 0
  e.intervalDays = fuzz(days, rng)
  e.due = nudgePastRelatives(addDays(today, e.intervalDays), e.intervalDays, dueTaken)
}

/** Calendar-day difference between two YYYY-MM-DD strings, parsed as local dates (same convention as addDays). Exported for the review page's confirm showing, which prints the already-scheduled distance instead of grade previews. */
export function diffDays(from: string, to: string): number {
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
  dueTaken?: (due: string) => boolean,
): Record<Grade, string> {
  const today = todayStr(now)
  const out = {} as Record<Grade, string>
  for (const g of ['again', 'hard', 'good', 'easy'] as const) {
    // gradeWord copies before mutating, so prev itself is never touched.
    const next = gradeWord(prev, g, now, () => 0.5, intervalModifier, dueTaken)
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

/**
 * 想不出 on a card the scheduled review showed Chinese-first: the word was
 * due, its 回想 debt was due, and the user could not produce it.
 *
 * `demoteWord`'s contract, restated for a card that is due. `demoteWord`
 * itself cannot be used: it takes a minimum against the existing `due`, which
 * on a due card is today or earlier, so the card would stay due and come
 * straight back. Here the review happened, so `due` is counted from today.
 *
 * **Not a lapse.** The card showed the meaning first, so nothing on it can
 * establish that the word is not recognised, and `ease` — the difficulty
 * estimate, the definition of a struggling word and the main term in
 * difficultyWeight — stays calibrated on recognition grades alone. Same list
 * `demoteWord` leaves untouched, minus `reps` and `lastReviewedAt`: this is a
 * card that was shown and graded, and the timestamp is what lets the write
 * win mergeProgress.
 *
 * **One halving a day, shared with the quiz demotion** (`demotedOn`). A word
 * missed in a quiz this morning has already paid; this afternoon's card
 * reschedules it at the interval it has. And a card halved here is not halved
 * again by a quiz miss tonight.
 *
 * The 71fba29 hazard does not arise: the interval was served in full, and the
 * next grade multiplies the halved one.
 *
 * Returns `prev` itself outside the review phase, like `demoteWord`.
 * See docs/superpowers/specs/2026-11-11-recall-debt-design.md.
 */
export function gradeUnproduced(prev: ProgressEntry, now: Date): ProgressEntry {
  if (prev.state !== 'review') return prev
  const today = todayStr(now)
  const next = prev.demotedOn === today
    ? Math.max(1, prev.intervalDays)
    : Math.max(1, Math.floor(prev.intervalDays / 2))
  const from = addDays(today, next)
  return {
    ...prev,
    reps: prev.reps + 1,
    intervalDays: next,
    // A card that is not due is not this function's to grade, but if one
    // arrives the date still only moves toward now.
    due: prev.due > today && prev.due < from ? prev.due : from,
    demotedOn: today,
    lastReviewedAt: now.toISOString(),
  }
}
