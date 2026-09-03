import { PRACTICE_DRAW_SIZE } from './practice'
import { storage } from './storage'

/**
 * The batch sizes offered before a free-practice session.
 *
 * 20 is in the list because it is what every session has been until now
 * (PRACTICE_DRAW_SIZE), and it stays the default for that reason. The rest
 * bracket it: 10 for a few minutes on the bus, 30 and 50 for sitting down
 * to it — which is the request this came from, daily review volume falling
 * as the schedule matures and the freed time wanting somewhere to go.
 */
const STEPS = [10, 20, 30, 50] as const

/**
 * What the user picked, as picked — a count, or "whatever is in the pool".
 *
 * Storing `'all'` rather than the number it resolved to is what makes the
 * memory survive a shrinking pool: choosing 全部 47 on the stubborn pool and
 * coming back to 20 words should light up 全部 20, not fall through to
 * nothing because 47 no longer exists.
 */
export type PracticeSizeChoice = number | 'all'

export interface PracticeSizeOption {
  choice: PracticeSizeChoice
  /** Words this option actually draws. */
  size: number
  /** The chip's face. Chinese, like every other string on screen. */
  label: string
}

/**
 * The chips to offer for a pool of this size.
 *
 * Only steps **below** the pool are offered, then one 全部 carrying the
 * pool's own count: a pool of 14 renders `[10] [全部 14]` rather than five
 * buttons of which three do the same thing.
 *
 * An empty pool yields nothing, and the caller is expected to skip the step
 * entirely — asking someone to choose a batch size and then telling them
 * there is nothing to practise would be a small insult.
 */
export function practiceSizeOptions(poolSize: number): PracticeSizeOption[] {
  if (poolSize <= 0) return []
  return [
    ...STEPS.filter(n => n < poolSize).map(n => ({ choice: n, size: n, label: String(n) })),
    { choice: 'all' as const, size: poolSize, label: `全部 ${poolSize}` },
  ]
}

/**
 * Which chip to pre-select, given what was chosen last time.
 *
 * Falls back to the largest option that still fits inside the remembered
 * count, so a remembered 50 against a pool of 14 lands on 全部 14 instead of
 * matching nothing. Never returns undefined for a non-empty list — the step
 * always has something highlighted, so "same as last time" is one tap.
 */
export function preferredOption(
  options: readonly PracticeSizeOption[],
  choice: PracticeSizeChoice,
): PracticeSizeOption | undefined {
  if (options.length === 0) return undefined
  const exact = options.find(o => o.choice === choice)
  if (exact !== undefined) return exact
  const ceiling = choice === 'all' ? Infinity : choice
  return options.filter(o => o.size <= ceiling).at(-1) ?? options[0]
}

/**
 * The last size picked, or 20.
 *
 * **Local, not in `progress.settings`.** settings is synced data: putting it
 * there means a schema addition and a progress.json push on every tap, on
 * the one file three devices write — for a preference whose loss costs a
 * single tap. storage.ts already holds exactly this class of value, each
 * with the same reasoning recorded on it. The price is that the choice does
 * not follow to another device, which was weighed and accepted.
 *
 * Read leniently, like every read path here: a missing key, a string, a
 * fraction, zero or a negative all fall back to the default rather than
 * letting a bad value through into the draw size.
 */
export function readPracticeSize(): PracticeSizeChoice {
  const raw = storage.get<unknown>('practiceSize')
  if (raw === 'all') return 'all'
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : PRACTICE_DRAW_SIZE
}

/** Remembers the choice. The write result is ignored on purpose — losing this costs one tap, unlike the progress write the store checks. */
export function writePracticeSize(choice: PracticeSizeChoice): void {
  storage.set('practiceSize', choice)
}
