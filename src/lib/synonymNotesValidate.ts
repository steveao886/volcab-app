import type { Word } from '../types'
import { glossTerms } from './forget'
import { isInflectionOf } from './headword'

/**
 * The write-side gate for one src/data/synonymNotes.json entry
 * (synonym-groups spec §4), shared by scripts/validate-synonym-notes.ts and
 * its tests. Strict here, lenient at runtime: currentNote skips what this
 * would reject.
 *
 * It cannot know which words are studied — that lives in volcab-data — so
 * whether a paragraph still matches the group the page shows is
 * synonym-todo's question, not this gate's.
 */

/**
 * Provisional. The spec sets the real cap from the first 30-group batch:
 * re-measure that batch and replace this number. The B sample in the mockups
 * ran about 170 characters for four words.
 */
export const MAX_SYNONYM_NOTE = 300

export function synonymNoteErrors(key: string, entry: unknown, wordsById: Map<string, Word>): string[] {
  if (typeof entry !== 'object' || entry === null) return [`${key}: entry must be { members, text }`]
  const { members, text } = entry as { members?: unknown; text?: unknown }
  if (!Array.isArray(members) || !members.every((m) => typeof m === 'string') || typeof text !== 'string') {
    return [`${key}: entry must be { members: string[], text: string }`]
  }

  const errors: string[] = []
  if (members.length < 2) errors.push(`${key}: needs at least 2 members, has ${members.length}`)
  const seen = new Set<string>()
  for (const id of members) {
    if (seen.has(id)) errors.push(`${key}: repeats ${id}`)
    seen.add(id)
  }

  if (text.trim() === '') errors.push(`${key}: text is empty`)
  if (text.length > MAX_SYNONYM_NOTE) errors.push(`${key}: text is ${text.length} chars (max ${MAX_SYNONYM_NOTE})`)

  const tokens = (text.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/g) ?? []).map((t) => t.toLowerCase())
  const lower = text.toLowerCase()
  // A token that is exactly one member's headword names that member alone.
  // isInflectionOf accepts some derivations in both directions (unease /
  // uneasy, entreat / entreaty), so without this a paragraph naming only
  // uneasy passed for unease — 22 of 519 groups hold such a pair with every
  // word counted studied (final review, 2026-10-23).
  const memberHeads = new Set(
    [...new Set(members)].flatMap((id) => {
      const h = wordsById.get(id)?.headword.trim().toLowerCase()
      return h === undefined || h.includes(' ') ? [] : [h]
    }),
  )
  for (const id of seen) {
    const w = wordsById.get(id)
    if (w === undefined) { errors.push(`${key}: ${id} is not in data/words.json`); continue }
    // The key must be a gloss term the member really carries, so the
    // paragraph is about the meaning the group is built on.
    if (!w.meanings.some((m) => glossTerms(m.zh).includes(key))) {
      errors.push(`${key}: ${id} carries no meaning with the gloss term ${key}`)
    }
    // Named as a word or an inflection, not a substring: mire must not pass
    // on "admire". A multi-word headword is matched as the phrase.
    const h = w.headword.trim().toLowerCase()
    const named = h.includes(' ')
      ? lower.includes(h)
      : tokens.some((t) => t === h || (!memberHeads.has(t) && isInflectionOf(t, h)))
    if (!named) errors.push(`${key}: text never names ${w.headword}`)
  }
  return errors
}
