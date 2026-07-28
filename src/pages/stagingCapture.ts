import { cleanHeadword, normalizeHeadword } from '../state/sync'
import type { StagingItem, Word } from '../types'

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
