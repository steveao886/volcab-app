import type { Meaning } from '../types'

/**
 * Shared rules for two rating-style metadata fields on a word entry: meaning share
 * (`Meaning.share`) and contemporary usage likelihood (`Word.usageScore`), and the value
 * ranges each may take. Defined once, used in three places: the `/add` form, the entry edit
 * form, and `scripts/validate-words.ts`'s ingestion validation.
 *
 * Lives in src/lib rather than scripts/ because a comment in WordEditForm.tsx already paid
 * for this lesson once — "validation must stay aligned with scripts/validate-words.ts, or
 * entries saved here will silently drift out of schema." Maintaining two separate copies
 * would eventually drift apart, so the script imports this module instead.
 */

/** The selectable values for contemporary usage likelihood. The form renders it as a dropdown, so "an integer from 1–10" can never be entered wrong. */
export const USAGE_SCORE_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

/**
 * Share values are restricted to multiples of ten, excluding both 0 and 100.
 *
 * This isn't laziness: share is a rough order-of-magnitude estimate the AI makes during the
 * session based on general knowledge of contemporary usage, with no corpus statistics behind
 * it. A value like 87%/13% would imply a source like COCA, which would be false precision.
 * 0 and 100 are excluded too — 100% would mean the word is actually single-meaning (and
 * shouldn't have a share at all), while 0% would mean this meaning shouldn't have been
 * included in the first place.
 *
 * The form uses this to render its dropdown options, so the "multiples of ten" constraint
 * becomes structurally impossible to violate.
 */
export const SHARE_OPTIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90] as const

type HasShare = Pick<Meaning, 'share'>

const isValidShare = (s: number | undefined): boolean =>
  s !== undefined && Number.isInteger(s) && s >= 10 && s <= 90 && s % 10 === 0

/** The total; meanings missing a share count as 0, so the form's "total X%" can show how far short it still is. */
export function shareSum(meanings: readonly HasShare[]): number {
  return meanings.reduce((sum, m) => sum + (m.share ?? 0), 0)
}

/**
 * Whether a set of meanings' shares are internally consistent. Returns null when valid,
 * otherwise a message ready to show the user directly.
 *
 * **Does not check ordering**: the form lets the user fill things in in any order, and
 * normalizeMeanings re-sorts them descending before they're saved, so there's no need to
 * block the user over something that gets fixed automatically. Ordering within the data
 * file is checked separately by isShareOrdered.
 */
export function validateShares(meanings: readonly HasShare[]): string | null {
  if (meanings.length === 0) return null // "At least one meaning" is validated upstream; not repeated here

  const filled = meanings.filter(m => m.share !== undefined)

  if (meanings.length === 1) {
    return filled.length > 0 ? '单义词不应标注义项占比(占比只对一词多义有意义)。' : null
  }

  if (filled.length !== meanings.length) {
    return `一词多义时每条释义都要标注占比(当前 ${meanings.length} 条里填了 ${filled.length} 条)。`
  }

  const bad = meanings.findIndex(m => !isValidShare(m.share))
  if (bad !== -1) {
    return `义项占比必须是 10–90 的整十,第 ${bad + 1} 条为 ${meanings[bad].share}。`
  }

  const sum = shareSum(meanings)
  if (sum !== 100) return `义项占比合计须为 100%,当前 ${sum}%。`

  return null
}

/**
 * Whether the meanings in the data file are already sorted by share, highest to lowest.
 *
 * Keeping the storage layer sorted lets the three rendering sites (the review card, the
 * detail page, the edit form) stay naturally consistent without any of them having to sort
 * on the fly; it also means the number in front of each meaning doubles as a
 * frequency-of-use rank. Equal shares (50/50) count as sorted.
 */
export function isShareOrdered(meanings: readonly HasShare[]): boolean {
  for (let i = 1; i < meanings.length; i++) {
    const prev = meanings[i - 1].share
    const cur = meanings[i].share
    if (prev === undefined || cur === undefined) continue
    if (cur > prev) return false
  }
  return true
}

/**
 * Normalization before saving to the store: strips share from single-meaning words, and
 * stably re-sorts multi-meaning words by share descending. Does not mutate the input.
 *
 * When shares tie, a stable sort preserves the original ordering — a 50/50 word has no
 * inherent primary/secondary distinction to begin with, and shouldn't have its two meanings
 * swapped just because of some unrelated edit.
 */
export function normalizeMeanings<T extends HasShare>(meanings: readonly T[]): T[] {
  if (meanings.length <= 1) {
    return meanings.map(m => {
      if (m.share === undefined) return m
      const { share: _share, ...rest } = m
      return rest as T
    })
  }
  return meanings
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (b.m.share ?? 0) - (a.m.share ?? 0) || a.i - b.i)
    .map(x => x.m)
}
