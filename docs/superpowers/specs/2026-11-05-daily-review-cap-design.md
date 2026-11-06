# A daily cap on reviews

**Date:** 2026-11-05
**Status:** approved

## Problem

The 2026-11-04 change (carried-over reviews take the new words' places) stops
new words piling onto a backlog. It does nothing about the backlog itself:
every due review is still shown, uncapped. The user, the next day: if a day
is left unfinished, or two in a row, the reviews alone stack into the
hundreds even with no new words.

Measured on the live `progress.json`, 2026-11-05, 1,112 started words:

| | |
|---|---|
| Steady-state reviews, `Σ 1/max(1, intervalDays)` | 59.8 a day |
| Started words due today | 47 (9 cards graded so far) |
| Already scheduled, cumulative, if nothing more is done | 87 by 11-06, 124 by 11-07, 290 by 11-12 |

The cumulative row counts only dates already on the schedule. Reviews
answered in between add their own lapses on top.

## Decision

The user's rule, as they stated it: **at most 88 words of review a day. The
rest wait for later. When 88 is reached, the day's reviewing is over** (到 88
就收工). There is no way to keep going that day. Spare time goes to the
other practice (多的时间可以做别的练习).

```
reviewCap    = settings.reviewCap ?? 88
spent        = dailyStats[today].reviewWords ?? dailyStats[today].reviewPhase ?? 0
reviewBudget = max(0, reviewCap − spent)
due list     = learning block (uncapped) + first reviewBudget words of the review block
heldBack     = review block length − reviewBudget, floored at 0
fresh budget = 0 when heldBack > 0, else as on 11-04
```

`reviewWords` is a new counter, described below. The name is the builder's.

The order is unchanged: the learning block first, then the review block
oldest-due first, with the usageScore tiebreak and the spacing pass. The cut
is taken from the review block **after** spacing, so the words served are
the head of the order the session uses today. Words past the cut stay due.
Nothing about them is written. Tomorrow they are the oldest due and come
first.

### What counts toward 88

**Review-phase words only**: a started library word with `state ===
'review'` and `due <= today`. Not counted:

- **The learning block.** It holds words partway through their learning
  steps: a word that lapsed earlier today, or a new word whose steps were
  not finished yesterday. Holding one back would leave it stranded between
  steps. A word that lapsed today was counted already, on its review-phase
  card. *(My call. A literal reading of "88 words" would also count new
  words left in learning from yesterday. They are a handful at most, since
  both learning steps land in one sitting.)*
- **The relearning cards of a lapsed word.** They belong to a word already
  counted. So 88 words is more than 88 cards. Simulated below, a capped day
  is 94–108 cards.
- **New words, and on a day the cap binds there are none.** In the
  conversation the user was told that new words sit outside the 88 because a
  backlog day has none anyway. The carried-over rule alone does not make
  that true. `carriedOverCount` counts `due < today`, while the review block
  takes `due <= today`. So 5 carried over plus 85 due today is 90 review
  words: the cap holds 2 back while `newQuota(12, 5)` still gives 7 new
  words, about 21 more cards after the 88. **So when the cap holds anything
  back, the day's new-word budget is 0.** *(My call. It keeps what the user
  was told, and the user's own rule is that a day that cannot finish its
  reviews gets no new words.)* It is stable all day, because the condition
  `spent + remaining review words > reviewCap` does not move while reviews
  are graded (next section). The exceptions are a change to the setting and
  a sync landing mid-day.

### The counter: review words spent today

`buildQueue` runs on every visit to 今日 and on every mount of 复习, so the
budget has to give the same answer every time it is recomputed during the
day. That needs a count that goes up by exactly one for each word that
leaves the review block.

**`reviewPhase` is not that count.** It is incremented for every
review-phase *card* (`store.tsx`, `prev.state === 'review'`), and one word
can show two review-phase cards in a day. Press 困难, and the word comes
back once to be confirmed (`advance` in `reviewQueue.ts`, `hardRecycled`).
It is still `state === 'review'` on that second look (`isHardConfirm`), so
pressing 重来 there grades it again and `reviewPhase` counts it twice. Used
as the counter, that word would take two slots. A day with exactly 88 due
would then lose its last word. Worse, the cap could start binding partway
through the day, which with the rule above would take the new words away
mid-session. `reviewPhase` is also the retention measurement `tuning.ts`
reads, so it stays as it is.

**So `grade` increments a new optional counter, `DailyStat.reviewWords`,
when `prev.state === 'review' && prev.due <= day`.** The second condition
excludes the 困难 confirmation: the first 困难 grade already moved `due` to
tomorrow or later. It also excludes a word whose `due` a mid-session sync
moved out, because another device spent that word. Two facts make
`spent + remaining review words` constant all day:

1. Only `grade` writes the counter, and the only caller of `grade` is
   复习's due mode. `recordConsolidation`, `practiceGrade`, `recordPractice`
   and the quiz writers never touch it.
2. The grade that counts a word moves it out of the review block.
   `gradeWord` on a review-phase card either sends it to learning (`again`)
   or schedules it at least one day out, because the interval grows by at
   least a day. Nothing moves a review-phase word's `due` back to today or
   earlier in the meantime: `demoteWord` never sets `due` before tomorrow
   (see the 2026-11-04 spec).

So leaving 复习 halfway and coming back resumes the same 88. Lowering the
setting mid-day takes effect at once and floors at 0. Raising it gives the
difference back.

**Merge: the larger value wins** (`maxOptional`, beside `reviewPhase`'s).
`mergeProgress` rebuilds each `DailyStat` from named fields, so the field
must be listed there. An older build drops it on merge. The read then falls
back to `reviewPhase`, which overcounts only by the 困难-then-重来 words
above, so the error is toward fewer reviews, by a word or two. When that
overcount tips spent plus remaining over the cap, it also zeroes the day's
new words, but only within a few words of the cap. *(Corrected after the
final review.)* The other mixed-build case errs the opposite way. A newer
device that already holds the field keeps it on merge, because the older
build's side lacks it and `maxOptional` takes the side that has it. So that
device never counts the older device's later grades that day, and it serves
more reviews. That is the old behaviour, and it ends when both devices are
updated.

**Across devices.** Used one after the other with a pull in between, the
second device adds to the first one's count, and the count is exact. Two
other cases are accepted, not fixed:

- **Both devices used offline the same day.** The merged count is smaller
  than the true total, and the day allows more than 88. That errs toward the
  old behaviour.
- **A device resumed from the background still has an earlier copy.** The
  app pulls at boot and on a push, not on resume (the 11-04 spec, condition
  3). A phone resumed in the evening sees 0 spent today and offers up to 88,
  many of them words the laptop already did that morning. That is the
  pre-existing "stale due cards on resume" problem, which 11-04 put out of
  scope as its own change. The cap does not cause it. Before this change the
  same phone offered every stale due card, so the cap can only shorten
  that.

### Where it lives

- `buildQueue` applies the cut and zeroes the fresh budget when it holds
  anything back. Both 复习 and 今日 go through it, so the page and its row
  cannot disagree (the reason `buildDayPlan` reads `buildQueue` at all). It
  also reports how many review words it held back for tomorrow. 今日 and the
  end screen need that number to say why.
- `grade` in `store.tsx` increments `reviewWords` under the condition above.
  `mergeProgress` lists the field. `isDailyStat` in `sync.ts` does not gate
  optional fields, so older builds accept it.
- **`dueForecast` (`statsDerive.ts`) keeps counting everything owed.** Its
  comment promises that its 今天 bucket matches 今日's due count. Under the
  cap, 今日's count plus its held-back number is what matches. The comment
  says so, and the code stays the same. *(My call. The forecast answers "what
  does the next week cost me", and a held-back word is still owed. Moving
  held-back words into 明天 would make it a projection, the kind of payoff
  estimate turned down on 11-04.)*
- `settings.reviewCap?: number` is optional, and absent means 88. Settings
  merge wholesale by `updatedAt` (`mergeProgress`), so no merge change is
  needed. `isProgress` in `sync.ts` checks only `newPerDay`, so an older build
  accepts the field. An older build that rewrites settings keeps it, because
  it spreads the settings object it pulled. If one ever drops it, the default
  is the same 88.
- 设置 gets a number input next to 每天新词数, parsed and clamped the way
  `clampNewPerDay` does it. Labels and bounds are the builder's call, but the
  minimum must be at least 1. A cap of 0 is a day with no reviews at all, and
  nothing in this design asks for that.

### Interaction with the carried-over rule

Nothing in the 11-04 rule changes. A word held back today has `due < today`
tomorrow, so it is carried over and cuts tomorrow's new words one for one.
That is what makes the backlog drain: a backlog day is review only, at most
88, and the steady state adds ~60. The stamp (`DailyStat.carriedOver`) is
counted from all started words due before today, capped or not. That is
right, because a word held back by the cap is still a word owed.

## Simulated

`gradeWord` and `buildQueue` from the tree, on the live `progress.json` of
2026-11-05. Each day serves the learning block and then up to 88 review
words. Review-phase cards miss at the measured retention (837 of 904
correct, 92.6%, the 14 active days before 11-05). Every other card is graded
good, and each word is walked until it leaves the day. "Skipped" counts
11-05 itself, of which 9 cards were done.

| Days skipped | First day back | After that |
|---|---|---|
| 1 | 85 review words, under the cap. 97 cards, no new words | 11-07 back to 12 new words |
| 2 | 122 due: 88 done, 34 held over, 100 cards | 11-08: 77 done, cleared, no new words. 11-09: 12 new words |
| 7 | 288 due: 88 done, 200 held over | 88 a day for five days (94–108 cards). Day 6 is 35 reviews and 6 new words, day 7 is a normal day |

The uncapped run after two skipped days, for comparison: 122 words in one
day, 134 cards.

## 今日 and the end screen

**A row that is done while words are still due says why.** This is the same
rule as `freshHint`, and the same failure as the 顽固词 count before
2026-09-22 (see CLAUDE.md).

- **复习到期** counts `q.due.length`, which is already capped. When words
  are held back, the row carries a hint with the number held back for
  tomorrow, before the 88 is reached as well as after. Once the 88 is done,
  the row ticks with that hint still on it.
- **The hero card** (`nextAction`) already moves past review when the due
  count is 0: to consolidation, then untangling, then the 顽固词 walk, then
  `complete`. That covers the user's "do other practice" until the end, but
  `complete` says 复习和巩固都清完了 (`Today.tsx`). On a day with words held
  back, that is the same false statement as the end screen's. So when words
  were held back, the complete state says the day's 88 is done and gives the
  number left for tomorrow. The existing pointer to the 快速测试 can stay,
  since that is the other practice the user means. The quiz row itself never
  becomes the hero: the plan labels it 可选. That is unchanged.
- **复习's end screen** (due mode) currently says 今日复习已全部完成, or, on
  an empty mount, 暂无待复习 / 暂时没有到期或新词需要复习. On a capped day
  both are false. When review words were held back, it says the day's 88 is
  done, gives the number left for tomorrow, and points to the other
  practice. Whether that is a sentence or adds a link beside 返回今日 is the
  builder's call.

All of this is UI text: Chinese, full-width punctuation, no ` · ` joins.

## Non-goals

- **Continuing past the cap.** The user turned this down outright: 到 88
  就收工.
- **Changing any word's schedule.** No rescheduling of the overflow, no
  spreading of the backlog by moving `due`. This design writes no progress
  entry. `srs.ts` is untouched.
- **Ordering the backlog by forgetting risk.** Turned down on 11-04. The
  order stays oldest due first.
- **A payoff estimate** (还欠 N 张，约 D 天补完). Turned down on 11-04. The
  held-over count above is not that. It is the reason a done row has words
  behind it, with no projection.
- **Capping new-word cards, total cards, consolidation, practice or
  quizzes.**
- **The 设置 advice** (`recommendNewPerDay`, `tuning.ts`). It models a steady
  state, and a capped day is not one. Same exclusion as 11-04.
- **Crediting overdue time** in `gradeWord`. This was already out of scope on
  11-04. It matters more under a cap, because held-over words are answered
  later still. It touches the scheduler and needs its own spec.

## Anti-goals: this is broken even if the tests pass

- After 88 review words are graded, re-entering 复习 the same day serves
  another review-phase word.
- A word is counted twice: its relearning cards, or a re-entry after a
  lapse, take a second slot.
- A word left partway through its learning steps cannot finish them because
  the cap was reached.
- A day the cap holds words back serves any new word.
- Today's new-word quota changes partway through the day without
  `newPerDay`, the cap setting, or a sync changing anything.
- 今日 ticks 复习到期 with no reason given while review words are still due.
- The end screen says 已全部完成 or 暂无待复习, or the hero says
  复习和巩固都清完了, on a day words were held back.
- A day with 88 or fewer review words due behaves in any way differently
  from before this change.
- Any field of any word's progress entry is written by this change.

## Testing

Pure logic in `queue.ts` / `queue.test.ts`:

- the review block is cut to `reviewCap − spent`, the learning block is
  never cut, and the held-back count is reported;
- `spent` reads `reviewWords`, falls back to `reviewPhase` when it is
  absent, and falls back to 0 when both are absent;
- spent already at or above the cap gives no review words, and the learning
  block is still served;
- anything held back gives an empty fresh list, whatever the carried-over
  count. The 5-carried-plus-85 case above is the test;
- `settings.reviewCap` absent means 88. A cap at or above the review-block
  length changes nothing, fresh list included;
- the cut is taken after spacing, i.e. the served words are the head of the
  order the uncapped queue would have used;
- a "re-entry" test: grade k review words through `gradeWord`, bump
  `reviewWords` by k, rebuild, and confirm that served + already graded is
  still the cap and the fresh list is unchanged.

`merge.test.ts`: `reviewWords`, the larger value wins; one side's value is
kept when the other is absent.

`store.test.tsx` (the authorized exception): a review-phase grade
increments `reviewWords` once. 困难 then 重来 on the same word increments it
once in total. A learning-phase grade, `practiceGrade` and
`recordConsolidation` leave it alone.

`todayPlan.test.ts`:
- the 复习到期 row's hint appears exactly when words are held back;
- the row is `done` with the hint once the budget is spent;
- `nextAction`'s complete state carries the held-back number when there is
  one.

Then break it on purpose:
- Count the learning block against the cap, and confirm the learning-block
  test goes red.
- Drop the `spent` subtraction, and confirm the re-entry test goes red.
- Drop `prev.due <= day` from the increment, and confirm the 困难-then-重来
  test goes red.
- Drop the fresh zeroing, and confirm the 5-plus-85 test goes red.

## Left to the builder

- names: the setting, the constant, the counter, the held-back field on
  `DailyQueue`;
- the 设置 label and bounds (minimum at least 1);
- the hint and end-screen wording, and whether the end screen links to a
  practice surface;
- whether `freshHint` and the new hint share a helper.
