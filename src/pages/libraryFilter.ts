import type { Progress, Word, WordState } from '../types'

/** Values for the status-filter chip; 'all' applies no filtering. */
export type StatusFilter = 'all' | WordState

export interface LibraryFilterOptions {
  query: string
  status: StatusFilter
  /** null = no source-note restriction; otherwise matches Word.sourceNote exactly */
  sourceNote: string | null
}

/**
 * An entry with no record in progress.words is treated as 'new' —
 * consistent with how buildQueue judges the same thing. Exported so
 * Library (the row status dot) and WordDetail (learning-state stats) share
 * one implementation instead of each writing their own.
 */
export function wordState(word: Word, progress: Progress): WordState {
  return progress.words[word.id]?.state ?? 'new'
}

function matchesStatus(word: Word, progress: Progress, status: StatusFilter): boolean {
  return status === 'all' || wordState(word, progress) === status
}

function matchesSourceNote(word: Word, sourceNote: string | null): boolean {
  return sourceNote === null || word.sourceNote === sourceNote
}

/**
 * Search match tier — the smaller the number, the higher it sorts:
 *   0 headword prefix   1 headword substring (not a prefix)   2 substring match in the meaning (en/zh) only
 * An empty query counts as "matches everything", uniformly given tier 0,
 * so sorting effectively falls back to plain alphabetical order.
 * Returns null to mean no match; the caller excludes it from the results
 * accordingly.
 */
function searchRank(word: Word, needle: string): 0 | 1 | 2 | null {
  if (needle === '') return 0
  const headword = word.headword.toLowerCase()
  if (headword.startsWith(needle)) return 0
  if (headword.includes(needle)) return 1
  for (const m of word.meanings) {
    // zh must also be lowercased: Chinese meanings frequently mix in Latin
    // letters (AI, CEO, DNA...); needle is already lowercase, so skipping
    // this would effectively make matching case-sensitive for those words.
    if (m.en.toLowerCase().includes(needle) || m.zh.toLowerCase().includes(needle)) return 2
  }
  return null
}

/**
 * Pure-function core of library search + filtering.
 *
 * How they combine: the search query, the status chip, and the sourceNote
 * chip are ANDed together — all three must be satisfied for an entry to be
 * kept. This is the most intuitive reading, and it's also the only usage
 * ever mentioned in the product spec.
 *
 * Sorting: with no search query, alphabetical by headword; with a query,
 * first by match tier (headword prefix > headword substring > meaning-only
 * match), then alphabetical by headword within the same tier — putting the
 * words closest to the input first, rather than preserving the library's
 * original order.
 */
export function filterWords(words: Word[], progress: Progress, opts: LibraryFilterOptions): Word[] {
  const needle = opts.query.trim().toLowerCase()
  const scored: { word: Word; rank: 0 | 1 | 2 }[] = []
  for (const word of words) {
    if (!matchesStatus(word, progress, opts.status)) continue
    if (!matchesSourceNote(word, opts.sourceNote)) continue
    const rank = searchRank(word, needle)
    if (rank === null) continue
    scored.push({ word, rank })
  }
  scored.sort((a, b) => a.rank - b.rank || a.word.headword.localeCompare(b.word.headword))
  return scored.map(s => s.word)
}

/**
 * Every sourceNote that appears in the library, deduplicated.
 * Most values are Evernote note line ranges (e.g. "8-11"); sorting by the
 * starting number ascending is more intuitive than string dictionary order
 * ("104-106" shouldn't sort before "12-15"). Values that can't be parsed
 * as a number (like "manual" for manually-added entries) are all pushed to
 * the end, sorted alphabetically.
 */
export function distinctSourceNotes(words: Word[]): string[] {
  const set = new Set(words.map(w => w.sourceNote))
  return [...set].sort((a, b) => {
    const na = parseInt(a, 10)
    const nb = parseInt(b, 10)
    const aNum = !Number.isNaN(na)
    const bNum = !Number.isNaN(nb)
    if (aNum && bNum && na !== nb) return na - nb
    if (aNum !== bNum) return aNum ? -1 : 1
    return a.localeCompare(b)
  })
}
