/**
 * Rules for the etymology field. **Shared by the script and both forms** — same reason as
 * senseShare.ts: if the validation script (the ingestion gate) and the in-app forms each
 * wrote their own copy, they'd eventually drift apart, and an entry saved via the form
 * would knock data/words.json out of schema, only discovered once validation runs.
 */

/** Etymology is a one-line margin note on the back of a review card, not an etymology-dictionary entry. Over the limit means delete, not wrap. */
export const ETYMOLOGY_MAX = 60

/**
 * Form input → stored value.
 *
 * Blank returns undefined rather than an empty string: callers use this to **omit the key
 * entirely**. An empty string would make the display layer's `word.etymology !== undefined`
 * check read as "has etymology" and render a section with a heading but no content.
 */
export function normalizeEtymology(input: string): string | undefined {
  const v = input.trim()
  return v === '' ? undefined : v
}

/**
 * Returns an error message, or null when valid.
 *
 * **Leaving it blank is valid** — etymology is the one field where omitting it is preferable
 * (see docs/word-entry-spec.md): not every word has a decomposable etymology, and making one
 * up is far worse than leaving it empty.
 */
export function validateEtymology(input: string): string | null {
  const v = normalizeEtymology(input)
  if (v === undefined) return null
  return v.length > ETYMOLOGY_MAX
    ? `词源不超过 ${ETYMOLOGY_MAX} 字(当前 ${v.length} 字),它是一句话不是一段考据`
    : null
}
