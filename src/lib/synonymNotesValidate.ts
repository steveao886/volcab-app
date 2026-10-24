import type { Word } from '../types'
import { glossTerms } from './forget'
import { isInflectionOf } from './headword'
import { currentNote } from './synonymContent'
import type { SynonymNotesFile } from './synonymContent'
import type { SynonymGroup } from './synonymGroups'

/**
 * The write-side gate for src/data/synonymNotes.json (synonym-groups spec §4
 * and R4), shared by scripts/validate-synonym-notes.ts, content-staleness and
 * their tests. Strict here, lenient at runtime: currentNote skips what this
 * would reject, and a group whose paragraph no longer matches shows the
 * pieces.
 *
 * synonymNoteErrors checks one entry on its own; synonymCoverageErrors checks
 * the file against every group, which it can since groups span the whole
 * library and depend on nothing but data/words.json (R1).
 */

/**
 * The cap grows with the group: 100 characters plus 40 a member. On the first
 * batch (30 paragraphs, 2026-10-23) length tracked the number of words
 * compared — pairs ran 118–168 (20 groups), three members 191–210 (6), four
 * 212–225 (2), five 231–275 (2). A flat cap had to choose between letting a
 * pair run 1.6× its longest and refusing a five-word group. 100 + 40n sits
 * 5–16% above the longest paragraph at each size (180 / 220 / 260 / 300).
 *
 * Re-measured over all 326 paragraphs once every group on the page had one
 * (2026-10-23): pairs median 149, max 178 (208 groups); three members 199,
 * 219 (82); four 250, 260 (25); five 275, 288 (9); six 334 (2, cap 340).
 * Those 296 were drafted with this cap printed in the brief, so they measure
 * the cap as much as the content: 16 of the 25 four-member paragraphs sit
 * within 5% of 260, and none read as cut short in review. If a group's real
 * distinction will not fit, raise the per-member rate, not the base: the
 * pressure is on the larger groups, and pairs (4 of 208 near their cap) are
 * where padding would show.
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

  const names = namer(text, [...seen].flatMap((id) => {
    const h = wordsById.get(id)?.headword
    return h === undefined ? [] : [h]
  }))
  for (const id of seen) {
    const w = wordsById.get(id)
    if (w === undefined) { errors.push(`${key}: ${id} is not in data/words.json`); continue }
    // The key must be a gloss term the member really carries, so the
    // paragraph is about the meaning the group is built on.
    if (!w.meanings.some((m) => glossTerms(m.zh).includes(key))) {
      errors.push(`${key}: ${id} carries no meaning with the gloss term ${key}`)
    }
    if (!names(w.headword)) errors.push(`${key}: text never names ${w.headword}`)
  }
  return errors
}

/**
 * Every group against the file: each group has a current paragraph, which
 * names each of its base words (R2), and no paragraph is current for no group
 * (orphaned by a library edit or a deletion). Adding a word that creates or
 * changes a group therefore fails the gate until its paragraph is written —
 * the user's 确保也加到这里.
 */
export function synonymCoverageErrors(groups: SynonymGroup[], file: SynonymNotesFile, wordsById: Map<string, Word>): string[] {
  const errors: string[] = []
  const usedKeys = new Set<string>()
  for (const g of groups) {
    const key = currentNote(g, file)?.key
    if (key !== undefined) usedKeys.add(key)
    errors.push(...groupCoverageErrors(g, file, wordsById))
  }
  for (const key of Object.keys(file.notes ?? {})) {
    if (!usedKeys.has(key)) errors.push(`${key}: paragraph is current for no group`)
  }
  return errors
}

/** One group's share of synonymCoverageErrors, without the orphan check: what content-staleness --batch reports per word. */
export function groupCoverageErrors(g: SynonymGroup, file: SynonymNotesFile, wordsById: Map<string, Word>): string[] {
  const note = currentNote(g, file)
  if (note === undefined) return [`${g.key}: no current paragraph (${g.members.map((m) => m.id).join(', ')})`]
  const headOf = (id: string) => wordsById.get(id)?.headword
  const names = namer(note.text, [
    ...g.members.flatMap((m) => headOf(m.id) ?? []),
    ...g.bridges.map((b) => b.form),
  ])
  const errors: string[] = []
  // Members again, now that the base words are known: a base word's token
  // (uneasy) must not count as naming its member (unease), and only this check
  // knows which tokens are base words.
  for (const m of g.members) {
    const h = headOf(m.id)
    if (h !== undefined && !names(h)) errors.push(`${g.key}: paragraph never names ${h}`)
  }
  for (const b of g.bridges) {
    if (!names(b.form)) errors.push(`${g.key}: paragraph never names base word ${b.form} (for ${b.for})`)
  }
  return errors
}

/**
 * Whether `text` names a headword: as a word or an inflection, not a
 * substring (mire must not pass on "admire"); a multi-word headword as the
 * phrase. **A token that is exactly one of `heads` names that word alone**:
 * isInflectionOf accepts some derivations in both directions (unease /
 * uneasy, diminishing / diminish), so without this a paragraph naming only
 * uneasy passed for unease — 22 of 519 groups hold such a pair (final review,
 * 2026-10-23) — and one naming diminishing would pass for its base word.
 */
function namer(text: string, heads: string[]): (headword: string) => boolean {
  const tokens = (text.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/g) ?? []).map((t) => t.toLowerCase())
  const lower = text.toLowerCase()
  const exact = new Set(heads.map((h) => h.trim().toLowerCase()).filter((h) => !h.includes(' ')))
  return (headword) => {
    const h = headword.trim().toLowerCase()
    return h.includes(' ')
      ? lower.includes(h)
      : tokens.some((t) => t === h || (!exact.has(t) && isInflectionOf(t, h)))
  }
}
