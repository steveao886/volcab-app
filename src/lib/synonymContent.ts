import type { Word } from '../types'
import { contrastNoteKey } from './contrastNotes'
import type { ContrastNotesFile } from './contrastNotes'
import type { SynonymGroup, SynonymMember } from './synonymGroups'
import { wordNote } from './wordNotes'
import type { WordNotesFile } from './wordNotes'

/**
 * What one 近义词 group shows (spec §3): a paragraph written for exactly its
 * members (B), or until one exists, the existing word notes and pair notes
 * (A). Both list each member's carrying meanings and, where it describes the
 * right sense, its collocations as the usage line.
 */

/** src/data/synonymNotes.json — one paragraph per group, keyed by a gloss term of the group it was written for. */
export interface SynonymNotesFile {
  version: 1
  notes: Record<string, { members: string[]; text: string }>
}

export interface MemberView {
  id: string
  headword: string
  /** The carrying meanings, in meaning order. */
  meanings: { pos: string; zh: string }[]
  /** Collocations, first-meaning members only; empty otherwise. */
  usage: string[]
  /** The word note, in the pieces view and on first-meaning members only. */
  note?: string
}

export type GroupView =
  | { kind: 'paragraph'; title: string; members: MemberView[]; text: string }
  | { kind: 'pieces'; title: string; members: MemberView[]; pairs: { a: string; b: string; text: string }[]; missing: number }

/**
 * The paragraph written for exactly these members, under any of the group's
 * terms. **Set equality, not overlap**: a paragraph over other members could
 * name a word the list does not show or say nothing about one it does, so a
 * group that gains or loses a word (a library edit, or a deletion the repo
 * copy has not caught up with) falls back to the pieces until the paragraph is
 * rewritten. The write-side gate keeps the repo copy complete (spec R4).
 * Malformed entries are skipped.
 */
export function currentNote(group: SynonymGroup, file: SynonymNotesFile): { members: string[]; text: string } | undefined {
  const ids = new Set(group.members.map((m) => m.id))
  for (const term of group.terms) {
    const raw: unknown = file.notes?.[term]
    if (typeof raw !== 'object' || raw === null) continue
    const { members, text } = raw as { members?: unknown; text?: unknown }
    if (!Array.isArray(members) || !members.every((m) => typeof m === 'string') || typeof text !== 'string') continue
    if (members.length === ids.size && new Set(members).size === ids.size && members.every((m) => ids.has(m))) {
      return { members, text }
    }
  }
  return undefined
}

/**
 * **Per-word content shows on first-meaning members only.** Collocations,
 * word notes and pair notes are all written per word or per pair, not per
 * sense, and describe the word by its first one. On the live library 125 of
 * the 128 later-meaning member slots have a word note, and some are about
 * another sense (`assuage` in 满足 would show 宾语是情绪本身——恐惧、内疚、
 * 疑虑, which is 缓和); 87 of the 407 pair notes the pieces would show
 * involve such a member (`appease|assuage` in 满足 compares 安抚). A note about
 * the wrong sense is a false anchor, so they fail closed, and the paragraph
 * replaces them in time. Measured by the builder check, 2026-10-23.
 *
 * A member whose word is gone (deleted on another device mid-visit) is left
 * out, and a group left with fewer than two is `null`, for the page to skip.
 */
export function groupView(
  group: SynonymGroup,
  wordsById: Map<string, Word>,
  notes: SynonymNotesFile,
  contrast: ContrastNotesFile,
  wordNotes: WordNotesFile,
): GroupView | null {
  const live = group.members.filter((m) => wordsById.has(m.id))
  if (live.length < 2) return null
  const view = (m: SynonymMember, withNote: boolean): MemberView => {
    const w = wordsById.get(m.id) as Word
    const note = withNote && m.firstMeaning ? wordNote(wordNotes, m.id) : undefined
    return {
      id: m.id,
      headword: w.headword,
      meanings: m.carrying.flatMap((i) => {
        const meaning = w.meanings[i]
        return meaning === undefined ? [] : [{ pos: meaning.pos, zh: meaning.zh }]
      }),
      usage: m.firstMeaning && Array.isArray(w.collocations) ? w.collocations : [],
      ...(note === undefined ? {} : { note }),
    }
  }

  const paragraph = currentNote({ ...group, members: live }, notes)
  if (paragraph !== undefined) {
    const byId = new Map(live.map((m) => [m.id, m]))
    return {
      kind: 'paragraph',
      title: group.key,
      members: paragraph.members.map((id) => view(byId.get(id) as SynonymMember, false)),
      text: paragraph.text,
    }
  }

  const pairs: { a: string; b: string; text: string }[] = []
  let total = 0
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      total += 1
      const a = live[i], b = live[j]
      if (!a.firstMeaning || !b.firstMeaning) continue
      const text: unknown = contrast.notes[contrastNoteKey(a.id, b.id)]
      if (typeof text === 'string') pairs.push({ a: a.id, b: b.id, text })
    }
  }
  return {
    kind: 'pieces',
    title: group.key,
    members: live.map((m) => view(m, true)),
    pairs,
    missing: total - pairs.length,
  }
}
