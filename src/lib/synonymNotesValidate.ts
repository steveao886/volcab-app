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
 * The cap grows with the group: 100 characters plus 40 a member. On the first
 * batch (30 paragraphs, 2026-10-23) length tracked the number of words
 * compared — pairs ran 118–168 (20 groups), three members 191–210 (6), four
 * 212–225 (2), five 231–275 (2). A flat cap had to choose between letting a
 * pair run 1.6× its longest and refusing a five-word group. 100 + 40n sits
 * 5–16% above the longest paragraph at each size (180 / 220 / 260 / 300).
 * The live page's largest groups have 6 members (2 of 326), so 340 there is
 * extrapolated: re-measure once one is written.
 */
export function maxSynonymNote(memberCount: number): number {
  return 100 + 40 * memberCount
}

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
  const max = maxSynonymNote(members.length)
  if (text.length > max) errors.push(`${key}: text is ${text.length} chars (max ${max} for ${members.length} members)`)

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
