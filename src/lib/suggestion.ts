import type { StagingItem, Word } from '../types'

/**
 * The suggestion pool: vocabulary the app offers, for the user to accept or reject.
 *
 * **Deliberately not in src/types.ts**, for the same reason as Passage in
 * ./passage.ts: that file is the *synced* data model, pulled and pushed
 * against volcab-data through the whole merge and conflict-handling setup.
 * The pool is read-only content shipped inside the bundle, never
 * participates in sync, and doesn't belong under that schema. Don't
 * "relocate" this there later.
 *
 * The two halves of the decision live in different places on purpose:
 * **accepting** a suggestion drops it into the existing staging area, so it
 * travels the same capture → enrich → words.json path as anything typed in
 * by hand and needs no storage of its own; **rejecting** one writes an id
 * into `progress.dismissed`, which does sync, because it has to survive
 * every future batch.
 *
 * The app cannot invent suggestions — there is no server and no model in it.
 * This pool is written during a session and refreshed the same way. That is
 * a real limit of the architecture, not an oversight: the page shows what
 * was last written, and goes quiet once the user has worked through it.
 */
export interface Suggestion {
  /** Lowercase, whitespace-free; spaces become hyphens, matching the library's own id rule so an accepted suggestion keeps its identity. */
  id: string
  headword: string
  kind: SuggestionKind
  zh: string
  en: string
  /** 1–10, same scale and anchors as Word.usageScore. */
  usageScore: number
  example: string
  /** One line on the trap, the register, or why it beats the obvious synonym. Absent when there is nothing real to say. */
  note?: string
}

export type SuggestionKind = 'phrasal' | 'idiom' | 'expression'

export interface SuggestionFile { version: 1; items: Suggestion[] }

export const KIND_LABEL: Record<SuggestionKind, string> = {
  phrasal: '短语动词',
  idiom: '惯用语',
  expression: '固定表达',
}

/** Case and whitespace folded, so "Put  Off" and "put off" are recognised as the same thing however they were typed. */
const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ')

export interface PoolFilter {
  words: Word[]
  staging: StagingItem[]
  dismissed: string[]
}

/**
 * Everything in the pool the user hasn't already settled.
 *
 * Three exclusions, and all three are needed — they fail in different ways:
 * already in the library (you own it), already staged (you accepted it but
 * it hasn't been enriched yet, which can take until the next session), and
 * dismissed (you said no, and being asked again is the specific annoyance
 * `progress.dismissed` exists to prevent).
 *
 * Matching is by id *and* by normalised headword. Id alone isn't enough: a
 * word can reach the library through the manual /add form, where the user
 * types a headword and the id is derived, and nothing guarantees that
 * derivation matches the pool's id for the same phrase.
 */
export function availableSuggestions(pool: Suggestion[], { words, staging, dismissed }: PoolFilter): Suggestion[] {
  const taken = new Set<string>()
  for (const w of words) { taken.add(norm(w.id)); taken.add(norm(w.headword)) }
  for (const s of staging) taken.add(norm(s.headword))
  for (const d of dismissed) taken.add(norm(d))
  return pool.filter(s => !taken.has(norm(s.id)) && !taken.has(norm(s.headword)))
}

/**
 * Orders what's left: most likely to be met first.
 *
 * The pool has no notion of what the user already knows, so encounter
 * likelihood is the only honest ranking signal available — and it is the
 * right one anyway, since the whole point of the batch is to close the gap
 * between a library of Latinate single words and the phrasing that actually
 * fills contemporary English. Ties break on id so the order never shifts
 * between renders.
 */
export function rankSuggestions(items: Suggestion[]): Suggestion[] {
  return [...items].sort((a, b) => b.usageScore - a.usageScore || a.id.localeCompare(b.id))
}
