import { shuffle } from './quiz'
import type { Word } from '../types'

/**
 * How many words one free-practice draw brings in.
 *
 * The same number as LAPSE_SESSION_SIZE, and for the same stated reason —
 * roughly what one sitting can clear. Kept as its own constant rather than
 * imported from queue.ts: the two sessions answer to different things (that
 * one to a daily budget, this one to attention span), and tying them
 * together would mean a future change to the drill silently resizes this.
 */
export const PRACTICE_DRAW_SIZE = 20

/**
 * Draws one round of free practice out of an already-filtered pool.
 *
 * The caller has done the selecting — this is handed exactly the list the
 * library page was showing — so there is no `progress` argument and no
 * second opinion about which words are worth practising.
 *
 * **A plain shuffle, deliberately not weightedShuffle.** Every other
 * selection surface in the app biases toward difficulty (quiz.ts, guess.ts
 * and senseGroup.ts all draw through `difficultyWeight`), and the case for
 * doing it here is real: harder words repay practice more. It is still
 * wrong here. The pool is one the user assembled by hand a moment earlier,
 * and the button they pressed said 打乱. A hidden bias would make some words
 * keep reappearing across redraws while others never surfaced, with nothing
 * on screen to explain it — in a mode whose whole premise is that nothing
 * is being decided on your behalf.
 *
 * `exclude` carries the words already seen this session, so 另来一批 walks
 * through the slice instead of resampling it. Returning fewer than `size`
 * is the normal way a slice ends; returning empty is how the caller knows
 * it is exhausted.
 */
export function samplePractice(
  pool: Word[],
  size: number = PRACTICE_DRAW_SIZE,
  opts: { rng?: () => number; exclude?: ReadonlySet<string> } = {},
): Word[] {
  if (size <= 0) return []
  const { rng = Math.random, exclude } = opts
  const eligible = exclude === undefined ? pool : pool.filter(w => !exclude.has(w.id))
  return shuffle(eligible, rng).slice(0, size)
}
