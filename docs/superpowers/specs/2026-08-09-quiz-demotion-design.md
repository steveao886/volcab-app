# A quiz miss halves the interval

**Date:** 2026-08-09
**Status:** approved (halving, over every quiz mode except the sprint)

## Problem

A word you have just failed to recall keeps its schedule. Miss `promulgate`
in a quiz today and it is still not due for review until October, because
since `71fba29` every practice surface stamps `missedAt` and touches nothing
else. That stamp reaches the stubborn-word drill and (as of `a91c248`) the
quiz draw — but never the schedule itself.

So the scheduler goes on asserting "you know this word, see you in 60 days"
immediately after being shown otherwise. That is a real defect in the model,
not merely a missing feature: the information exists and is discarded.

## Why this is allowed to change the schedule

`CLAUDE.md` has carried the rule "quizzes are practice, and practice must not
reshape the review schedule" since the beginning. Two things about it:

**It was already describing behaviour that no longer existed.** The rule as
written said `recordQuiz` "only pulls a wrong word's `due` date forward",
which stopped being true at `71fba29`. That commit removed the pull-forward
entirely.

**The rule was written against a failure in the opposite direction.** The
thing it protects against is practice making intervals *grow*: `gradeWord`
computes `next = intervalDays * ease` with no knowledge of how much time
actually elapsed (`srs.ts`), so a word yanked back early and graded "good"
grew as if the whole interval had been served. Measured then: 9 words below
initial ease scheduled 60+ days out, `promulgate` at ease 1.70 / 268 days.

A deliberate, bounded demotion is a different operation from that accident.
The rule is rewritten rather than broken — see the CLAUDE.md diff in this
change.

## The operation

On a miss, for an entry in the `review` state that has not already been
demoted today:

```
intervalDays → max(1, floor(intervalDays / 2))
due          → min(previous due, today + newInterval)
```

Everything else is untouched: `ease`, `lapses`, `state`, `stepIndex`,
`reps`, `lastReviewedAt`.

### `due` takes a minimum, and that is not a detail

Setting `due = today + newInterval` alone **can push a review further away**.
A word on a 30-day interval that falls due tomorrow has already served 29 of
its 30 days; halving to 15 and scheduling from today moves it from tomorrow
to a fortnight out. A miss would have *promoted* it. The minimum is what
makes "demotion" true in every case rather than most of them.

### `ease` is deliberately untouched

`ease` is the scheduler's own difficulty estimate, calibrated on review-card
grades, and it is also the definition of a struggling word
(`rankStrugglingWords`) and the main term in `difficultyWeight`. Feeding quiz
results into it would blur three separate readings at once. The interval is
the thing being corrected here, so the interval is the only thing that moves.

`lapses` stays out for the reason `recordConsolidation` already gives: a
lapse means forgetting a word you had learned, established on a graded review
card.

### One demotion per word per day

The guard that matters. Wrong demotes and right does nothing, so without a
cap the operation is a one-way ratchet: quizzing could only ever shorten
intervals, and quizzes have no daily limit. Play enough and every word
collapses to the floor — the mirror image of the `71fba29` drift.

With the cap, a word can lose at most half its interval per day, and the next
successful *review* multiplies it straight back up. The correction is
bounded and reversible.

Tracked by a new optional `ProgressEntry.demotedOn`. Optional because every
added synced field is (an older build on another device pushes entries
without it), and the correct reading of its absence is "not demoted today".

## Scope: every quiz mode except the sprint

| surface | demotes | why |
|---|---|---|
| 综合 / 回想 / 辨析 / 听音 / 短文 (`recordQuiz`) | yes | user's call |
| 猜词 (`recordGuess`) | yes | user's call |
| 极速 (`recordSprint`) | **no** | answers are speed-pressured; a miss there is as likely to be a timing artifact as a memory one |
| 顽固词 / 今日巩固 (`practiceGrade`) | no | drills, not tests — they re-ask what you already struggle with |
| 自由练习 (`recordPractice`) | no | no daily budget at all, and self-graded after seeing the answer |

**Recorded tradeoff, raised and overruled.** Most of the included modes are
four-option multiple choice, so roughly one miss in four is a failed guess
rather than a failed memory. I argued for restricting this to the free-recall
types (`spelling`, `audio2spelling`, unaided 猜词 — the ones whose `options`
array is empty); the user chose the wider scope. The per-day cap is what
keeps the noise bounded: a coin-flip miss costs half an interval once, and a
real review restores it.

## Testing

- `srs.test.ts` for `demoteWord`: halving with the floor at 1; the minimum on
  `due` (the near-due word that must not be pushed out); `review`-state-only;
  the same-day no-op returning the identical object; every other field byte-
  identical.
- `store.test.tsx`: a quiz miss halves the interval and stamps `demotedOn`; a
  second miss the same day changes nothing; a sprint miss never demotes; a
  correct answer never demotes.
