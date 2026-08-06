# The new-word advice was comparing two different quantities

**Date:** 2026-08-06
**Status:** approved

## Problem

The settings page told the user, at `newPerDay = 18`:

> 按这个设置每天约 53 张卡，而你近期实际每天 126 张 —— 还有余力，建议改成 50。

The user's reaction was that 18 already fills the day. They were right: 53
and 126 do not measure the same thing, and all three discrepancies point the
same way.

**1. `sustained` counts drill cards; `projected` never modelled them.**
`dailyStats.reviewed` is incremented in two places — `grade()` and
`practiceGrade()` (`store.tsx`). The second is the two practice sessions,
and the comment there says the inclusion is deliberate: a drilled card
"has to keep the streak alive and show up in the 30-day chart".
`recommendNewPerDay` then read that same number as spare *scheduling*
capacity. The lapse drill alone is up to `LAPSE_SESSION_SIZE` = 20 cards a
day, and the consolidation pass re-covers every card touched today sitting
at `intervalDays <= CONSOLIDATE_MAX_INTERVAL_DAYS` (= 1) — which is every
new word, since `GRADUATE_DAYS` is 1.

**2. `duePerDay` came from a 7-day forecast that counts each word once.**
`dueForecast` reads current `due` dates and never re-schedules, so a word on
a 2-day interval was counted once where it will really be asked three or
four times in that window. The undercount is worst for short intervals —
exactly the words that fill the day.

**3. `sustained` averages over active days only**, while `projected` is a
per-calendar-day figure. Rest days lower the true daily average and not this
one.

Reconciled against the user's own numbers: `projected` 53 = 17 due + 18×2
learning steps. A real day at that intake is 17 due + 36 learning steps +
~18 consolidation + up to 20 lapse drill + every "again" re-show — which is
the 126 the app was treating as headroom.

## Decision

Model the whole day, and make the due figure steady-state.

```
projected = steadyStateDue + n × (LEARNING_STEPS + 1) + lapseDrill
```

- **`steadyStateDue`** — `Σ 1 / max(1, intervalDays)` over every started
  word. A word on a 5-day interval costs a fifth of a card a day; a word in
  the learning phase (`intervalDays` 0) costs one. This replaces the
  forecast average and needs no horizon, so nothing depends on how far ahead
  we happen to look.
- **`LEARNING_STEPS + 1`** — the `LEARNING_STEPS` grades it takes a new word
  to graduate, plus the one consolidation card it earns by graduating at an
  interval of exactly 1 day. Charging a new word 2 when it costs 3 was a
  third of the error on its own.
- **`lapseDrill`** — `min(LAPSE_SESSION_SIZE, struggling words)`, a daily
  cost that exists whatever the intake is, so it also comes off the top when
  solving for a recommendation:

```
fitted = round((sustained - steadyStateDue - lapseDrill) / (LEARNING_STEPS + 1))
```

And put `sustained` on the same footing — **per calendar day**, measured from
the first day of study inside the window:

```
sustained = Σ reviewed / (window length − index of the first active day)
```

Dividing by the active days alone was defensible on its own terms ("a day
off is not evidence of a smaller appetite") but not against a per-calendar-day
projection: the schedule does not rest, the words come due anyway, and two
rest days a week inflated measured capacity by 40%. Days *before* the first
review still don't count — those are days the habit did not exist, and
counting them would tell someone a week in that they can't sustain what they
are visibly sustaining.

### What is deliberately *not* modelled

- **"Again" re-shows.** A missed card is graded again in the same session
  and counts twice. The rate is a property of the user's day, not of the
  setting, and guessing at it would be inventing a number.
- **Reviews the day's new words will generate later.** They land in
  `steadyStateDue` as soon as they exist. Projecting them forward would
  compound an estimate into a forecast.
- **Whether the drills are done at all.** They are offered once a day each
  and gated by `consolidatedOn` / `lapseDrilledOn`. Modelling them as taken
  matches `sustained`, which counts them when they are. A day that skips
  both simply comes in under projection, which is the safe direction.

### Why not fix `sustained` instead

Excluding drill cards from the sustained figure would be the other way to
make the two sides comparable, and it is not available: `reviewed` is a
single counter written by both paths, so past days cannot be split. Adding a
new counter would only start being useful two weeks later, and would leave
the advice wrong until then.

## What changes

| Piece | Before | After |
|---|---|---|
| `LoadInputs.duePerDay` | mean of a 7-day forecast, each word counted once | `Σ 1/max(1, intervalDays)`, computed inside `loadInputs` |
| `LoadInputs.sustained` | mean over active days | mean over calendar days since the first active one |
| `LoadInputs` | — | gains `lapseDrill` |
| `loadInputs()` | took `dueNext: number[]` | derives both from `words` + `progress` |
| `recommendNewPerDay()` | `duePerDay + n × LEARNING_STEPS` | `+ n × (LEARNING_STEPS + 1) + lapseDrill` |
| `Settings.tsx` | computed a `dueForecast` to feed the advice | no longer needs one |

`dueForecast` itself is untouched — the stats page still draws the 7-day
chart with it. Nothing in `srs.ts` moves; this changes advice, not
scheduling.

## Testing

`tuning.test.ts` covers the new arithmetic: steady-state weighting, the
consolidation card per new word, the lapse drill coming off the top, and a
regression fixing the reported case — a day whose sustained volume is mostly
drill work must not read as spare capacity.
