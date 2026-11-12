# 回想 misses come back in the direction they were missed — without adding work

2026-11-11

## The question

The user asked whether words missed in 回想 should join the daily review, or
whether there is a better way to review them. Two constraints came out of the
conversation, both the user's:

- **No added load.** A first proposal (a 回想错题 row on 今日, about 15
  questions a day) was rejected in those words: the day already holds the
  scheduled review and the new words, and this would be a third thing.
- **A production miss is not a forget.** When the flipped card below cannot be
  produced, the interval is halved, exactly what a 回想 miss does today. It is
  not a lapse and it does not touch ease.

## What was measured (live progress, 2026-11-11)

- 656 words have a 回想 record: 1,670 answers, 1,171 right (70.1%).
- 103 words have a live miss (`recall.streak === 0`). **76 of them had not been
  asked again in 回想 for 8 days or more** (median 20 days, longest 76).
- Of those 76, **69 were graded in the scheduled review on a later day, and 53
  now sit on an interval of 21 days or more.** `rudimentary`: missed in 回想 on
  09-24, interval 84 days today, not asked in 回想 since.
- 回想 was played on 6 of the last 30 days: 350 questions, 192 right. The round
  that prompted the question was 50 asked, 23 right.

So the scheduled review does see these words, and passes them, because its card
is headword-front: it tests recognition, and the miss was production. And the
draw weight (`recallWeight` 2.5 on a live miss) is a probability over ~1,700
prompts, not a guarantee.

## The rule

**Debt is derived, not stored.** A word owes 回想 when

    (recall.streak === 0 && recall.reps > 0   (a live miss)
      || recall.reps > recall.correct)        (or one further back)
    && recall.streak < RECALL_STEADY_STREAK   (not yet right 3 times running since)
    && recallRating.level !== 'easy'      (the user's 太简单 overrules it)
    && state !== 'new'

A miss sets `streak` to 0, so "fewer than three right since the last miss" is
what `streak < 3` already says. The streak-0 arm is there for `mergeRecall`:
it takes `reps` and `correct` by per-field maximum and the streak from the
later side, so one device's 5/5 merged with another's later miss reads 5/5 at
streak 0, and the ledger alone would call that word clear. No live record is
in that state today. No new synced field, nothing to merge, and it
is the same number 词条详情 and 数据 already call steady.

**It is due after a gap that grows with the streak:** 1, 3, 7 days after
`recall.lastAt` (local calendar days) at streak 0, 1, 2. A right answer minutes
after a miss is short-term retrieval, the same hazard the 08-15 spec names.

By this rule, today: **231 words owe (103 / 83 / 45 by streak), 194 are due**,
all 231 in the review phase; 12 more are excluded by 太简单.

`src/lib/recallDebt.ts` owns both tests.

## Surface 1: the scheduled review turns the card over

A review-phase card that is due, in the 复习 session, whose word's debt is due,
is shown **Chinese first**: every meaning's part of speech and `zh`, and the
headword masked to its first letter (`r•••••••••`). Latin letters in a gloss
are masked too (`maskGloss`): 4 words in the library have a gloss containing
their own headword and 14 more carry other English, mostly a near-twin
(`fallible`: 区别于 fallacy). Flipping shows the ordinary
back under the ordinary head.

The grade row is the ordinary one with its first button replaced:

| key | button | what it writes |
|---|---|---|
| 1 | 想不出 | interval halved (see below), `missedAt`, one 回想 miss |
| 2 3 4 | 困难 良好 简单 | the ordinary `grade`, plus one 回想 right answer |

One row rather than a "想出来了吗" question followed by a grade row: it is the
same decision, one tap fewer, and the keys keep their meaning.

**想不出 (`gradeUnproduced` in `srs.ts`)**: `intervalDays = max(1,
floor(intervalDays / 2))`, `due = today + intervalDays`, `demotedOn = today`,
`reps + 1`, `lastReviewedAt` stamped. `ease`, `lapses`, `state` untouched. This
is `demoteWord`'s contract restated for a card that is due: `demoteWord` itself
takes a minimum against the existing `due`, which on a due card is today or
earlier, so it would leave the card due forever. Not a second halving on a day
`demotedOn` already names: the quiz demotion's one-a-day cap carries over, and
then the card is only rescheduled at the interval it has.

The 71fba29 hazard does not arise: the card served its interval, and the next
grade multiplies the halved one.

No 重来 on this card. The user has been shown the meaning, so nothing on it
can establish that the word is not recognised, which is what a lapse means.

**今日巩固 is kept clear of it.** Halving can land a short interval on one
day with today's stamp, which is all `buildConsolidateQueue` asks of "a word
learned today". That write stamps the 回想 record and the review with one
instant, and the queue skips a review-phase word where the two are equal.

**Daily counters.** 想不出 counts in `reviewed` but not in `correct`, so the
正确率 line on 数据 reads it as a card not got — which it was; 不算忘记 on the
card is about the schedule. It counts in `reviewWords` (it takes
a word out of the review block, and the cap's "spent plus remaining is
constant" depends on that) and stamps `carriedOver` as any first grade does. It
does **not** count in `reviewPhase` / `reviewPhaseCorrect`: those measure
whether the schedule holds for recognition, and this card did not test it. A
produced card goes through `grade` unchanged and counts as it always did.

**Not turned over:** learning-phase cards, new words, 困难's confirm showing
(the grade has landed; it is a second look, not a test), and 今日巩固.

Load: zero cards added. Counting the owing words by their current `due` date,
a static projection that ignores every grade still to come, 0–13 of each of
the next 14 days' cards are turned over (100 in total), against a cap of 88.

Known weakness, accepted: after one produced card the interval grows by ease
and the next turn of that card may be months out with the streak at 1. The
remaining two right answers are left to surface 2.

## Surface 2: a 回想 round opens on what is due

`generateRecallSession` takes the owed word ids, most overdue first. After the
巩固 prompts (unchanged, still device-local) the round opens with **one
question per owed word, up to half the round**, preferring a prompt the recency
record has not shown. The rest of the round is the ordinary draw.

Half, not all: 194 are due today, and a round made only of them is the fixed
list the stubborn-word drill became. 今日 gets no row and no count. Playing
回想 stays optional and a round is the length it was.

An owed slot is always 唤词, never 排序: ranking prints the word, and a right
ordering would settle a production debt with the answer on screen. And a
focused round (`?pick=`) takes only what is owed inside its focus, so the
focus stays what the user asked for.

Simulated on the live progress with the bundled content (600 rounds at 10, 20
and 50 questions): exactly half of every round was owed, none short.

A miss here writes what a 回想 miss always wrote (`recordQuiz` + `recordRecall`).

## Not doing

- A 今日 row or a daily quota of owed questions. Rejected by the user.
- A new synced field for the debt. The record already holds it.
- Replacing the 巩固 button or its localStorage list.
- Changing `recallWeight`. It still tilts the ordinary half of the round.

## This design is wrong if

- **The user grades turned cards 想不出 so often that intervals collapse.**
  Check after two weeks: review-phase words on a 1–3 day interval with
  `demotedOn` set and `lapses === 0`. If that group grows past a few dozen,
  the halving is too strong for a self-graded card and should become "keep the
  interval, reschedule only".
- **The masked headword gives the word away.** If nearly every turned card is
  graded 良好 while the same words keep failing in 回想 proper, the first
  letter is doing the retrieval; drop it.
- **Retention reads differently.** `reviewPhase` now omits 想不出 cards. If
  the retention figure is ever used to tune `intervalModifier`, that omission
  must be restated beside it.
