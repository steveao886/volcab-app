# Unlimited struggling-word practice through the free-practice surface

**Date:** 2026-08-15
**Status:** approved (approach A of three presented)

## Problem

The stubborn-word drill (`/review?mode=lapses`) runs once per day by design:
finishing a session stamps a local `lapseDrilledOn` marker, and re-entering
the same day shows 「今天已练完」. The user wants to keep practicing stubborn
words past that boundary — specifically **the most stubborn ones**.

Two facts sharpen the request:

1. The daily drill queue (`buildLapseQueue`) puts recently-missed words
   first and caps the session at `LAPSE_SESSION_SIZE` (20). In a week with
   many quiz misses, the lowest-ease words — the long-term stubborn ones —
   can be crowded out of the daily session entirely.
2. Simply unlocking the drill for repeat rounds was considered and rejected:
   its grades write real data (`lapses + 1` per miss, `reviewed`/`correct`
   into dailyStats), so repeat rounds would inflate the lapse counts, the
   30-day chart, and the accuracy rate — and a correct answer clears
   `missedAt`, so a same-day repeat round passed on short-term memory would
   systematically empty tomorrow's queue.

## Decision

A third pool mode on the free-practice page: `/practice?pick=struggling`.
Free practice already exists as the app's unlimited surface with the
thinnest writes; the struggling mode reuses that contract and thins it one
step further. Four user decisions fixed the shape:

- **Pool:** the full drill union — recent misses plus the struggling
  ranking — uncapped, without the reviewed-today filter.
- **Order:** walk the pool in queue order, batch by batch; shuffle inside
  each batch.
- **Entry:** the lapse drill's finish screens only.
- **Settling:** a correct answer in this mode settles nothing. Tomorrow's
  drill is unaffected by today's extra practice.

### Rejected alternatives

- **B. Unlock the drill for repeat rounds.** Two write contracts inside one
  page depending on round number, conditional done-marker logic, and the
  stat/lapse inflation problems above.
- **C. A "struggling" facet on the library filter, reusing 练这 N 个.**
  A filter yields a set, not a ranking — hardest-first order and the
  recent-miss half are both lost — and the entry point would not be where
  the impulse to keep practicing actually occurs.

## Design

### 1. Pool — one definition, shared with the drill (`queue.ts`)

New pure function:

```ts
strugglingPracticePool(words, progress, today): Word[]
```

Recent misses (`missedAt` within `MISS_RECENCY_DAYS`, most recent first,
existing tiebreakers) followed by `rankStrugglingWords`, deduplicated.
No cap, no reviewed-today filter.

`buildLapseQueue` is rewritten to derive from it:

```ts
buildLapseQueue = strugglingPracticePool(words, progress, today)
  .filter(not reviewed today)
  .slice(0, limit)
  .map(w => w.id)
```

This is the load-bearing move: the drill and the unlimited practice share
one definition of "stubborn" and cannot drift. The derivation must be
behavior-preserving — `queue.test.ts`'s existing `buildLapseQueue` suite
passing unchanged is the check.

### 2. Dealing — ordered walk, shuffled batches (`practice.ts`)

New pure function:

```ts
nextStrugglingBatch(pool, excludeIds, size = PRACTICE_DRAW_SIZE, { rng }): Word[]
```

Takes the first `size` words of the pool not yet seen this session, then
shuffles **within the batch** using the injected `rng` (repo rule: no bare
`Math.random`). Batch composition is deterministic — batch 1 is the most
urgent 20, 再来一批 walks deeper into the ranking — while the shuffle
prevents memorizing the card sequence as a crutch.

Unlike `samplePractice`, this is deliberately not uniform: the mode's
premise is "hardest first", stated on the entry button, so the ordering is
not a hidden bias (the concern that keeps `samplePractice` unweighted).

When the walk exhausts the pool, the finish screen offers 「从头再练」,
which resets the seen set and starts the walk over. That restart is the
"unlimited" in unlimited practice.

### 3. Writes — thinner than free practice (`store.tsx`)

`recordPractice` gains an option (default preserves current behavior):

```ts
recordPractice(wordId, correct, { settle = true } = {})
```

The struggling mode passes `settle: false`:

- **Miss:** stamp `missedAt` only — the word keeps its place in tomorrow's
  drill and its raised quiz weight. A miss is genuine signal regardless of
  surface.
- **Correct:** write nothing at all. Not clearing `missedAt` is the entire
  point of the flag: a word answered correctly an hour after it was missed
  was retrieved from short-term memory, which proves nothing about
  retention. The real check is tomorrow's drill, which this mode must not
  eat. Everything `recordPractice` already refuses to touch (dailyStats,
  `lastReviewedAt`, `lapses`, the schedule) stays untouched.

An option on the existing action rather than a new action: the write path
stays single, and free practice everywhere else keeps its settling
behavior — the 2026-08-08 free-practice contract is unchanged.

Consequence, accepted: a word that qualified only via `missedAt` (healthy
ease) stays in tomorrow's queue even if the user now knows it cold. It gets
settled through the existing front doors — a correct answer in tomorrow's
drill or any quiz.

### 4. Entry — where the impulse occurs (`Review.tsx`)

One button on the lapse mode's two finish screens:

- the session-complete screen (「顽固词已清完」), and
- the already-done screen (「今天已练完」).

Label: **「继续加练」** with the qualifier **「不计成绩、不影响排期」**,
linking to `/practice?pick=struggling`. The qualifier is product copy, not
decoration — it states the write contract on the control that invokes it,
the same rule that puts keyboard shortcuts on their buttons.

Hidden when `strugglingPracticePool` is empty. Note the pool can be
non-empty while the drill queue is empty (the drill filters today's
reviewed words; the pool does not) — the already-done screen usually still
shows the button.

Secondary button styling: vermilion is reserved for annotation and
destructive actions.

Not on the Today page: Today is a plan with a completion state, and a
never-finishable row would break it. Not on the stats card, per the user's
choice — one entry point, where the drill just ended.

### 5. Page behavior (`Practice.tsx`)

`pick=struggling` is read once on mount, like `mixed` — the pool must not
be rebuilt mid-session by a sync tick. Same card, same two-way grading
(会/不会) — this is free practice, not the four-grade drill. Back goes to
`/` (the entry screen is transient; returning to a finish screen would be
stranger than returning home). The existing end-of-deck summary
(「这 N 个已经排进顽固词队列」) applies as-is: misses here stamp
`missedAt`, which is exactly what that sentence describes.

## Tradeoffs accepted

- **Same-day repetition has diminishing memory returns.** The mode exists
  because the user wants the reps anyway; the design's job is to keep those
  reps from contaminating the data, not to forbid them. The label says
  不计成绩 up front, and the unsettled `missedAt` keeps the real check
  where it belongs — tomorrow.
- **Reopening the mode the same day deals the same first batch.** That is
  the request ("练到最顽固的词"), not a bug; the within-batch shuffle is
  the only variety needed.
- **The drill's daily boundary survives.** The once-a-day session keeps its
  completion feedback, its stat counting, and its role feeding tomorrow's
  queue. This mode adds a pressure valve beside it rather than removing the
  boundary.

## Testing

Pure logic only, per repo policy:

- `queue.test.ts`: `strugglingPracticePool` — union order (misses first,
  recency-sorted, then ease ranking), dedup, uncapped, no reviewed-today
  filter; `buildLapseQueue` derivation proven by the existing suite passing
  unchanged.
- `practice.test.ts`: batch walking (composition deterministic, exclusion
  respected, exhaustion returns empty) and within-batch shuffle under a
  fixed rng.
- `store.test.tsx` (the authorized exception): the `settle: false` write
  contract — a miss stamps `missedAt` and nothing else; a correct answer
  commits nothing, including over a word with a pending miss.

UI (button presence, screen copy) stays untested.
