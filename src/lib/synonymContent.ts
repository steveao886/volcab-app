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
  /**
   * The entry's `antonyms`, first-meaning members only, for the usage line's
   * reason: an antonym hangs off the word, and on a later-meaning member it
   * answers the other sense (spec R3). Includes words outside the library.
   */
  antonyms: string[]
  /** The word note, in the pieces view and on first-meaning members only. */
  note?: string
  /**
   * The base word a lone member brings (spec R2), with the library word's
   * collocations when the form is one; empty otherwise.
   */
  bridge?: { form: string; pos: string; zh: string; usage: string[] }
}

/** The opposite group, compact: its words and, when current, its own paragraph (spec R3). */
export interface OppositeView {
  title: string
  members: { id: string; headword: string; meanings: { pos: string; zh: string }[] }[]
  text?: string
}

export type GroupView =
  | { kind: 'paragraph'; title: string; members: MemberView[]; text: string; opposite?: OppositeView }
  | { kind: 'pieces'; title: string; members: MemberView[]; pairs: { a: string; b: string; text: string }[]; missing: number; opposite?: OppositeView }

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
  opposite?: SynonymGroup,
): GroupView | null {
  const live = group.members.filter((m) => wordsById.has(m.id))
  if (live.length < 2) return null
  const oppositeView = opposite === undefined ? undefined : viewOpposite(opposite, wordsById, notes)
  const withOpposite = oppositeView === undefined ? {} : { opposite: oppositeView }
  const bridgeOf = new Map((Array.isArray(group.bridges) ? group.bridges : []).map((b) => [b.for, b]))
  const view = (m: SynonymMember, withNote: boolean): MemberView => {
    const w = wordsById.get(m.id) as Word
    const note = withNote && m.firstMeaning ? wordNote(wordNotes, m.id) : undefined
    const b = bridgeOf.get(m.id)
    const base = b?.wordId === undefined ? undefined : wordsById.get(b.wordId)
    const bridge = b === undefined ? undefined : {
      form: b.form, pos: b.pos, zh: b.zh,
      usage: base !== undefined && Array.isArray(base.collocations) ? base.collocations : [],
    }
    return {
      id: m.id,
      headword: w.headword,
      meanings: m.carrying.flatMap((i) => {
        const meaning = w.meanings[i]
        return meaning === undefined ? [] : [{ pos: meaning.pos, zh: meaning.zh }]
      }),
      usage: m.firstMeaning && Array.isArray(w.collocations) ? w.collocations : [],
      antonyms: m.firstMeaning && Array.isArray(w.antonyms) ? w.antonyms.filter((a) => typeof a === 'string') : [],
      ...(note === undefined ? {} : { note }),
      ...(bridge === undefined ? {} : { bridge }),
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
      ...withOpposite,
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
    ...withOpposite,
  }
}

/** The opposite group's words, in its paragraph's order when it has a current one; undefined when fewer than two of its words remain. */
function viewOpposite(group: SynonymGroup, wordsById: Map<string, Word>, notes: SynonymNotesFile): OppositeView | undefined {
  const live = group.members.filter((m) => wordsById.has(m.id))
  if (live.length < 2) return undefined
  const paragraph = currentNote({ ...group, members: live }, notes)
  const order = paragraph?.members ?? live.map((m) => m.id)
  const byId = new Map(live.map((m) => [m.id, m]))
  return {
    title: group.key,
    members: order.flatMap((id) => {
      const m = byId.get(id)
      const w = wordsById.get(id)
      if (m === undefined || w === undefined) return []
      return [{
        id, headword: w.headword,
        meanings: m.carrying.flatMap((i) => {
          const meaning = w.meanings[i]
          return meaning === undefined ? [] : [{ pos: meaning.pos, zh: meaning.zh }]
        }),
      }]
    }),
    ...(paragraph === undefined ? {} : { text: paragraph.text }),
  }
}
