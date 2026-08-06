/**
 * Per-word usage notes ("要点") — one sentence about a single word's own
 * usage boundary, shown under the meanings on the back of the review card
 * and at the end of the entry page's meanings block.
 *
 * These are **not** the contrast notes. A contrast note (contrastNotes.ts)
 * is relational and only true while both twins are on screen: "abate 不及物,
 * assuage 及物". A word note has to stand up on abate's own card, where
 * assuage is nowhere in sight — so it never names another library word, it
 * states what abate itself does. The contrast notes are nevertheless where
 * the content comes from: the property of *itself* that recurs across every
 * pair a word takes part in is exactly its note.
 *
 * Bundled read-only content like passages and contrast notes, deliberately
 * outside the synced schema in src/types.ts. Putting it on `Word` was
 * measured and rejected: ~40 Chinese characters per word adds 64 KB to
 * words.json's 803 KB, and above 1 MB the GitHub Contents API stops
 * returning file content inline and sync breaks outright.
 *
 * Coverage is best-effort by design — a word with no note simply shows no
 * note. 198 of 498 words have no confusable twin at all, and inventing
 * "正式用语，多见于书面" for them would dilute the notes that carry real
 * information. Blank is the correct outcome, the same rule Word.etymology
 * already follows.
 */

export interface WordNotesFile {
  version: 1
  /** Keyed by word id. One Chinese sentence, at most 80 characters (enforced by validate-word-notes). */
  notes: Record<string, string>
}

/**
 * Lenient on the read side, like every other lookup into bundled content: a
 * missing id, a blank string, or a value that somehow isn't a string all
 * mean the same thing to both call sites — render nothing. Never throws.
 */
export function wordNote(file: WordNotesFile, id: string): string | undefined {
  const note: unknown = file.notes[id]
  if (typeof note !== 'string') return undefined
  const trimmed = note.trim()
  return trimmed === '' ? undefined : trimmed
}
