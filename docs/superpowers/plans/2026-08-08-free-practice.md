# Plan: free practice

Spec: `docs/superpowers/specs/2026-08-08-free-practice-design.md`

Six commits, each self-contained and green on its own.

## Task 1 — `src/lib/practice.ts` + tests

`samplePractice(pool: Word[], size: number, opts?: { rng?, exclude? }): Word[]`

Filter out `exclude`, Fisher-Yates shuffle with the injected `rng`
(defaulting to `Math.random`), take `size`. No dependency on `progress` —
the caller has already filtered.

Tests: determinism under a seeded rng, short pool returns everything, the
exclusion set is honoured, no word appears twice in one draw, `size <= 0`
returns empty.

## Task 2 — `recordPractice` in `store.tsx`

Lift `clearMissed` out of `practiceGrade`'s body so both call it. New action:

```
recordPractice(wordId, correct)
  entry missing            → return, commit nothing
  correct && no missedAt   → return, commit nothing (object identity)
  correct && missedAt      → commit clearMissed(prev)
  !correct                 → commit { ...prev, missedAt: today }
```

`schedulePush()` on commit, matching `practiceGrade` — a practice miss is
not worth a `flushProgress`.

Declare on `AppActions` with a comment naming the two fields it refuses to
write and why.

Tests in `store.test.tsx` (the file's header explains why it may hold
component tests): the four branches above, plus an explicit assertion that
`dailyStats` is byte-identical after a full session.

## Task 3 — `/practice` page

`src/pages/Practice.tsx` + `Practice.css`, route in `App.tsx`.

Reads `q` / `status` / `src` from `useSearchParams` **once, on mount**
(`useState` lazy initialiser), same as `Review.tsx`'s `mode`. Unknown
`status` values fall back to `all` — read side lenient.

State: the sampled deck, an index, `flipped`, and a `seen` set carried
across redraws.

Render: `Page` with eyebrow `Practice`, title `自由练习`; a `还剩 N 张`
progress bar; the two buttons above the card (`Review.tsx` moved them there
for a reason worth inheriting); a `Card` with the headword and speak button,
`ReviewCardBack` when flipped.

Keyboard: space flips when nothing has focus, `1` / `2` grade when flipped —
lift the guard logic from `Review.tsx` including `isEditableTarget` and the
`activeElement !== document.body` check.

Done screen: `另来一批` when the filter still has unseen words, otherwise a
note that the slice is finished; `返回词库` always.

Empty deck on mount (filter matches nothing, e.g. a stale bookmark): the
same done screen, phrased as "这批筛选条件下没有词".

## Task 4 — library entry point

A `练这 N 个 →` link under the filter chips in `Library.tsx`, `N =
filtered.length`. Hidden when `filtered.length === 0` or `manageMode` is on.
Builds the target with `URLSearchParams`, omitting empty values so a plain
`/practice` stays clean.

## Task 5 — delete the struggling card

`Stats.tsx`: the card, `TOP_STRUGGLING`, the `struggling` entry in the
`useMemo`, the destructure, the `strugglingSummary` import. `statsDerive.ts`:
`strugglingSummary`, `StrugglingSummary`, `StrugglingWord`, and the
`rankStrugglingWords` import if it is then unused. `statsDerive.test.ts`: the
`strugglingSummary` describe block. Any orphaned CSS in `Stats.css`
(`stats-lapses`, `stats-lapse*`, `stats-card-head*` if unshared).

`queue.ts` is not touched.

## Task 6 — verify

`npm test`, `npx oxlint`, `npm run build`, then drive `/practice` in the
browser preview at 375px: enter from the library, flip a card, grade both
ways, redraw, exhaust the slice. Confirm the stats page still renders with
the card gone.
