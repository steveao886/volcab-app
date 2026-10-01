# Spacing related new words across days, not just within one

**Date:** 2026-10-01
**Status:** approved (3-day lookback + confusable pairs, of the variants below)

Follow-up to `2026-09-03-new-word-spacing-design.md`. That spec shipped a
same-day guarantee and named its own limit: the spacing pass orders one
day's intake, so the constraint a word imposes leaves with it at midnight.
This closes that limit.

## Problem

The user asked again for same-root and near-synonym new words to stay off
the same day **and off the next few days**. The trigger was the 2026-10-01
batch of 116 words (`prolonged`, `captivity`, `emergence` / `emergent`,
`appalling` / `abysmal` / `dreadful`), plus 80-odd `synonyms` cut that day to
remove homograph noise — `declaredLinks` reads `synonyms`, so cutting them
could have hidden relations the pass relied on.

Measured by replaying `buildQueue` day by day over the live library from
2026-10-02 (1087 words, 221 unlearned, `newPerDay` 8 — 28 days of intake),
counting related pairs by how many days apart they start. "Related" for
counting is declared link, shared stem, or a `buildContrastPairs` pair:

| days apart | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| pairs, current code | **0** | **13** | **14** | 8 |

Same-day works. The next two days do not: `affable` / `amiable`,
`receptivity` / `receptiveness`, `profligacy` / `profligate`, `expeditious`
/ `expeditiously` one day apart; `abysmal` / `dreadful`, `dreadful` /
`appalling`, `odious` / `detestable` two.

### What it is not

- **The synonym cuts.** Comparing declared links among the unlearned words
  under `ee323d5^`'s synonyms against today's: no link between two unlearned
  words was lost.
- **The gap.** Gaps of 8, 10, 12 and 16 give identical results. The gap
  acts inside one day's ordering, and at `newPerDay` 8 a gap of 8 already
  covers the whole day.

### What the current rule misses

Among the 221 unlearned words plus the 10 started on 2026-10-01, 84 pairs
are related by a declared link or stem, and **32 more only by a contrast
pair** — `appalling` / `dreadful`, `trivial` / `negligible`, `observant` /
`watchful`, `caged` / `incarcerated`, `irremediable` / `unmendable`. Nearly
all are real near-synonyms; the weakest (`remorseless` / `dogged`, joined
through `relentless`) is the kind of false positive the 09-03 spec already
judged harmless — it costs a few days of separation, nothing more.

## Decision

1. **`ProgressEntry.startedOn`**, optional, `YYYY-MM-DD`, written once by
   `gradeWord` on the entry it creates for a word leaving `new`. That is the
   only path out of `new`. `isProgressEntry` ignores extra fields, and an
   older build carries it forward through `{ ...prev }`.
2. **A lookback.** `buildQueue` passes the words started in the last
   **3 days, today included**, to `orderFreshWords`, which passes over a
   candidate related to any of them while anything else within `LOOKAHEAD`
   fits. Today is included because a session left halfway and resumed
   re-orders the rest of the day without the words already started — the
   same-day guarantee had a hole there.
3. **Confusable pairs count as related** on the intake side, computed over
   the pool plus the lookback.
4. **Capture proximity stays inside one day's ordering.** In the 2026-10-01
   batch 416 unlearned pairs sit within 3 array positions and 28 of them are
   related by anything else; applied across the lookback it makes the
   constraint unsatisfiable — the fail-open branch fires 18 to 47 times and
   the result lands worse than no lookback at all.

The review side (`isRelated` in the session spacing and in
`relatedDueGuard`) is unchanged; its numbers were measured on the narrow rule
and would need re-measuring.

## Measured

Same replay, pairs counted by days apart; score cost is the largest
`usageScore` gap crossed to defer a word:

| variant | 0 | 1 | 2 | 3 | score cost | fail-open |
|---|---|---|---|---|---|---|
| current | 0 | 13 | 14 | 8 | 1 | 0 |
| lookback 2 days + contrast | 0 | 0 | 0 | 34 | 1 | 0 |
| lookback 3 days, no contrast | 1 | 2 | 4 | 3 | 2 | 0 |
| **lookback 3 days + contrast** | **0** | **0** | **0** | **1** | **2** | **1** |

Two days pushes 34 pairs to exactly day 3. Three days leaves one pair
(`irremediable` / `unmendable`, 3 days apart, the single fail-open).

Cost: 30 of the 221 words start later than they would today — median 2
days, worst 6. Other `newPerDay` values: at 5, no pair within 3 days; at 10,
one pair 2 days apart. From 12 up same-day pairs appear, which is the
existing `MAX_SPACING_GAP` cap of 10, not the lookback.

### Rejected

- **Lookback 2 days.** Cheaper, but it just moves the pile to day 3.
- **Tiered fail-open** — when nothing fits, take the first candidate
  unrelated to today before falling back to the head. Identical results at
  `newPerDay` ≤ 10; not worth the extra branch.

## Transition

Words started before this ships carry no `startedOn`, so for the first
three days the lookback misses them. Not worth a heuristic backfill.
