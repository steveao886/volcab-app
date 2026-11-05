# Carried-over reviews take the new words' places

**Date:** 2026-11-04
**Status:** approved

## Problem

The user missed 2026-11-03 and opened 今日 on 11-04 to roughly two days of
reviews, with the usual twelve new words still waiting after them. Their
words: 就是太多了.

The two halves of the day behave differently today:

- **New words do not pile up.** `buildQueue`'s budget is
  `newPerDay − dailyStats[today].newLearned`, recomputed every day. A word
  not started yesterday stays in the pool; today's quota is still 12, not 24.
- **Reviews do.** The due list is every started library word with
  `due <= today`, uncapped, learning block first, then oldest due date first.
  Nothing a person skips goes away.

And there is no slack to absorb a missed day. Measured on the live
`progress.json` that day:

| | cards / day |
|---|---|
| Steady-state reviews, `Σ 1/max(1, intervalDays)` over started words (the figure `tuning.ts` uses) | 61.6 |
| 12 new words × (`LEARNING_STEPS` + 1 consolidation card) | ≈ 36 |
| What the user actually does, mean of the last 14 active days | 95 (≈ 100 on a full day) |

61.6 + 36 is the whole day. A missed day's ~60 reviews have nowhere to go
except on top of the next one. On 11-04, at the time of measurement, 54 cards
had been graded and 66 were still due, 14 of them from before today (12 one to
two days late, 2 more than a week). The queue serves oldest-due first, so the
54 came off the overdue end. That puts the overdue count at the start of the
day at **about 68** (an inference from the order, not a stored number). Under
the rule below that day would have had no new words, not 12 new words costing
another ~36 cards. That evening the user asked for exactly that, and the live
`newPerDay` was set to 0 by hand for the rest of the day.

## Decision

The user's rule, as they stated it: what was carried over takes the new words'
places, one for one; if more was carried over than the day's new-word quota,
the day is review only.

```
carriedOver   = started library words with due < today, counted at the start of the day
newQuota      = max(0, newPerDay − carriedOver)
fresh budget  = max(0, newQuota − newLearned today)
```

| carried over | newPerDay 12 gives |
|---|---|
| 0 | 12 new words, as today |
| 5 | 7 |
| 12 or more | 0, review only |

"Started library words" is the same set `buildQueue`'s due list uses: words
in `words` whose progress entry has `state !== 'new'`. Learning-phase words
left from yesterday count; progress entries for deleted words do not. The
comparison is strict (`due < today`); a word due today is today's work, not a
carry-over.

**Nothing else changes.** Every due review is still shown, in the same order,
with no daily cap. `srs.ts` is untouched: this decides how many unstarted
words enter today's session and never touches a word's schedule.

## Why the count is frozen at the start of the day

A live count would do nothing. A review session is `[...due, ...fresh]`
(`buildSessionQueue`), and the due list serves the overdue words first, so by
the time the session reaches new words the live overdue count has been
worked down to zero and the full quota is back. Leaving and re-entering
`/review` rebuilds the queue from `buildQueue` as well, so a count read on
re-entry has the same problem. The rule only lowers the day's load if the
number it subtracts stops moving once the day's reviewing has begun.

## Where the frozen number lives

A new optional field, `DailyStat.carriedOver?: number`, on the synced
`progress.json`.

**Counted when a review session is built, written with that session's first
grade.** The 复习 page in its due mode builds its queue once, on mount, with
its own `today` fixed at that moment (`Review.tsx`). That is where the fresh
list is decided, so that is where the count belongs. The page counts there
and passes the count along with its grades. `grade` writes it into
`dailyStats[day]` only when both of these hold:

1. the entry has no `carriedOver` yet, and
2. `day`, the date `grade` stamps by the clock, equals the session's own
   `today`, and
3. the session was built after this device's first pull of that day
   (`gradeSession`; the page decides at mount).

It rides on a grade that is being written anyway, so there is no extra write
and no push just for opening the app.

**Condition 2 is for a session that runs past midnight.** `grade` dates by
`todayStr(now)`, and the page keeps the `today` it mounted with. Without the
check, the first grade after 00:00 would create tomorrow's entry and stamp
every card still waiting in the open session as carried over. A user who
clears 30 cards between 23:50 and 00:10 would wake to "今天不学新词" after a
finished day. With it, those grades stamp nothing. The next morning's session
counts what is actually left, and the cards finished at 00:05 are no longer
overdue. (This was the first draft's mistake: it stamped on the day's first
write of any kind.)

**Condition 3 is for a device whose copy is from an earlier day.** The app
pulls at boot and on a push, not on resume. A phone resumed in the morning
still sees last night's laptop reviews as overdue, and so does a 复习 opened
while boot is still serving the cache. The first draft of this section said
merging to the smaller value would correct such a stamp. It cannot when no
other device stamps that day, which is the ordinary case of switching
devices overnight; the final review of the implementation found it. The
result would have been a review-only day whose hint blamed a backlog that was
already cleared. So the store keeps `progressPulledOn`, the local day of
this device's last login read, boot read (a 304 included) or successful
push. It is in memory only, because a resumed process must keep its old day.
A session stamps only if `progressPulledOn` was today when it mounted. A
session that may not stamp still cuts its own new words by the count it was
built with. The day stays on the live count until a session built after the
pull stamps. That errs toward more new words, never fewer. Offline all day
means no stamp all day, and the live-count behaviour; accepted.

**Practice and quizzes never stamp,** and do not need to. They never move a
`due` date to before today: `demoteWord` never sets `due` earlier than
tomorrow. So the live count is the same before and after them. Only a review
grade can change it, and the first review grade of the day is the one that
stamps.

**`buildQueue` reads `dailyStats[today]?.carriedOver ?? liveCount`.** Before
today's first review grade, the live count *is* the start-of-day count.
After it, the stored value holds. 今日 goes through `buildQueue` and reads the
same number. If an older build started the day on another device, its entry
has no field. This build then counts live and stamps at its own first
session. That undercounts by whatever the older build already cleared, and
errs toward more new words, which is the old behaviour.

**Merge: the smaller value wins.** With condition 3, two stamps for one day
come from two devices that each pulled that day before building their
sessions. They differ only when one built its session on a copy missing the
other's grades from earlier that day. That copy still sees those words as
overdue, so it overcounts, and the smaller stamp is the closer one. It is
also the one from the device that started the day, so that device's quota
does not move under it. The merge is a safety net here; condition 3 is what
keeps a stale count out. One side absent keeps the other side's value;
absent on both stays absent. `mergeProgress` rebuilds each `DailyStat` from
named fields and drops anything it does not list (see the comment there), so
`carriedOver` must be listed, through a `minOptional` beside `maxOptional`.
`isDailyStat` in `sync.ts` does not gate optional fields, so an older build
accepts the field.

**Accepted cost while builds are mixed:** an older build drops the field on
merge. On a day when one device still runs it, the newer device falls back to
the live count until its next session stamps again, so the quota can move
once that day. This ends when both devices update.

## 今日

The 学习新词 row is `count: q.fresh.length`, `done` when that is 0, with the
hint `已学 N`. On a review-only day it would turn into a tick with no reason
given. That reads as a bug, the same way the 顽固词 count did before
2026-09-22 (see CLAUDE.md). So when `carriedOver > 0` the row carries a
hint:

- quota cut to 0: `前几天剩 ${carriedOver} 张复习，今天不学新词`
- quota reduced: `前几天剩 ${carriedOver} 张复习，新词少学 ${newPerDay − newQuota} 个`

When `newLearned > 0` too, the builder decides how the two hints share the
slot. Both strings are UI text: Chinese, full-width punctuation, no ` · `
joins (CLAUDE.md, Design language). Their exact wording is left to the
builder. What is fixed is that a reduced or zero quota always says why.

## Non-goals

These were proposed on 2026-11-04 and turned down by the user as more than
the problem needs (不用这么复杂):

- a daily review cap with the remainder rolled over;
- ordering the backlog by forgetting risk instead of oldest due first;
- a 还欠 N 张，约 D 天补完 readout;
- one combined daily budget, with reviews first and new words filling what
  is left at three cards each.

Also out of scope:

- crediting overdue time when a late review is answered well (`gradeWord`
  computes the next interval from `intervalDays × ease` and ignores elapsed
  days). It touches the scheduler and needs its own spec.
- the 设置 advice (`recommendNewPerDay`). It models a steady state; a backlog
  day is not one.
- pulling from the server on resume or on a day change. Condition 3 keeps a
  stale count from being stamped without it, at the cost of an unstamped day
  when a device never pulls. A pull on resume would also fix stale due cards
  being served again, which predates this feature and is its own change.

## Anti-goals: this is broken even if the tests pass

- After a missed day, the next day's review session reaches new words once
  the overdue ones are cleared. That is the live-count failure.
- Today's new-word quota changes partway through the day, while reviewing or
  on re-entering 复习, without `newPerDay` changing. The one exception is the
  mixed-build day above.
- A session finished after midnight costs the next day its new words.
- A device resumed from an earlier day stamps a count that includes reviews
  another device already did.
- Opening the app on a new day causes a `progress.json` push on its own.
- Any field of any word's progress entry is written by this change.

## Testing

Pure logic in `src/lib/queue.ts` with `queue.test.ts`:

- the quota table above, including `carriedOver > newPerDay` → 0 and
  `newLearned` subtracting from the reduced quota;
- stored value used when present, live count when absent;
- `due == today` not counted, learning-phase words counted, a progress entry
  whose word is not in `words` not counted.

`merge.test.ts`: the smaller value wins, one side's value is kept when the
other is absent, absent on both stays absent.

`store.test.tsx` (the authorized exception):

- the first grade of a due-mode session stamps the count taken when the
  session was built;
- a second grade leaves it alone;
- a grade whose clock day differs from the session's day stamps nothing;
- `practiceGrade` and `recordQuiz` stamp nothing.

Then break it on purpose. Swap the stored value for a live count and confirm
the "quota does not move during the session" test goes red. Drop condition 2
and confirm the midnight test goes red.

## Left to the builder

- the helper's name and where the count function lives;
- how the session's day and count reach `grade` (an optional argument, or
  state the page sets);
- whether the consolidate mode carries a count (it has no fresh list, so it
  may simply never stamp);
- the hint wording within the rules above.
