# Quiz Hub: Mode Cards (sketch 002, winner B)

## What is being built

`/quiz` becomes a hub page: a card grid where every one of the seven
practice modes shows its name, a one-line description, its own accuracy
(or best score), and when it was last practiced. The weakest mode wears a
推荐 badge. Tapping a card starts that mode (`/quiz?mode=X`). The chip
switcher inside the session goes away; a session's back button returns to
the hub.

## Tradeoffs and decisions

**The daily path gains exactly one tap, deliberately.** The old comment on
`MODES` ("defaults to mixed… shouldn't cost an extra click") was written
when there were four modes; at seven, the chip row had stopped carrying
information — no descriptions, no stats, nothing marking a neglected
mode. The winner accepts one tap in exchange for making the seven modes
comparable at a glance. The mixed card spans full width at the top of the
grid so the every-day default stays the largest, first target. The old
comment must be rewritten to record this reversal, not deleted.

**Per-mode stats reuse the existing tally.** `quizModes` on `DailyStat`
(shipped in d4922ac) already stores per-mode asked/correct. A new
`modeOverview()` in `statsDerive.ts` aggregates it — unlike the existing
`modeAccuracy()`, it returns **all seven modes in fixed key order**,
because on the hub "never played" is a state a card must show, not a
reason to vanish. `MODE_ACCURACY_MIN` (10) still gates the percentage:
below the floor a card shows 练过 N 题 instead of a rate that one miss
would swing 20 points.

**Sprint and guess show their personal bests** (最高 N 题 / 最佳 N 词 from
`bestSprint` / `bestGuess`) instead of an accuracy — those two modes
already define their own scoreboard, and it's the number the user chases.

**The 推荐 badge needs evidence.** `recommendMode()` picks the lowest
accuracy among modes that clear the floor; if none qualify there is no
badge. A recommendation invented from no data would just be a random red
tag. Ties keep the earlier fixed-order mode so the badge cannot flicker.

**Navigation: hub → session is a push, not a replace.** The old
chip-to-chip switching used `replace: true` so back wouldn't walk through
modes; that concern is gone because sessions no longer switch modes
in-place. From the hub, entering a mode is "a place you visited" — back
returns to the hub. `/quiz` with an invalid or absent `?mode=` renders
the hub; the `/guess` redirect keeps working unchanged.

**Hub and session are separate components.** The mode param decides which
one renders. This is a rules-of-hooks requirement, not taste: one
component switching between hub markup (few hooks) and session markup
(passage/sense-group loading effects) would change its hook count
between renders.

## Non-goals

- No changes to question generation, scoring, or `recordQuiz`.
- Session internals (QuizSession / Sprint / Recall / Passage / Guess)
  untouched apart from losing the chip row above them.
- The stats page's own mode-accuracy card is unchanged.

## Where logic lives

`modeOverview`, `recommendMode`, and the relative-age label `agoLabel`
are pure functions in `src/pages/statsDerive.ts` with tests in
`statsDerive.test.ts`. The hub component maps rows to cards and holds no
logic worth testing.
