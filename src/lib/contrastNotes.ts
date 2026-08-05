/**
 * Explanations for confusable-word pairs, shown after a contrast question.
 *
 * The comparison card already lays the two entries side by side, but a
 * learner who just picked the wrong twin is looking for one specific thing
 * the raw fields don't state: **what actually separates these two** — the
 * dimension (object, register, connotation, grammar) that decides which one
 * a sentence wants. That judgment isn't derivable from the data at runtime,
 * so it's authored content, bundled like passages and suggestions:
 * `src/data/contrastNotes.json`, read-only, outside the synced schema in
 * src/types.ts on purpose.
 *
 * The pair set is computed from the library (buildContrastPairs) and moves
 * as words come and go, so coverage is best-effort by design: a pair with
 * no note simply shows no note — the write-side gate
 * (validate-contrast-notes) reports coverage, and a session tops the file
 * up the same way the suggestion pool is refreshed.
 */

export interface ContrastNotesFile {
  version: 1
  /** Keyed by contrastNoteKey — both ids, sorted, joined with '|'. Values are one- or two-sentence Chinese explanations. */
  notes: Record<string, string>
}

/**
 * The canonical key for an unordered pair. Sorted so that a question built
 * as (a, b) and one built as (b, a) — which the generator produces by
 * swapping sides — land on the same note.
 */
export const contrastNoteKey = (a: string, b: string): string => [a, b].sort().join('|')
