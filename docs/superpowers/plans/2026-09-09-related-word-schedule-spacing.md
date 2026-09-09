# Plan — spacing related words out of the review schedule

Spec: `docs/superpowers/specs/2026-09-09-related-word-schedule-spacing-design.md`

## 1. `src/lib/related.ts` + `related.test.ts`

Move out of `freshOrder.ts` unchanged: `STEM_MIN`, `STEM_MAX_TAIL`,
`sharesStem`, `declaredLinks`. Add:

- `isRelated(a: Word, b: Word, links)` — declared link or shared stem. The
  review side's rule; no capture-window term.
- `spaceApart<T>(sorted: T[], related: (a: T, b: T) => boolean, gap: number): T[]`
  — the greedy pass lifted verbatim from `orderFreshWords`, including
  `LOOKAHEAD` and the fail-open branch.
- `SESSION_SPACING_GAP = 5` with the measured table from the spec.

Tests: stem hits/misses (the four known false positives stay documented as
accepted), symmetric link building, and that `spaceApart` never drops,
duplicates, or reorders when nothing is related.

## 2. `freshOrder.ts` imports them

Delete the local copies, keep `CAPTURE_WINDOW` and the composed `related`.
`freshOrder.test.ts` must stay green untouched — that is the proof the
extraction is behavior-preserving.

## 3. `srs.ts` — the forward nudge

- `MAX_NUDGE_DAYS = 2`, `NUDGE_MIN_INTERVAL_DAYS = 3` (cite `fuzz`).
- `nudgePastRelatives(due, intervalDays, dueTaken)` — returns `due` when the
  predicate is absent, the interval is below the floor, or all candidates
  are taken (fail open).
- `gradeWord(..., dueTaken?)` applies it in the review branch and inside
  `graduate`. Never on `again`, never in `demoteWord`.
- `previewIntervals(..., dueTaken?)` forwards it.

Tests: nudges off a taken date; stops at +2; no-op below 3 days; no-op with
no predicate; `intervalDays` unchanged in every case.

## 4. `queue.ts` — space the due half

After the existing sort, run `spaceApart` **within the learning block and
the review block separately**, so learning-first is preserved. Same
`related` rule as step 1.

Test: a session whose relatives are adjacent comes back separated; a session
too small to separate returns everything anyway.

## 5. Wire the callers

- `store.tsx` `grade()` builds the predicate from `cur.words` + the library
  and passes it to `gradeWord`.
- `Review.tsx` passes the same predicate to `previewIntervals`.

Both exclude the word being graded from the occupancy check.

## 6. One-time repair of the 14 existing pairs

Scratch script, not committed: pull `progress.json` fresh, push the
**longer-interval** member of each pair forward 1 day (2 if 1 is also
taken), skip the two pairs dated 2026-09-09 per the user's instruction, and
PUT with the sha. Verify exactly 14 `due` fields changed and nothing else.

## 7. Gates

`npm test`, `npm run validate`, `npm run build`, `npm run lint`. Commit code
and spec together.
