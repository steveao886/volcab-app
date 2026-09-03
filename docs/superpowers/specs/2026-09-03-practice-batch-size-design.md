# A batch-size choice before a free-practice session

**Date:** 2026-09-03
**Status:** approved

## Problem

Daily review volume falls as the library matures — that is the schedule
working — and the user wants to put the freed time into extra drilling of
the words they keep forgetting. The complaint is that practice arrives
"only 20 at a time".

Twenty is `PRACTICE_DRAW_SIZE`, and it is hard-coded into all three
free-practice modes (`Practice.tsx`'s `draw`): the library slice, the mixed
draw, and the struggling walk.

Practice is not actually capped at 20 — the finish screen's 再来一批 walks
further down the pool without repeating, and the struggling walk was
designed as the app's unlimited surface (2026-08-15 spec). So what is
missing is not headroom, it is the **choice of how much to commit to up
front**. Sitting down to do 50 and being handed 20 with a button is a
different experience from sitting down to do 50.

## Decision

A size step at the start of a free-practice session, on all three modes.
The chosen size is remembered.

`/review?mode=lapses` — the daily 专攻顽固词 drill — is deliberately **out of
scope**. It is a fixed daily cost, and `tuning.ts`'s `recommendNewPerDay`
charges `LAPSE_SESSION_SIZE` against the new-word budget on that basis
(`lapseDrill: Math.min(LAPSE_SESSION_SIZE, …)`). Making it user-sized means
making the daily-load advice follow it, which is a separate change with its
own reasoning. Extra volume belongs on the free-practice line, which by
construction charges nothing.

## Design

### 1. Logic in `src/lib/practiceSize.ts`, not in the page

`Practice.tsx` is already long and, per CLAUDE.md, gets no component tests.
The new module is pure and colocated with `practiceSize.test.ts`:

```ts
practiceSizeOptions(poolSize: number): PracticeSizeOption[]
readPracticeSize(): number
writePracticeSize(size: number): void
```

The page keeps only the JSX and the "has the user chosen yet" state.

### 2. The size step

`Practice.tsx` currently draws on mount (`useState(() => draw())`). It gains
a step before that:

```
顽固词加练            池子里还有 47 个
[10] [20] [30] [50] [全部 47]
 1    2    3    4     5
```

**Tapping a size starts the session — there is no separate 开始 button.**
One tap against today's zero, and the previously chosen size is highlighted
so "same as last time" is that one tap. Digit shortcuts are printed on the
chips, per the CLAUDE.md rule that an undocumented shortcut does not exist.

The pool count is shown because it is information the page has never
surfaced: how much stubborn work is actually outstanding.

### 3. Options adapt to the pool

`practiceSizeOptions` returns only the fixed steps that are **smaller than**
the pool, followed by an 全部 option carrying the pool's own size. A pool of
14 renders `[10] [全部 14]`, not five buttons three of which do the same
thing.

Fixed steps: 10, 20, 30, 50. 20 stays the default because it is the size
every existing session has been.

### 4. An empty pool skips the step

When the pool is empty the page goes straight to the existing 没有可练的词
screen. Asking someone to choose a batch size and then telling them there is
nothing to practice would be a small insult.

### 5. The choice is remembered in `localStorage`, not in `settings`

A new `volcab.practiceSize` key in `storage.ts`.

`progress.settings` is synced data. Putting the size there means a schema
addition and a `progress.json` push on every size tap, on the file three
devices write — for a preference whose loss costs one tap. `storage.ts`
already holds exactly this class of value (`lapseDrilledOn`,
`intervalTunedOn`, the recency lists), each with the same reasoning
recorded.

The cost is that the choice does not follow to another device. Accepted:
this is a single-user app used mostly from one phone, and the failure mode
is being offered 20 instead of 50 once.

Read leniently, in keeping with the codebase's read-side rule: a missing,
non-numeric, non-integer or out-of-range stored value falls back to
`PRACTICE_DRAW_SIZE` rather than propagating a bad deck size into the draw.

### 6. What does not change

- `PRACTICE_DRAW_SIZE = 20` stays, now as the default rather than the only
  value.
- `samplePractice`, `nextStrugglingBatch` and `buildMixedPractice` already
  take a `size` argument. Only the value passed changes.
- 再来一批 draws the next batch at the same chosen size, and 从头再练 restarts
  at it.
- `recordPractice` and its `settle` contract are untouched. Practising more
  still writes strictly less than a review.

## Testing

`practiceSize.test.ts`, pure:

- Options below the pool size are offered; options at or above it are not.
- The 全部 option always exists and carries the pool size.
- A pool smaller than the smallest step yields 全部 alone.
- An empty pool yields no options (the caller skips the step).
- `readPracticeSize` returns the default for a missing key, a non-number, a
  non-integer, zero, a negative, and a stored value beyond the largest step.
- A written size round-trips.

No component test for the step itself — that is the rule the module exists
to satisfy.
