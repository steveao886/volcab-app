# The second showing bought by 困难 is a confirmation, not a review

**Date:** 2026-08-27
**Status:** approved
**Revises:** 2026-08-25-hard-requeue-design.md

**What is being built**: the card that 困难 sends back to the end of the
session comes back as a *confirmation* card. 重来 still works exactly as it
always has; the only other action is "记住了", which dismisses the card and
writes nothing — no grade, no schedule change, no daily-stat increment.

---

## The bug, user-reported two days after the requeue shipped

> 你点了困难以后是再复习一遍,但是上面这个困难良好简单,这些时间线全都
> 给打乱了,全都变成了100天。

The numbers were not corrupted. They were the scheduler's honest preview —
computed over the entry the first 困难 press had *already committed*. On the
reported card (interval ≈ 51 days before the press):

1. 困难 commits interval 51 → 61 (× 1.2), ease 2.5 → 2.35, due 61 days out.
2. The card returns at the tail, and `previewIntervals` runs on that
   committed entry: 困难 61 × 1.2 ≈ **73 天**, 良好 61 × 2.35 ≈ 143 →
   clipped to **100 天** by `MAX_INTERVAL_DAYS`, 简单 61 × 2.5 × 1.3 ≈ 198
   → **100 天**.

So the second showing was a fully armed second review: its previews stacked
on the first grade, and pressing any button committed a second `gradeWord`
in the same minute, over an interval that had served zero days.

## Why the 2026-08-25 design's residue analysis was wrong

That design accepted "two applications in a session" — but it only analysed
困难 twice (`× ~1.44`, ease `− 0.3`) and called the direction honest. The
common case is the other one: you saw the card two minutes ago, so on the
second showing you press 良好. Measured on a 10-day word:

- plain 良好, one press: 10 × 2.5 = **25 days**
- 困难 then 良好 on the re-showing: (10 × 1.2 = 12, ease 2.35) then
  12 × 2.35 = **28 days**

"I barely got this, show it again" schedules the word *further out* than
"I knew it" — a partial miss promotes the word. That is the exact class of
inversion `CLAUDE.md`'s SRS section exists to prevent (`gradeWord`
multiplies whatever interval it finds, knowing nothing about elapsed time).
The daily stats also counted one card as two reviews.

## Decision

The second showing is confirm-only. Concretely:

- **重来 is unchanged.** Failing the second look is genuine new information
  ("I saw this two minutes ago and still can't recall it") and relapses the
  word to `learning` through the normal `grade()` path — lapse counted,
  learning steps re-run, stats recorded. Nothing special-cased.
- **记住了 replaces 困难/良好/简单.** It dismisses the card through a plain
  `advance()` with no grade: the queue moves on, `seen` grows, and neither
  `progress.words` nor `dailyStats` is touched. Three buttons that all
  secretly did the same thing would violate the "a control that silently
  does less than it looks like it does" rule, so there is one button that
  says what it does.
- **The page says why.** A note above the card states that the earlier 困难
  is already recorded and shows the actual scheduled distance
  (`diffDays(today, entry.due)`), because the misreading that triggered this
  report was "the schedule got scrambled". The 记住了 button carries the
  same number as its consequence line: pressing it keeps that date.
- Keyboard: 1 = 重来, 3 = 记住了 (the muscle-memory "got it" key), both
  printed on the buttons. 2 and 4 do nothing on this showing.

## How the showing is recognised

`reviewQueue.ts` gains one pure predicate:

```ts
isHardConfirm(q, id, entry) =
  id !== undefined && entry !== undefined
  && entry.state === 'review' && q.hardRecycled.includes(id)
```

`hardRecycled` already records exactly the ids sent back by 困难 this
session, and each id appears in `ids` at most once, so membership at the
head of the queue *is* "this is the second showing". The `state === 'review'`
check is load-bearing: 重来 on the confirm showing relapses the word to
`learning`, and its subsequent learning-step showings must grade normally —
membership alone would mark them confirm-only for the rest of the session.

No third review-phase showing can occur: graduating out of the relapse sets
`due` at least a day out, which dequeues the card for good.

## What this does to the old design's once-per-session cap

The cap existed to stop a second 困难 press from compounding. Confirm-only
makes that structurally impossible — the second showing has no 困难 button —
so the cap is now defence-in-depth rather than the active guard, and
`hardRecycled`'s primary job is identifying the confirm showing. `advance()`
keeps the check anyway: it is one line, and it holds even if some future
caller passes `grade: 'hard'` for a card already recycled.

## Rejected: keeping four graded buttons on the second showing

The 2026-08-25 design kept them to avoid "a second card state" and to avoid
touching the scheduler. The inversion above is worse than either cost, and
confirm-only touches the scheduler exactly as much as the queue rule did:
not at all — `srs.ts` is untouched again; the review page simply does not
call `grade()` for the dismissal.

## Tests

`src/pages/reviewQueue.test.ts`:

- `isHardConfirm` is false on the first showing, true on the re-showing of
  a hard-recycled review card, false for undefined id/entry
- a confirm dismissal (advance with no grade) dequeues for good
- 重来 on the confirm showing relapses to learning, the card recycles
  through the learning rule, and `isHardConfirm` is false from then on

The Review.tsx wiring is render-layer and gets no component tests, per
`CLAUDE.md`.
