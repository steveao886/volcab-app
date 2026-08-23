# Plan — Contents API size limits

Spec: `docs/superpowers/specs/2026-08-22-contents-api-size-limits-design.md`

The measurement is done and lives in the spec. What remains is one code
change and three documentation corrections.

---

## Task 1 — `putFile` stops calling "too large" a conflict

**File**: `src/lib/github.ts`

Test first (`src/lib/github.test.ts`), three cases, because the point is the
*split* and a single case cannot show it:

1. 422 + `{"message":"Sorry, the file is too large to be processed. …"}`
   → **throws**, and the message says so in Chinese and still carries
   `(HTTP 422)` so `httpStatus` keeps classifying it.
2. 422 + `{"message":"Invalid request.\n\n\"sha\" wasn't supplied."}`
   → still `'conflict'`.
3. 409 + `{"message":"p.json does not match <sha>"}` → still `'conflict'`.
   (The existing `putFile: 409/422 → conflict` test covers a bare 409; keep
   it, and extend it so a 422 with an unparseable body also stays a
   conflict.)

Implementation notes:

- The response body can only be read once. The success path currently does
  `(await res.json()).content.sha`; read `res.text()` once and parse from
  that, or branch before consuming. Do not read twice.
- Match on `/too large/i` against the parsed `message` field only, not the
  whole body — a path or commit message could contain those words.
- Unparseable body on a 422 → `'conflict'`, today's behaviour. Failing
  closed here means "assume the recoverable cause".

## Task 2 — the two size measurements

- **`src/lib/github.ts`**, the `getFile` comment: it currently reads as if
  the 1 MB cap were an approaching cliff. Rewrite around what was measured:
  the JSON media type keeps returning the **sha** above 1 MiB and only
  blanks `content`, so the fallback survives; raw's cap is 100 MB
  (documented); the write ceiling is between 40 MB and 46 MB (measured, not
  documented anywhere).
- **`CLAUDE.md`**: the gotcha says writes "have not been tested above 1 MiB"
  and to "treat the next word batch as the one that has to deal with this".
  Both are now false. Replace with the measured ceiling and the
  words-remaining figure, and point at the spec.

## Task 3 — record it where the next word batch will look

`docs/word-add-checklist.md` is what a session adding words reads, and it is
where someone will next notice the file size. Add the measurement so the
question does not get re-opened from scratch.

## Task 4 — gates

`npx vitest run src/lib/github.test.ts`, then the full
`npm test && npm run build && npx oxlint`.

## Task 5 — the probe repo

`steveao886/volcab-size-probe` holds ~40 MB of junk files. It is the
evidence for the table in the spec. **Do not delete it silently** — tell the
user it exists and let them decide; the `gh` token here has no `delete_repo`
scope in any case.

---

## Ordering

Task 1 is independent of 2 and 3. Tasks 2 and 3 are pure documentation and
can land in the same commit as 1 — the code change and the numbers that
justify it are one change, per the repo's commit convention.
