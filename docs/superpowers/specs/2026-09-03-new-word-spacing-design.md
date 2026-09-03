# Spacing related words out of the new-word intake

**Date:** 2026-09-03
**Status:** approved (approach A of three presented)

## Problem

New words arrive at the library in clusters of near-synonyms. The capture
flow is a synonym walk — the user reads a word, taps a related word on the
detail page, taps another from there — so `staging.json` receives
`compassionate`, `empathetic`, `sympathize` back to back, and the fill-in
session appends them to `words.json` in that same order.

They then come out of the new-word queue in that same order, and the user
reported learning whole synonym families on one day.

### Why the order survives

`buildQueue`'s `fresh` half sorts unlearned words by `usageScore`
descending, and breaks ties **by the word's index in the `words.json`
array**. That index is capture order. `applyWordOps` appends a new word and
replaces an existing one in place, so the index never moves — the tiebreak
reproduces the synonym walk exactly.

The score cannot disperse them on its own. `usageScore` is a 1–10 integer,
and over the 717-word repo copy 87% of the library sits at 4–7:

```
1:2  2:15  3:46  4:94  5:173  6:214  7:144  8:24  9:5
```

So within a tier the index decides, and a tier is large.

Simulating the queue over the library's last 60 words at `newPerDay = 5`
reproduces the complaint exactly:

```
day 2: lifelong  renowned  obscure  quarrel  grudge
day 4: compassionate  empathetic  sympathize  uphold  dishonest
day 5: deceive  resentful  resentment  flashy  celebrated
day10: loathsome  conduit  transient  amiable  disagreeable
```

**11 of those 12 days contain at least one related pair.**

This matters beyond tidiness. Learning semantically related words in one
sitting is measurably harder than learning unrelated ones — the app already
has a place for deliberate confusable-vs-confusable work (the 辨析 quiz
mode), and it runs *after* both words are known, which is the right order.

## Decision

Keep `usageScore` priority. Change the tiebreak from capture order to a
stable hash, then run a spacing pass that defers a word when it is related
to something just placed.

### Rejected alternatives

- **Hash tiebreak alone.** One line, no new module, and it removes the
  *systematic* cause. But it offers no guarantee: measured, it takes the
  60-word pool from 11 bad days to 4, and the 120-word pool from 21 to 13.
  Three score-7 synonyms can still land on one day; it just becomes luck.
- **Fully random new-word order.** Disperses best, but throws away the
  reason `fresh` is score-ordered at all: only `newPerDay` words are learned
  each day, and that budget should buy the words most likely to be
  encountered. Rejected by the user.
- **Randomising the insertion position in `words.json`.** Mutates content
  data to fix a queue problem, and does nothing when the unlearned pool is
  one capture batch — which is the normal case.

## Design

### 1. A new module, not more of `queue.ts`

`src/lib/freshOrder.ts` with a colocated `freshOrder.test.ts`. It exports
one function:

```ts
orderFreshWords(pool: Word[], index: ReadonlyMap<string, number>, gap: number): Word[]
```

`buildQueue` filters the unlearned pool and slices to the budget as it does
today; the ordering between those two steps moves here. `queue.ts` is
already the largest pure module in `src/lib/`, and the relatedness predicate
plus the greedy pass is a self-contained unit with its own test surface.

### 2. Sort key: score, then a hash of the id

```
usageScore descending, then fnv1a(id) ascending
```

**A hash, not a random number.** `fresh` is computed independently by
`todayPlan` (the Today page) and by `Review.tsx` on mount, and it is
recomputed on every render of both. A re-rolled order would mean backing out
of the review page and re-entering hands you a different five words, and the
word shown as next-up would change under the user.

So this deliberately does **not** take an injected `rng`. The CLAUDE.md rule
("anything random takes an injected `rng: () => number`") exists to make
randomness testable; here the requirement is the opposite — the order must
be a pure function of the word set, and a test can assert the exact
sequence.

FNV-1a over the id: no dependency, and stable across devices and builds,
which matters because two devices computing a different "today's new words"
would each learn a different five.

### 3. Spacing pass

Greedy, over the sorted list:

- Maintain the output. For each next slot, scan forward through the
  remaining candidates and take the first that is **not related to any of
  the last `gap` words already placed**.
- Scan **at most 20 candidates ahead**. This bounds the work and it bounds
  the distortion: a word can only ever jump ahead of 20 better-scoring
  words, never the whole tail.
- If none of those 20 qualify, **take the head anyway**. Fail-open. The pass
  can never drop a word, never loop, and never return fewer than it was
  given — a queue that silently shrinks would be a far worse bug than two
  synonyms on one day.

### 4. What counts as related — three rules, unioned

**a. Captured within 3 positions of each other in `words.json`.**

The strongest signal available, because it *is* the cause. Measured over
13 semantically related pairs drawn from the reported clusters, 11 sit
within 3 positions of each other:

| pair | array gap |
|---|---|
| compassionate / empathetic | 1 |
| empathetic / sympathize | 1 |
| amiable / disagreeable | 1 |
| resentful / resentment | 1 |
| deceive / deceit | 1 |
| celebrated / illustrious | 1 |
| outraged / affronted | 1 |
| quarrel / grudge | 3 |

It catches pairs no declared field records — `quarrel`/`grudge` and
`empathetic`/`sympathize` appear in neither word's `synonyms`.

The index is stable: `applyWordOps` appends new ids and replaces existing
ones in place, so a word's position only changes if an earlier word is
deleted.

**b. A declared link.** `synonyms`, `antonyms`, or `relatedForms[].form`
naming another word in the library — 509, 202 and 130 in-library pointers
respectively over the repo copy, with 413 of 717 words carrying at least
one. This is the rule that reaches across capture sessions: a word added in
July and its synonym added in August are nowhere near each other in the
array.

**c. A shared stem.** Longest common prefix ≥ 5 with both remainders ≤ 4
characters. Catches the morphological families the other two rules miss:
`resent`/`resentful`/`resentment`, `renown`/`renowned`, `deceive`/`deceit`,
`advocate`/`advocacy`, `caprice`/`capricious`, `sympathetic`/`sympathize`.

It fires on 75 pairs across the library, of which roughly 5 are false
positives — `impasse`/`impassive`, `intrinsic`/`intrigue`,
`interlude`/`intercede`, `underhand`/`undermine`. **The rule is deliberately
loose because a false positive is harmless**: two unrelated words get
separated by a few queue positions, which costs nothing. This is the
opposite of the `etymology` rule (where a wrong guess plants a false memory)
and the two should not be reasoned about the same way.

### 5. Gap size

```
gap = min(newPerDay, 10)
```

Tying it to `newPerDay` gives it a meaning that survives a settings change:
*at least one day's worth of new words between two related ones.* Requiring
a distance greater than the window size is what guarantees they cannot share
a day — a window of `n` slots spans a maximum distance of `n - 1`.

**The cap of 10 is measured, not defensive.** A larger gap is not
monotonically better: once the constraint cannot be satisfied, the
fail-open branch fires constantly and the result degrades below a smaller
gap. Over the 60-word pool, `gap = 14` gives 4 bad days where `gap = 5`
gives 1.

### 6. Measured effect

Pool = the library's last N words treated as unlearned, `newPerDay = 5`,
counting days that contain at least one related pair:

| ordering | last 60 (12 days) | last 120 (24 days) | last 240 (48 days) |
|---|---|---|---|
| current (score, capture index) | 11 | 21 | 42 |
| hash tiebreak only | 4 | 13 | 13 |
| **hash + spacing, gap = 5** | **1** | **0** | **0** |

Cost in score priority, as the largest `usageScore` gap ever crossed to
defer a word: **1 point** on the 120- and 240-word pools, 3 points on the
60-word pool (a small pool leaves the pass fewer legal moves).

## Known limitation: the gap does not survive the day boundary

The spacing pass constrains one ordering. Words learned today leave the pool
tomorrow, and the constraint they imposed leaves with them — `resent`
learned today and `resentful` deferred behind it can be pulled to the front
of tomorrow's ordering.

So the guarantee this delivers is **"not the same day"**, and the worst case
becomes two consecutive days rather than one shared day.

Closing it properly needs to know which words were *started* in the last few
days, and `ProgressEntry` does not record that: `lastReviewedAt` moves on
every review, and there is no `startedOn`. The fix would be an optional
`ProgressEntry.startedOn`, written once in `gradeWord` when a word leaves
`new`, used to seed the pass's lookback with recently-started words.

Deferred by decision — ship the single-ordering guarantee first and see
whether two consecutive days actually reads as a problem.

## Testing

`freshOrder.test.ts`, pure:

- Score order is preserved when nothing is related.
- The tiebreak is the hash, not the input order — same set in a different
  input order yields the same output.
- Two words 1 apart in the array are never within `gap` of each other in the
  output.
- A declared synonym across a large array distance is spaced.
- A shared stem (`resent`/`resentment`) is spaced.
- Every input word appears exactly once in the output, including when the
  constraint is unsatisfiable (a pool where everything is related to
  everything).
- An empty pool and a single-word pool.

`queue.test.ts` keeps its existing coverage; the case asserting that ties
fall back to word-list order is replaced by one asserting the hash order,
since that behaviour is the thing being changed.
