---
paths:
  - "src/lib/{srs,queue,recallDebt,practice,tangle,forget,tuning,related}*.ts"
  - "src/state/**"
  - "src/pages/{Review,Practice,Quiz,Untangle,TangleDay1,ForgetAsk,Today,Settings}*.tsx"
  - "src/pages/{reviewQueue,todayPlan,todayStats,statsDerive}*.ts"
  - "src/types.ts"
  - "scripts/pull-back-intervals*.ts"
---

# SRS rules

Moved out of `CLAUDE.md` on 2026-11-13. Comments and specs written before that day cite "CLAUDE.md" for what is here ("practice in CLAUDE.md's sense", the one door from practice into the scheduler, the 2026-09-22 顽固词 counter). Root `CLAUDE.md` keeps the invariants; this file has the mechanism and the measurement behind each constant. Who asked for a change and what its first draft got wrong belong in the spec.

## The scheduler owns the schedule

`src/lib/srs.ts` is the scheduler, and it owns the schedule. Practice surfaces may reach it in exactly one way:

**A quiz miss halves `intervalDays` and never does anything else** (`demoteWord`). `ease`, `lapses`, `state` and `lastReviewedAt` are the scheduler's alone; `due` only ever moves *toward* now, never away. Three guards make that safe and all three are load-bearing:

- **Review-phase words only**, and **at most one demotion per word per day** (`ProgressEntry.demotedOn`). Wrong demotes and right does nothing, so without the cap it is a one-way ratchet and quizzes have no daily limit.
- **`due` takes a minimum against the existing date.** Scheduling from today alone can push a near-due word *further out* — a miss would promote it.
- **The 60-second sprint is exempt**, and the drills (`practiceGrade`) and free practice (`recordPractice`) never demote at all.

Everything else still holds: a practice miss stamps `missedAt` and nothing more. **Never pull `due` forward while leaving `intervalDays` alone** — `gradeWord` computes `next = intervalDays * ease` knowing nothing about elapsed time, so a word yanked back early and graded "good" grows as if the full interval had been served. That was a real bug (`71fba29`); the demotion above avoids it by changing the interval itself.

See `docs/superpowers/specs/2026-08-09-quiz-demotion-design.md`.

## 顽固词

**A scheduled review is the only thing that empties 顽固词, and the number on
今日 says so.** `strugglingPracticePool` admits a word on low ease, an immature
interval, *or* a `missedAt` inside seven days, and all three exits belong to
`grade`: the walk (`/practice?pick=struggling`) passes `settle: false`, so a
right answer there writes nothing and a wrong one only adds. Playing it cannot
move its own count, which read as a broken counter until 2026-09-22 — a real
user report. Two things came out of it. `grade` now clears `missedAt`, but only
on 记得/太简单 and only on a review-phase card: `again` and `hard` both dent ease,
so they confirm the miss rather than overturn it, and both learning steps land
inside one sitting, which is the short-term retrieval the 08-15 spec refuses to
credit. The 08-15 hazard does not reach `grade` at all — a graded card's `due`
moves past today, so it cannot be farmed. And the pool size moved out of
`PlanItem.count` into `hint`: that slot is remaining work everywhere else on
the page. Measured on the live library that day: 227 in the pool, 182 waiting
on ease or interval, 45 on a miss alone — and 123 of the 182 one good review
from crossing `MATURE_INTERVAL_DAYS`.
A ticked 专攻顽固词 row stays a link (`PlanItem.reopenable`): done there means
you sat down today, not that the pool is empty. That is why 今日 has no separate
顽固词加练 card — it existed only because the ticked row went inert, and put
the same walk on the page three times.

## 回想 misses on the review card

**A word missed in 回想 comes back Chinese-first, on the review card it already had, and that card has a second way to reach the schedule** (`gradeUnproduced`, 2026-11-11). The scheduled review's card is headword-front, so it passes words the learner cannot produce: 76 of the 103 words on a live 回想 miss had not been asked again for 8 days or more (median 20), and 69 of those 76 had been graded in the scheduled review meanwhile and passed.

- **No card is added**, by the user's constraint of no added work. The debt is derived from `RecallStat` (`lib/recallDebt.ts`: missed, not yet right three times running, due 1 / 3 / 7 days after the last answer), and a due review-phase card whose debt is due is turned over.
- **想不出 there halves the interval and is not a lapse**: `ease`, `lapses` and `state` stay where they were, and the one-a-day cap is `demotedOn`, shared with the quiz demotion in both directions.
- **It cannot be `demoteWord`**, which takes a minimum against a `due` that is already today and would leave the card due forever.
- It counts in `reviewed` and `reviewWords` and stays out of `reviewPhase`, since a card that showed the meaning first tested no recognition.
- Three hazards a review caught, each guarded now: the halved one-day word qualified for 今日巩固, 18 words' glosses printed the answer or other English, usually its near-twin, on the turned front, and an owed 回想 slot could be dealt as 排序 with the word on screen.
- 今日 has no row for any of this, by the user's decision.

See `docs/superpowers/specs/2026-11-11-recall-debt-design.md`, which also says what would show the halving is too strong.

The manual 回想 rating (`ProgressEntry.recallRating`, 太简单 / 要多考) is **not** a second door. It is read only by `generateRecallSession`, as a third multiplier on the draw beside `difficultyWeight` and `recallWeight`, and reaches nothing in `srs.ts`. Its two levels are 0.05 and 6 and both numbers were measured — re-measure before changing either.

See `docs/superpowers/specs/2026-08-25-recall-rating-design.md`.

## Untangling

**Untangling a confusion is practice too, and never demotes.** A lapse in the scheduled review asks 怎么忘的？, and naming a partner opens a tangle (`Progress.tangles`): 今天混过的词 on 复习完成 that day, then 拆开缠在一起的词 on 今日 (`/untangle`) from the next. 今天混过的词's question writes through `recordPractice(id, correct, { settle: false })` as each answer lands; `/untangle`'s clozes write once, through `recordTangle`, when the session's last answer lands, so a session left early writes nothing and is still owed. A miss in either stamps `missedAt` and nothing else — `due`, `intervalDays`, `ease`, `lapses` and `state` stay the scheduler's, and there is no `demoteWord` on this path. A right answer settles a tangle member, not the word: it leaves `missedAt` for a scheduled review to clear. The sense-group questions `/untangle` offers on its end screen, after the verdict and never in front of it, are 回想's view with its writes cut down: `recordRecall` (the production record) as each answer lands and, on a miss, the same `recordPractice` plus `recallRating` set back to none when it was 太简单, as a miss does in 回想; the reveal also lets the user rate the word by hand (`rateRecall`). Never `recordQuiz`, which demotes, and never 巩固, whose `consolidateWord` writes `lapses`. They come after `recordTangle` and settle nothing. The question itself is asked after the 重来 has been graded, so `recordForget` writes only the forget log and the tangle. See `docs/superpowers/specs/2026-10-20-forget-moment-design.md` §4.

## Day limits

**A review carried over from an earlier day takes a new word's place, one for one** (`newQuota` in `queue.ts`), and a day carrying more than `newPerDay` is review only. Measured 2026-11-04: 61.6 steady-state reviews a day plus 12 new words (~36 cards) was the whole of a ~100-card day, so a missed day had nowhere to go but on top of the next.

- **The count must be frozen**, because the session serves overdue cards first and a live count reaches zero just before the new words. It lives in `DailyStat.carriedOver`.
- The first `grade` of a 复习 session stamps it, on that session's own day, so a session running past midnight stamps nothing.
- **The session must also have been built after this device's first pull of the day** (`progressPulledOn`, `gradeSession`). A phone resumed in the morning still sees last night's laptop reviews as overdue, and with no other stamp that day, merging to the smaller value has nothing to correct against. The merge alone is not enough.
- Nothing in `srs.ts` moves.

See `docs/superpowers/specs/2026-11-04-carried-over-reviews-design.md`.

**A day serves at most 88 review-phase words, and a day that holds any back learns no new words** (`reviewCap`, `heldBack` in `queue.ts`; 设置's 每日复习上限; 2026-11-05). The carried-over rule kept new words off a backlog, but the already-scheduled reviews alone reached 124 by the third day of a two-day gap and 290 within a week.

- The cut takes the review block after spacing, and never the learning block.
- **The counter is `DailyStat.reviewWords`, not `reviewPhase`.** 困难 brings a word back to confirm while it is still in the review phase, and 重来 there grades it again. So `reviewPhase` counts one word twice, which is enough to start the cap binding mid-day and take the new words with it.
- `grade` counts a review-phase card only when it was due by that day. Every recompute gives the same answer, on 今日 and on each mount of 复习, because spent plus remaining is constant all day.
- **New words go to zero whenever anything is held back.** `carriedOver` counts `due < today` and the review block counts `due <= today`, so on a day of 5 carried plus 85 due, the carried-over rule alone would have served 7 new words after the 88.
- Simulated on the live progress at 92.6% retention: two missed days take one capped day and are cleared on the second day back. Seven take five capped days, are cleared on the sixth, and get the full 12 new words again on the seventh. A capped day was 94–108 cards.

See `docs/superpowers/specs/2026-11-05-daily-review-cap-design.md`.

## Interval ceiling

**No interval is longer than 21 days unless the user says so (`MAX_INTERVAL_DAYS`, 设置's 最长间隔), and how long the gap is matters where how the schedule got there does not** (2026-11-12). On 5,647 due review-phase grades, by the real gap since the previous review: 95.5% remembered at 4–7 days, 92.2% at 8–14, 88.1% at 15–30, 68.9% at 31–60, 43.1% past 60. The gap a word last survived adds almost nothing (a fitted exponent of 0.024): at the same 15–30 day gap, words whose previous gap was 4–14 days kept 88.6% and words whose previous gap was 15 or more kept 87.0%.

- **21 is also `MATURE_INTERVAL_DAYS`**, so a word at the ceiling must land on exactly 21, never 20, and the setting (`settings.maxIntervalDays`, 21 to 100, read through `clampMaxInterval`) has 21 as its floor as well as its default.
- **Lowering the setting does not move words already scheduled past it**; `scripts/pull-back-intervals.ts` does.
- **`intervalModifier` is the wrong lever for retention**: at 1.0 it slows the 1-to-7-day intervals, where the 4.3% of misses are confusions and not decay, for 30% more minutes a day.
- **Tapering the growth is the wrong fix too.** "Growth is too fast at long intervals" was the gap effect seen through a ratio, and a taper is a slower road to the same long gaps.
- **Below 21 days the gain stops**: per 1,000 words the ceiling at 21 costs 19.5 minutes a day against 17.5 at 100 and takes "recallable at a random moment" from 79.9% to 94.2%, and at 14 it costs 24.9 for 95.1%.
- The weak point is the 0.024: hard words get short intervals, which hides strengthening, and 110 days cannot show a fifth pass at three weeks. The spec says what measurement would move the number.
- At a 21-day ceiling the default cap of 88 carries about 1,340 words, so the user's `reviewCap` has been 120 since that day.

See `docs/superpowers/specs/2026-11-12-interval-ceiling-design.md`, which has the fitted curve.

## The review log

**The review log exists: it is the data repo's commit history.** `progress.json` holds only each word's current state, which is why "what interval was this lost at" could not be answered until the forget log. But the app syncs after every sitting, and 3,011 commits to `progress.json`, diffed pair by pair on `lastReviewedAt`, give every grade with the entry as it stood before and after: the grade (from `lapses` and `ease`), the real gap, the interval it replaced. Check any such reconstruction against the app's own counters before trusting it (91.8% retention against `reviewPhase`'s 91.4% here), and **back-test a simulator on the last 30 real days before reading its forecast**: the first one gave each word its own decay rate from its ease and predicted 231 lapses where there were 171.
