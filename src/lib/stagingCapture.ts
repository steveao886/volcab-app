import { cleanHeadword, normalizeHeadword } from '../state/sync'
import type { StagingItem, Word } from '../types'

/* Lives in lib/ rather than beside the page that first needed it: two
   different surfaces now ask this question — the /add capture box, and
   every synonym chip on a word card. */

/**
 * Deduplication check for quick capture (design doc §6.3: "once case and
 * leading/trailing whitespace are normalized, a word already in
 * words.json or already in staging.json is flagged directly instead of
 * being enqueued again").
 *
 * Pulled out into a pure function because it needs to check two data
 * sources at once and distinguish four different outcomes — buried inside
 * a component, it could only be verified by clicking through the UI, and
 * "duplicate words are correctly blocked" is one of this feature's
 * acceptance criteria.
 */
export type CaptureCheck =
  | { kind: 'empty' }
  | { kind: 'in-library'; id: string; headword: string }
  | { kind: 'in-staging'; headword: string }
  | { kind: 'ok'; headword: string }

export function checkCapture(raw: string, words: Word[], staging: StagingItem[]): CaptureCheck {
  const headword = cleanHeadword(raw)
  if (headword === '') return { kind: 'empty' }

  const key = normalizeHeadword(headword)
  // The library id collapses spaces in a phrase into hyphens ("ad hoc" →
  // "ad-hoc"), so both spellings must be checked: whether the user types
  // "ad hoc" or "ad-hoc", it should be recognized as the same already-
  // captured word.
  const idKey = key.replace(/ /g, '-')
  const hit = words.find(w => normalizeHeadword(w.headword) === key || w.id === idKey)
  if (hit) return { kind: 'in-library', id: hit.id, headword: hit.headword }

  const staged = staging.find(s => normalizeHeadword(s.headword) === key)
  if (staged) return { kind: 'in-staging', headword: staged.headword }

  return { kind: 'ok', headword }
}

/**
 * The same question, reshaped for a chip on a word card: what can a tap on
 * this text do?
 *
 * `inert` is the one case checkCapture's four outcomes don't cover
 * directly. The capture box can tell the user "type something"; a chip
 * cannot, because a blank chip has no user behind it — it is a blank string
 * that reached `collocations` from an older build or another device (new
 * fields on synced data are optional, and the read side is lenient by
 * design). It renders as a plain label, exactly as it did before this was
 * tappable. A button that would stage nothing is worse than no button.
 */
export type ChipCaptureStatus = 'addable' | 'in-staging' | 'in-library' | 'inert'

export function chipCaptureStatus(
  text: string, words: Word[], staging: StagingItem[],
): ChipCaptureStatus {
  switch (checkCapture(text, words, staging).kind) {
    case 'empty': return 'inert'
    case 'in-library': return 'in-library'
    case 'in-staging': return 'in-staging'
    case 'ok': return 'addable'
  }
}
