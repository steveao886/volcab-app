# 困难 brings the card back — a queue change, and only a queue change

**Date:** 2026-08-25
**Status:** approved

**What is being built**: grading a review-phase card 困难 puts it back at the
end of the session queue, to be seen once more before the session ends.
Nothing about the schedule changes.

---

## The problem, user-reported

> 只有重来,它会真的让你再复习一遍。就算是困难都不会出现一遍。

Correct, and the mechanism is exact. A card returns during a session on one
condition only (`reviewQueue.ts`, `advance`):

```ts
entry.state === 'learning' && entry.due <= today
```

- **重来** in the review phase (`srs.ts`) sets `state = 'learning'` and
  `due = today`. It satisfies the condition, so the card comes back.
- **困难** keeps `state = 'review'` and sets `due = today + intervalDays`.
  It cannot satisfy the condition, so the card never comes back.

Two things make this worse than it first looks.

**困难 always lengthens the interval.** The review-phase branch computes
`intervalDays = fuzz(max(intervalDays + 1, round(intervalDays * 1.2 * mod)))`
— the `+ 1` floor means a word graded 困难 is always scheduled *later* than
it was last time. "I barely got this" buys a longer gap and no second look.

**The same button behaves oppositely in the two phases.** On a
learning-phase card, 困难 sets `due = today` and leaves `state` at
`learning`, so it *does* come back. New words and old words respond to the
same tap in opposite ways, which is why the behaviour reads as broken rather
than merely strict.

## Decision

A card graded 困难 while in the **review** phase is reinserted at the tail of
the session queue. That is the entire change.

**The scheduler is not touched.** Not `ease`, not `intervalDays`, not `due`,
not `state`, not `lapses`. `CLAUDE.md` gives `srs.ts` sole ownership of the
schedule and names the one door practice has into it; this change does not
approach that door, because *when a card is shown again inside a session* was
never the scheduler's decision. `buildSessionQueue` and `advance` already own
it, and 重来's re-showing is a side effect of a relapse to `learning`, not a
scheduling rule.

So this lives entirely in `reviewQueue.ts`.

### At the tail of the whole queue, after the new words

`advance` already appends with `[...rest, id]`, and the session queue is
built as `[...due, ...fresh]`. Appending therefore lands the card behind
every remaining word, new ones included — which is what was asked for, and
also the only placement that gives the re-showing any spacing worth having.

### Learning-phase cards are untouched

They already come back through the existing rule. The new rule is
restricted to `state === 'review'` so that a learning card cannot be
recycled twice by two rules at once.

### Once per card per session

A card is re-queued by 困难 **at most once**, tracked by
`SessionQueue.hardRecycled`.

Without the cap, the second showing could be graded 困难 again and re-queued
again, and so on. That matters because each 困难 press runs the review-phase
branch again: interval `× 1.2` with a `+ 1` floor, ease `− 0.15`. Before this
change a session could only ever apply that once per card, because the card
never came back. Uncapped re-queueing would let one session compound it
without limit — a harm this change would have introduced, not one it
inherited.

Capped, the worst case is two applications in a session (`× ~1.44`, ease
`− 0.3`). That residue is accepted deliberately: removing it means either
re-showing the card ungraded — a second card state, and not what was asked
for — or suppressing the second grade's schedule effect, which is the
scheduler-touching this design exists to avoid. Two is bounded and the
direction is at least honest: a word pressed 困难 twice in one sitting is
genuinely harder than one pressed 困难 once.

### The drills are exempt, for free

`advance`'s existing `allowRecycle` parameter is already `false` for the
practice drills and `mode === 'due'` in `Review.tsx`, so gating the new rule
behind the same flag confines it to the real review session with no new
condition.

## Tests

`src/pages/reviewQueue.test.ts`, alongside the existing `advance` block:

- a review-phase card graded 困难 is reinserted at the tail, **behind the
  fresh words**, and `total` grows with it
- graded 良好 or 简单, the same card is dequeued for good
- the second 困难 on the same card does **not** re-queue it
- a learning-phase 困难 still recycles through the existing rule, and does
  not consume the once-per-session allowance
- `allowRecycle === false` suppresses it, like every other recycle

`srs.test.ts` needs nothing: `srs.ts` does not change.

## Explicitly out of scope

The `+ 1` floor on the 困难 interval, which is the other half of the
complaint and a genuine scheduler question. Changing it means re-simulating
against the real library, and it is not what "只改队列" asked for.
