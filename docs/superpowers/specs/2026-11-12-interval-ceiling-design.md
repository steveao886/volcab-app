# A 21-day ceiling on review intervals

**Date:** 2026-11-12
**Status:** approved

## Problem

Weekly retention on scheduled reviews fell from 97.1% in the first week to
85.8% in the latest. The user asked what the 110 days of app data could say
and what should change.

`progress.json` keeps only each word's current state, so the review history
was rebuilt from the data repo: 3,011 commits to `progress.json`, diffed pair
by pair, give 6,096 review-phase grades, 5,647 of them on a card that was due.
Their retention is 91.8%; the app's own `reviewPhase` counters say 91.4% over
5,553, so the reconstruction is the same history.

Retention by the real gap since the previous review:

| Gap | Reviews | Remembered |
|---|---|---|
| 1 day | 1,508 | 94.8% |
| 2–3 days | 777 | 95.6% |
| 4–7 days | 1,343 | 95.5% |
| 8–14 days | 755 | 92.2% |
| 15–30 days | 898 | 88.1% |
| 31–60 days | 315 | 68.9% |
| 61 days or more | 51 | 43.1% |

The schedule multiplies every interval by `ease × intervalModifier`, about
3.3 at the library's mean ease of 2.2 and the user's modifier of 1.5, up to
`MAX_INTERVAL_DAYS = 100`. On 2026-11-12, 699 of the 1,136 review-phase words
held an interval of 31 days or more and 340 held 61 or more.

### What the gap does and what the history does not

A model was fitted to the 5,139 due reviews whose previous review is also in
the record:

```
R(t) = (1 − ε) · exp(−(t / S)^c)        t = days since the last review
S    = a · s^b · (grade, lapse and ease terms)    s = the gap the last review survived
```

Fitted: ε = 0.043, a = 67.3 days, c = 2.33, **b = 0.024**. Negative
log-likelihood 1,287.5 against 1,459.0 for a constant rate. On those rows it
reproduces each gap band of the table above within 1.2 points, and each of
the five calendar months within 2.4 with no term for time.

Two things in it decide the design.

- **Up to a week there is no decay to prevent.** The 4.3% is a floor that does
  not move with the gap. The forget log agrees: of the 29 lapses recorded at
  an interval under 15 days, 19 were 记混了.
- **The gap a word last survived does not predict how long it lasts now.**
  At the same 15–30 day gap, words whose previous gap was 4–14 days kept
  88.6% (n=703) and words whose previous gap was 15 days or more kept 87.0%
  (n=131). At 31–60 days it is 72.5% (n=149) against 63.8% (n=141). Forcing
  b to 0.15 costs 3 log-likelihood units and 0.3 costs 18.

So the curve is close to one curve for every word: about 90% at 18 days, 85%
at 24, 80% at 29, 70% at 45, 50% at 63. What matters is how long the gap is,
not how fast the schedule got there. The first reading of the data, "growth
is too fast at long intervals", was the same fact seen through a ratio.

**This is the weakest claim here and the design leans on it.** Hard words are
given short intervals and easy ones long, so at any one gap the long-history
words are the weaker ones, which hides strengthening. 110 days also cannot
show what a fifth pass at three weeks does. See "What would show this is
wrong".

### The model against the last 30 days

Started from the 2026-10-13 snapshot (948 words) and run 30 days at 7 new
words a day, the simulator gives 1,744 reviews, 185 lapses, 89.4%. The real
30 days were 1,634, 171, 89.5%. A variant that gave each word its own decay
rate from its ease gave 231 lapses and was dropped.

## Approaches

Steady state for 1,000 words, simulated with the app's own `gradeWord`
arithmetic and the user's grade mix since September. Minutes use the measured
seconds per card: 13.7 at a gap of a week or less, 17 at 8–21 days, 18.3 at
22–45, 19.5 at 46–60, 25.6 beyond, plus 2.6 relearning cards at 7.2 seconds
for each lapse.

| | Reviews a day | Lapses a day | Minutes a day | Retention at review | Recallable at a random moment |
|---|---|---|---|---|---|
| As is: ×1.5, ceiling 100 | 54.5 | 8.5 | 17.5 | 84.5% | 79.9% |
| `intervalModifier` 1.0, ceiling 100 | 78.6 | 7.3 | 22.8 | 90.8% | 90.2% |
| Ceiling 30 | 57.6 | 6.4 | 17.7 | 88.9% | 92.4% |
| Ceiling 25 | 60.7 | 5.8 | 18.6 | 90.4% | 93.4% |
| **Ceiling 21** | 65.7 | 5.3 | 19.5 | 91.9% | 94.2% |
| Ceiling 18 | 72.4 | 5.3 | 21.5 | 92.6% | 94.6% |
| Ceiling 14 | 86.3 | 5.2 | 24.9 | 93.9% | 95.1% |
| Growth held to ×1.25 above 21 days, ceiling 100 | 57.5 | 7.5 | — | 87.0% | 88.2% |

- **Lowering `intervalModifier`** needs no code. It slows the 1-to-7-day
  intervals, where nothing is being forgotten, and still lets a word reach
  100 days. 30% more minutes than now for less than a ceiling of 25 buys.
- **Tapered growth** was the first proposal. Under the fitted curve it is a
  slower road to the same long gaps.
- **A lower ceiling** is one constant. Down to 21 days it costs 2 minutes per
  1,000 words and takes "recallable at a random moment" from 80% to 94%.
  Below 21 the price climbs and the gain stops, because the 4.3% floor is not
  decay.

The user chose the ceiling at 21 days, with the daily review cap raised to
pay for it, on the reasoning that short-gap cards are quick. The seconds
above bear that out: reviews rise 21%, minutes 11%.

## Decision

### 1. `MAX_INTERVAL_DAYS` 100 → 21

`src/lib/srs.ts`, the constant and its comment. Nothing else in the scheduler
moves: not the growth, not `ease`, not the lapse path, not `intervalModifier`.

`fuzz()` already clips to the constant, and at the ceiling every grade lands
on exactly 21: `max(21 + 1, …)` is at least 22, and 22 × 0.95 rounds to 21.
That matters because `MATURE_INTERVAL_DAYS` is also 21 (`queue.ts`): a word at
the ceiling is 记牢 on 统计 and outside `strugglingPracticePool`, and must not
flicker across that line. **Do not add downward fuzz at the ceiling.**

The three grade buttons will all preview "21 天" on a word at the ceiling.
That is true and stays.

### 2. A one-time pull-back of what is already scheduled

The constant is forward-looking. Entries written before it keep their `due`
until they next come up, and on 2026-11-12 that is 851 words past 21 days,
448 of them last reviewed 21 days ago or more (the script's own dry run). `scripts/pull-back-intervals.ts`
rewrites them on the live `progress.json`:

```
for every entry with state 'review' and intervalDays > MAX_INTERVAL_DAYS:
  target        = local date of lastReviewedAt + MAX_INTERVAL_DAYS
  intervalDays  = MAX_INTERVAL_DAYS
  lastReviewedAt += 1 second
  if target > today:  due = min(due, target)
  else:               late
late, sorted by old due then id, k = 0, 1, 2…:
  due = min(due, today + 1 + floor(k / perDay))        perDay = 33
```

- **`intervalDays` and `due` move together.** CLAUDE.md forbids pulling `due`
  forward alone, because `gradeWord` multiplies whatever `intervalDays` it
  finds. Here the interval is rewritten too, and the new ceiling clips the
  next one in any case.
- **`lastReviewedAt` moves by one second** so the rewritten entry out-ranks
  each device's cached copy in `mergeProgress` (CLAUDE.md, "A direct write to
  `progress.json`").
- **Late words start tomorrow, not today.** A word made due today after the
  day's session would be carried over tomorrow, and each carried-over review
  takes a new word's place (`newQuota`).
- **33 a day** spreads the 448 over about two weeks. Simulated, one flood and
  33 a day lose the same number of words (1,167 and 1,178 lapses in 120
  days), so the spread is for the user's days, not for memory: no day opens
  with 120 of the oldest cards.
- Dry run by default; `--write` pushes with the blob sha it read, so a sync
  from the app in between makes GitHub refuse the write. Rerun it.

**Invalid if the new build is not what the user reviews on.** An old build
grades a pulled-back word from 21 days to 72. Run the script only after the
deploy that carries decision 1 is live, and reload the app before reviewing.

### 3. `settings.reviewCap` 88 → 120

Written by the same script (`--review-cap 120`), with `settings.updatedAt`
set to now so every device takes it. `DEFAULT_REVIEW_CAP` stays 88: it is what
an unset setting means, and this user's is now set.

At a 21-day ceiling 88 reviews a day carry about 1,340 words; the library is
1,825. 120 is what 1,825 words need at steady state (65.7 × 1.825).

## Simulated: the next 120 days

From the live state of 2026-11-12, 20 new words a day, the carried-over and
held-back rules as in `queue.ts`, 12 runs each.

| | Lapses | Retention | New words learned | Cards a day |
|---|---|---|---|---|
| Ceiling 100, cap 88 (as is) | 1,368 | 86.5% | 670 | 128 |
| Ceiling 100, cap 120 | 1,454 | 86.4% | 673 | 135 |
| Ceiling 21, cap 88, pulled back | 958 | 90.8% | 222 | 113 |
| Ceiling 21, cap 120, not pulled back | 1,379 | 90.0% | 662 | 159 |
| **Ceiling 21, cap 120, pulled back 33 a day** | 1,178 | 91.4% | 668 | 155 |

The chosen row finishes the library in the same 120 days as today's settings
and loses about 190 fewer words doing it. It is not cheaper: 155 cards a day
against the 87 the user actually graded over the last 30, because 20 new
words a day is more than double that month's 7. At steady state, once the
new words run out, it is about 119 reviews and 145 cards, 36 minutes.

## What would show this is wrong

Measured the same way, from the data repo's history, once 300 due reviews
exist at gaps of 19 to 23 days:

- **Retention there at 93% or more**: the model says 89.6% at 21 days and 300
  reviews put about ±3.5 points on it. The ceiling is lower than it needs to
  be; raise it to 25 and measure again.
- **Third and later consecutive passes at the ceiling 4 points above first
  passes, 200 reviews each**: words do strengthen with repetition at this
  gap, which this data could not see. A single ceiling is then the wrong
  shape and it should rise per word.
- **Retention there under 86%**: the curve has moved, most likely with the
  library's size, since most short-gap lapses are confusions. Re-fit before
  touching the number.
- **Daily due counts peaking above `reviewCap` every 21 days, six weeks
  after the pull-back**: with no fuzz at the ceiling, words that reach it on
  one day return together. If the cap is not smoothing that, add jitter
  upward from 21, never below it.

## Non-goals

- The growth formula, `ease`, and the lapse path. A lapse still restarts at
  one day; the data says that climb is longer than it needs to be
  (97.2% at the first one-day review after a lapse, n=472), and that is a
  separate change.
- `intervalModifier` and the advice in `tuning.ts`. With the ceiling in place
  the modifier only sets how many steps a word takes to reach 21 days. The
  advice still assumes an exponential curve and may suggest a larger
  modifier once retention passes 90%; following it is harmless here
  (1 → 5 → 21 instead of 1 → 4 → 14 → 21) and it is not rewritten now.
- A setting for the ceiling. It is one constant, and the conditions above say
  when to move it.

## Anti-goals: this is broken even if the tests pass

- A word at the ceiling whose `intervalDays` is 20, so it reads as not 记牢.
- The pull-back overwriting a review the user did between the read and the
  write, or resurrecting anything: it edits entries in place on the live
  copy and touches nothing else in the file but `settings`.
- A pulled-back entry reverting on the next app open because its
  `lastReviewedAt` did not move.
- Any change to `ease`, `lapses`, `reps`, `state`, `missedAt`, `demotedOn`,
  `recall`, `forgot` by the script.

## Testing

`src/lib/srs.test.ts`:

- the ceiling is 21, and a word at the ceiling lands on exactly 21 for 困难,
  记得 and 太简单 at both ends of the fuzz range;
- the existing tests that used a 10-day entry graded 记得 (25 days) to show
  something other than the ceiling move to numbers under it.

`scripts/pull-back-intervals.test.ts`, on the pure function:

- an entry at or under the ceiling is returned untouched, the same object;
- a not-yet-late entry gets `due = lastReviewed + 21`, never later than its
  old `due`;
- late entries start tomorrow, `perDay` to a day, oldest `due` first;
- `lastReviewedAt` is exactly one second later and still an ISO string that
  compares greater;
- learning-state entries and every other field are untouched.

Then break `MAX_INTERVAL_DAYS` back to 100 and confirm the new test goes red.

## Left to the builder

- The exact wording of the comment on `MAX_INTERVAL_DAYS`; it replaces the
  one that argued for 100 and should say what measurement replaced it.
- The dry run's printout: at least the counts, the due histogram for the next
  30 days before and after, and the settings change.
