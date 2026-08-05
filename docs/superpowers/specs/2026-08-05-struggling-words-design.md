# Struggling words: the stats card and drill stop being a lifetime ledger

**Date:** 2026-08-05
**Status:** approved (approach C of three presented)

## Problem

The "最容易忘的词" card on the stats page ranks by `lapses`, a lifetime
counter that only ever increments and only increments in one place — pressing
"忘了" on a review-phase card in `/review`. Three consequences, reported by
the user as "the list never changes":

1. A word mastered months ago stays on the leaderboard forever.
2. Quiz mistakes never move it (by design — quizzes only pull `due` forward).
3. Lapse counts bunch at the low end (measured earlier: all 7 lapsed words in
   the live library sat at exactly 1 lapse), so the visible order was decided
   by tiebreakers that barely move.

The user wants the card to answer "which words am I *currently* failing to
hold?", not "which words have cost me the most, ever?".

## Decision

One shared definition of a **struggling word**, used by the stats card, the
drill session (`/review?mode=lapses`), and the Today-page entry point:

> A word whose entry exists, is not `new`, has `ease < INITIAL_EASE` (2.5),
> and `intervalDays < MATURE_INTERVAL_DAYS` (21).

Ranked by: `ease` ascending → `lapses` descending → `usageScore` descending
→ `id` (determinism).

### Why ease is the entry condition *and* the primary sort key

- `ease` is the scheduler's own running difficulty estimate: −0.2 on a lapse,
  −0.15 on "hard", recovers only on "easy". A word graded "good" forever sits
  exactly at 2.5 (the comment on `INITIAL_EASE` already calls this out as the
  property that makes distance below it a usable signal), so `ease < 2.5`
  means "this word has drawn blood and has not been forgiven yet".
- It moves on every review grade, so the list breathes — the frozen-order
  complaint cannot recur.
- It captures the words that were never outright forgotten but keep getting
  "hard" — invisible to any lapse-count ranking.
- The quiz weighting (`difficultyWeight` in `src/lib/quiz.ts`) already uses
  `INITIAL_EASE - ease` as its difficulty signal; this unifies the app on one
  definition of "difficult" instead of two.

### Exits — every one of them earned

- **Ease recovers to ≥ 2.5** (via "easy" grades): the scheduler now thinks
  the word is at or above baseline difficulty.
- **Interval reaches 21 days**: the same maturity boundary the drill already
  used. A word can be carried to maturity on "good" grades alone without its
  ease ever recovering; holding it for three weeks is proof enough.
- Lifetime `lapses` no longer keeps a word in — it is demoted to a tiebreaker
  and a display label.

## What changes where

| Piece | Before | After |
|---|---|---|
| `rankLapsedWords` (queue.ts) | `lapses > 0`, sort lapses → ease → score → id | renamed `rankStrugglingWords`: filter `state !== 'new' && ease < INITIAL_EASE && intervalDays < MATURE_INTERVAL_DAYS`, sort ease → lapses → score → id |
| `buildLapseQueue` | adds mature-exit + reviewed-today filters | mature exit moves into the ranking; keeps only reviewed-today filter and the 20-word cap |
| `lapseSummary` (statsDerive.ts) | every ever-lapsed word | renamed `strugglingSummary`, delegates to the new ranking; same `{ total, top }` shape |
| Stats card | title "最容易忘的词", row tag "忘 n 次", footer "共 N 个词至少忘过一次" | title "还没记牢的词"; row tag "忘 n 次" when `lapses > 0`, "偏难" otherwise; footer "共 N 个词还没记牢" |
| Review.tsx | `hasLapsedWords`, empty copy "还没有反复记错的词" | `hasStrugglingWords`, copy updated to the new meaning |
| Today entry | unchanged mechanics | unchanged (count comes from `buildLapseQueue`, which inherits the new definition) |

The `?mode=lapses` route name and `recordLapseDrill` stay: renaming a route
breaks bookmarks and renaming synced-adjacent identifiers buys nothing.

## Tradeoffs accepted

- **The lifetime ledger disappears from the stats page.** That record was the
  old card's stated purpose ("what a word has cost you shouldn't blink out"),
  and this design deliberately reverses it at the user's request. `lapses` is
  still stored and still shown on the word-detail page; nothing is lost from
  the data.
- **One "hard" press is enough to appear** (ease 2.35 < 2.5, tagged "偏难").
  Accepted: one "easy" press or three weeks of holding it clears it, and a
  word you had to squint at yesterday *is* the card's subject matter.
- **The card can go empty** (existing `total > 0` gate hides it). An absent
  card now honestly means "nothing is currently shaky".
- **Quiz mistakes still don't feed it.** Quizzes write no per-word field
  except pulling `due` forward, and adding one is a sync-schema change —
  explicitly out of scope here, noted as possible future work.

## Testing

Pure-logic changes land in `queue.ts` / `statsDerive.ts` with their existing
colocated suites rewritten to the new rules: entry conditions (at-initial-ease
excluded, below-initial included even with zero lapses, recovered-above-initial
excluded despite lapses), both exits, the ranking order, the reviewed-today
filter staying drill-only, and the cap. UI stays untested per repo policy.
