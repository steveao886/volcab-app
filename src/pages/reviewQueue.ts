import type { Grade, ProgressEntry } from '../types'

/**
 * State machine for the review session's queue — pure functions, no React.
 *
 * Built once at the start of a session from buildQueue()'s due+fresh
 * (buildSessionQueue); after that, it can only change via advance(). It
 * must never be replaced mid-session by wholesale swapping in a fresh
 * result from buildQueue() — grade() mutates progress, and a freshly
 * recomputed queue would reshuffle right under the user's eyes.
 */
export interface SessionQueue {
  /** Queue of word ids awaiting review. ids[0] is the currently displayed card; empty means the session is done */
  ids: string[]
  /** Number of cards graded so far, i.e. the progress numerator x */
  seen: number
  /** Cumulative count of cards ever enqueued (including reappearances
   *  within a learning step), i.e. the progress denominator y.
   *  "Again" / learning steps grow this over the course of the session, so
   *  x/y never looks stalled or goes backward when a card is pushed back
   *  to the tail of the queue. */
  total: number
  /**
   * Review-phase cards already sent back to the tail by a 困难 grade this
   * session — the once-per-card cap, and the only reason this field exists.
   *
   * Each 困难 press runs the review-phase branch of gradeWord again:
   * interval `× 1.2` over a "must grow by at least a day" floor, ease
   * `− 0.15`. Before the card could come back, a session could apply that
   * once and no more. Letting the second showing be graded 困难 and
   * re-queued again would compound it without limit — a harm the re-queue
   * rule would have introduced, not one it inherited.
   *
   * Learning-phase recycling does not touch this: it goes through the
   * original condition, is uncapped by design (that is what a learning step
   * *is*), and spending the allowance there would stop a word recycling
   * mid-learning.
   */
  hardRecycled: string[]
}

/** Session queue = due words (due for review) first, followed by fresh words (within today's new-word quota). */
export function buildSessionQueue(due: readonly string[], fresh: readonly string[]): SessionQueue {
  const ids = [...due, ...fresh]
  return { ids, seen: 0, total: ids.length, hardRecycled: [] }
}

/** The head of the queue, i.e. the card that should currently be shown; undefined once the queue is empty. */
export function currentId(q: SessionQueue): string | undefined {
  return q.ids[0]
}

export function isDone(q: SessionQueue): boolean {
  return q.ids.length === 0
}

/**
 * Advances the queue after a card is graded.
 *
 * entry must be the result the caller **reads back** from
 * progress.words[id] after grade() has committed it — this function
 * doesn't recompute SRS rules (that's srs.ts's job), it only makes queue
 * decisions based on the already-committed state, otherwise the two
 * places' judgment of "has the learning step finished" would eventually
 * drift out of sync.
 *
 * If, after grading, the word is still in learning and its due date is
 * still today — meaning the in-session learning step (1min/10min
 * reappearance) hasn't finished yet — it's reinserted at the tail of the
 * queue; otherwise it's dequeued for good.
 *
 * **A review-phase card graded 困难 is also reinserted**, once per session.
 * That one takes the grade rather than the committed entry, and it is the
 * single place this function looks at anything but state: after 困难 the
 * word is still `review` with a future `due`, so the committed entry it
 * leaves behind is indistinguishable from a card that was answered well.
 * User-reported — 重来 was the only grade that actually re-showed a card,
 * and it did so as a side effect of relapsing the word to `learning`, so
 * 困难 both lengthened the interval and bought no second look. When a card
 * is re-shown inside a session was never the scheduler's decision; it is
 * this function's, which is why the fix is here and srs.ts is untouched.
 * See docs/superpowers/specs/2026-08-25-hard-requeue-design.md.
 *
 * Precondition: id must be currentId(q) (i.e. q.ids[0]) — the caller
 * should only ever grade the currently displayed card.
 */
export function advance(
  q: SessionQueue,
  id: string,
  entry: ProgressEntry | undefined,
  today: string,
  /**
   * Practice drills pass false, and must.
   *
   * Recycling is driven by reading the committed entry back, but a
   * practice grade deliberately writes nothing to the word when the answer
   * is correct. A card that was still in `learning` with `due` today would
   * therefore satisfy the recycle test forever: answer it right, it comes
   * back unchanged, answer it right again, and the session never ends.
   */
  allowRecycle = true,
  /**
   * The grade just given, when there is one. Absent for the non-grading
   * callers; only 'hard' does anything here.
   */
  grade?: Grade,
): SessionQueue {
  const rest = q.ids.slice(1)
  const learning = entry !== undefined && entry.state === 'learning' && entry.due <= today
  // Appending is what puts it behind the fresh words too: the queue is
  // built as [...due, ...fresh], so the tail is the end of everything —
  // and it is the only placement that gives the second showing any
  // spacing worth having.
  const hard = grade === 'hard'
    && entry !== undefined
    && entry.state === 'review'
    && !q.hardRecycled.includes(id)
  const recycle = allowRecycle && (learning || hard)
  return {
    ids: recycle ? [...rest, id] : rest,
    seen: q.seen + 1,
    total: recycle ? q.total + 1 : q.total,
    // Only the 困难 path spends the allowance. A learning card recycles
    // through the original condition and must keep recycling until its
    // steps are done.
    hardRecycled: recycle && hard ? [...q.hardRecycled, id] : q.hardRecycled,
  }
}

/**
 * The word at the head of the queue can no longer be found in the library
 * (deleted from another device, sync landed mid-session) — this isn't a
 * grade, it's just dropping it from the queue: it doesn't count toward
 * seen, and total is decremented along with it, otherwise the progress
 * bar's denominator would permanently be one more than the actual card
 * count, and appear stuck below 100%.
 *
 * Same precondition as advance(): the caller should only ever call this on currentId(q).
 */
export function dropCurrent(q: SessionQueue): SessionQueue {
  return { ids: q.ids.slice(1), seen: q.seen, total: q.total - 1, hardRecycled: q.hardRecycled }
}

/**
 * How many cards are left to see.
 *
 * Why this isn't just seen/total displayed directly: total grows with
 * learning-step reappearances, so a user who set "50 new words per day"
 * but sees a denominator of 60 would first assume something was
 * miscalculated. The remaining count only ever decreases, never
 * increases, so it never contradicts the setting — reappearances just
 * make it fall more slowly.
 */
export function remaining(q: SessionQueue): number {
  return q.ids.length
}
