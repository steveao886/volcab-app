# Review Grading: Interval Preview (sketch 003, winner A)

## What is being built

The four grade buttons on the review page each gain a second line showing
what pressing them does to the card's schedule — 稍后 / 12 天 / 25 天 /
34 天. Grading stops being a feeling and becomes choosing a consequence
(Anki's approach). Keyboard shortcuts, button order, and the four-grade
model are unchanged.

## Tradeoffs and decisions

**The numbers come from the real scheduler, or they don't exist.** A new
`previewIntervals()` in `src/lib/srs.ts` runs `gradeWord()` per grade on
a copy of the entry — same code path the actual grade takes, including
`intervalModifier` from settings. Hardcoding "10 分钟 / 2 天 / 5 天 /
9 天" (as the mock did) would print numbers the scheduler never produces;
a wrong preview is worse than none.

**Fuzz is neutralized, not reimplemented.** `gradeWord` is called with
`rng: () => 0.5`, which makes fuzz's factor exactly 1 — the preview
prints the unfuzzed interval while the real write still fuzzes ±5%. Off
by at most ±5% beyond 3 days; deterministic, so it's testable. This
reuses the existing injected-rng seam rather than adding a `skipFuzz`
flag to the scheduler.

**Same-day outcomes all read 稍后.** Learning steps and lapses requeue
within the session *by queue position, not by clock* (see LEARNING_STEPS
in srs.ts) — a minutes figure like the mock's "10 分钟" would be an
invention. 稍后 is vaguer and true.

**Drill modes show no preview.** In lapses/consolidate mode the grade
buttons deliberately don't reschedule (`recordLapseDrill` /
`recordConsolidation`), so an interval preview there would be a lie about
what the button does. The existing drill note already explains the
difference; the preview simply doesn't render outside `mode === 'due'`.

**Days, not mixed units.** Labels are `N 天` all the way to 365 天.
Converting to 个月/年 would round away exactly the magnitude the feature
exists to show, and mixed units jitter in a four-column row.

**Layout: label row + interval row, stacked.** The buttons keep their
4-column grid at 375px; each becomes a two-line column (label + number
key on top, interval below). In drill modes the second line is absent and
the buttons render exactly as today.

## Non-goals

- No changes to `gradeWord`, learning steps, or grade semantics.
- No preview on quiz surfaces (quizzes never touch the schedule).
- No undo button, no swipe gestures (those were the losing variants).

## Where logic lives

`previewIntervals` (plus its date-diff/format helpers) is pure in
`src/lib/srs.ts`, tested in `srs.test.ts` against hand-computed
expectations. `Review.tsx` renders the strings; `Review.css` stacks the
button content.
