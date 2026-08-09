import { rankStrugglingWords } from './queue'
import { difficultyWeight, shuffle, weightedShuffle } from './quiz'
import type { Progress, Word } from '../types'

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

/**
 * Words the Today-page practice row is allowed to draw from: everything
 * you have mastered, plus everything you keep forgetting.
 *
 * The two overlap heavily — a struggling word is usually in the review
 * state too — so this is a union, not a concatenation. It exists so the
 * page can ask "is there anything left I haven't drawn?" with the same
 * question it asks of a library slice.
 */
export function mixedPracticePool(words: Word[], progress: Progress): Word[] {
  const seen = new Set<string>()
  const out: Word[] = []
  for (const w of [...rankStrugglingWords(words, progress), ...words.filter(w => progress.words[w.id]?.state === 'review')]) {
    if (seen.has(w.id)) continue
    seen.add(w.id)
    out.push(w)
  }
  return out
}

/**
 * The Today-page draw: **half at random from what you have mastered, half
 * from what you keep forgetting.**
 *
 * Why not just random over the mastered set, which is what was asked for
 * first: as the library matures almost everything ends up in the review
 * state, so "random among mastered" converges on "random among all" and
 * stops being a choice at all. Reserving half the deck for the struggling
 * ranking keeps the hard words present no matter how large the mastered
 * set grows.
 *
 * **The struggling half is drawn weighted, not taken from the top.** The
 * ranking is already sorted hardest-first, and slicing it would hand back
 * the same ten words every single session — precisely the frozen-list
 * complaint that rebuilt this ranking in the first place (see the
 * 2026-08-05 struggling-words spec). weightedShuffle through
 * difficultyWeight is the mechanism the quiz, 猜词 and sense-group modes
 * all already use: the hardest words come up most often, and none of the 81
 * is ever unreachable.
 *
 * The random half draws from mastered words that are **not** struggling —
 * the complement, not merely a dedup against what the first half took. A
 * struggling word is in the review state too, so drawing the second half
 * from all mastered words pulls more hard ones in on top of the ten already
 * chosen: measured on a 30-hard/30-easy fixture it produced 16 hard words
 * out of 20, not 10. That is a different mode from the one this advertises.
 *
 * Either half backfills from the other when its own pool runs dry, so a
 * young library with three struggling words still gets a full deck.
 */
export function buildMixedPractice(
  words: Word[],
  progress: Progress,
  size: number = PRACTICE_DRAW_SIZE,
  opts: { rng?: () => number; exclude?: ReadonlySet<string> } = {},
): Word[] {
  if (size <= 0) return []
  const { rng = Math.random, exclude } = opts
  const available = (w: Word) => exclude === undefined || !exclude.has(w.id)

  const struggling = rankStrugglingWords(words, progress)
  const isStruggling = new Set(struggling.map(w => w.id))

  const hard = weightedShuffle(
    struggling.filter(available),
    w => difficultyWeight(w, progress),
    rng,
  )
  const steady = shuffle(
    words.filter(w => progress.words[w.id]?.state === 'review' && !isStruggling.has(w.id)).filter(available),
    rng,
  )

  const picked: Word[] = []
  const taken = new Set<string>()
  const take = (from: Word[], n: number) => {
    for (const w of from) {
      if (picked.length >= size || n <= 0) break
      if (taken.has(w.id)) continue
      taken.add(w.id)
      picked.push(w)
      n--
    }
  }

  take(hard, Math.floor(size / 2))
  take(steady, size - picked.length)
  take(hard, size - picked.length)   // the steady side ran short — fall back to the other half

  // Shuffled at the end so the deck doesn't open with a run of hard words
  // and then coast; the two halves have to be interleaved for the session
  // to feel like one batch rather than two.
  return shuffle(picked, rng)
}
