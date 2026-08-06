# Word Notes Implementation Plan

**Goal:** Give a word its own one-sentence 要点 — the usage boundary that decides it in a contrast question — and show it under the meanings on the back of the review card and at the end of the meanings block on the entry page.

**Architecture:** A bundled, read-only content file `src/data/wordNotes.json` keyed by word id, with the type and the lookup in `src/lib/wordNotes.ts` (not `src/types.ts` — that is the synced model). The render layer adds one paragraph to each of two existing components; no state, no store, no sync, no SRS change. A fifth validator gates the write path.

**Tech Stack:** React 19 + TypeScript + Vite + vitest. No new dependencies.

**Design doc:** `docs/superpowers/specs/2026-08-06-word-notes-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/wordNotes.ts` (new) | `WordNotesFile` type + `wordNote(notes, id)` lookup. Pure, lenient |
| `src/lib/wordNotes.test.ts` (new) | Tests for the lookup |
| `src/data/wordNotes.json` (new) | The content. Read-only, bundled |
| `src/pages/ReviewCard.tsx` (modified) | Renders 要点 under the meanings list |
| `src/pages/Review.css` (modified) | `.review-note` — the `.review-etymology` treatment |
| `src/pages/WordDetail.tsx` (modified) | Renders 要点 at the end of the meanings card |
| `src/pages/WordDetail.css` (modified) | `.worddetail-note` |
| `scripts/validate-word-notes.ts` (new) | The write-path gate |
| `package.json` (modified) | Adds the `validate-word-notes` script |

**Why a lookup helper rather than indexing the record directly:** `QuizQuestion` indexes `contrastNotesFile.notes[key]` inline and that is fine for one call site, but this feature has two, and both must treat a missing id and a whitespace-only note identically ("render nothing"). One function, one test, one behaviour.

---

## Task 1: The lookup module

**Files:** create `src/lib/wordNotes.ts`, `src/lib/wordNotes.test.ts`

- [ ] Write failing tests: known id returns the note; unknown id returns `undefined`; a whitespace-only note returns `undefined`; a non-string value returns `undefined` (read side is lenient — a malformed bundled entry must not throw).
- [ ] Implement `wordNote(file, id)` and the `WordNotesFile` interface, with a header comment explaining why this is bundled content outside `src/types.ts`.
- [ ] `npx vitest run src/lib/wordNotes.test.ts`

## Task 2: Seed the content file

**Files:** create `src/data/wordNotes.json`

- [ ] Write `{ "version": 1, "notes": {} }` plus the first authored batch, so the validator and the render layer have something real to run against.

## Task 3: The validator

**Files:** create `scripts/validate-word-notes.ts`, modify `package.json`

- [ ] Mirror `validate-contrast-notes.ts`: version check, id must exist in `data/words.json`, note non-empty, note must contain Chinese, note ≤ 80 characters.
- [ ] Add the headword check: reject a note whose English tokens include another library word's headword (case-insensitive, whole token, excluding the note's own word). Cite the 2/325 measurement in the comment.
- [ ] Report coverage over the words that take part in a contrast pair (`buildContrastPairs`), do not enforce it.
- [ ] Add `"validate-word-notes": "tsx scripts/validate-word-notes.ts"`.
- [ ] `npm run validate-word-notes`

## Task 4: Review card back

**Files:** modify `src/pages/ReviewCard.tsx`, `src/pages/Review.css`

- [ ] Import the JSON and `wordNote`; render a `.review-tags` block labelled 要点 directly after the `.review-meanings` list and before 例句. Nothing renders when there is no note.
- [ ] `.review-note` reuses the `.review-etymology` treatment (hairline leading rule, muted, `line-height: 1.7`).

## Task 5: Entry page

**Files:** modify `src/pages/WordDetail.tsx`, `src/pages/WordDetail.css`

- [ ] Render the note inside the meanings `Card`, after the `<ol>` — "at the end of the explanation".
- [ ] `.worddetail-note` matches `.worddetail-etymology`, with a 要点 label so the block is not mistaken for a further meaning.

## Task 6: Author the notes

**Files:** modify `src/data/wordNotes.json`

- [ ] For each of the 300 words appearing in at least one authored pair note, read that word's pair notes together and distil the property of *itself* that recurs. Skip a word whose notes carry no shared point (e.g. only "两词很少同场竞争").
- [ ] Never name another library word; keep an English collocation fragment where one earns its place; ≤ 80 characters.
- [ ] `npm run validate-word-notes` after each batch.

## Task 7: Verify

- [ ] `npm test`
- [ ] `npx oxlint`
- [ ] `npm run build`
- [ ] `npm run validate-word-notes`
- [ ] Browser preview: a word with a note on `/review` and on its entry page at 375px; a word without one shows no empty block.
