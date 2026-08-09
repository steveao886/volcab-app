# Free practice: a drill you can open whenever, over any slice of the library

**Date:** 2026-08-08
**Status:** approved (word source, recording contract and session size each
chosen by the user from three presented options)

## Problem

The user tapped `专攻 →` on the stats page's 还没记牢的词 card — which was
reporting 54 words — and landed on an empty review. Not a bug: three
independent gates, all of them written for a *daily task*, stack up on
`/review?mode=lapses`.

1. `lapseDrilledOn` in local storage (`Review.tsx`): once the drill is
   finished for the day the queue is forced to `[]`.
2. `buildLapseQueue`'s closing filter drops every word whose
   `lastReviewedAt` falls on today. After a normal review session that is
   most of the struggling list.
3. `LAPSE_SESSION_SIZE = 20`.

Each gate is right for the Today-page entry point, whose contract is "one
pass a day, and the row disappears when it's done". None of them is right
for the stats-card entry point, whose meaning is "I want to practise these
words *now*". Two entry points, one word set, two incompatible contracts —
so the second one reads as broken.

The user's framing: *"要不要弄一个 casual 的复习,或者就是复习但是不计入
真的复习时间"*.

Half of that already holds — the lapse drill has not touched the schedule
since `71fba29` (`recordLapseDrill` stamps `missedAt` and nothing else).
What is actually missing is a surface with **no daily budget at all**, and
one that does not inflate the "reviewed today" count either.

## Decision

Two changes, in opposite directions.

**Delete** the stats page's 还没记牢的词 card, entry link included. The user
judged the list itself unhelpful ("列表也没啥用"), and with the card gone the
conflicting second contract on `?mode=lapses` goes with it. The Today-page
task and `/review?mode=lapses` are untouched.

**Add** `/practice`: pick a slice of the library, get 20 of its words
shuffled, flip through them, and have nothing you do there reach the
scheduler.

### A separate route, not `?mode=free`

The repo's convention is that sub-modes of a page travel as `?mode=`
(`CLAUDE.md`, and `?mode=lapses` / `?mode=consolidate` both do this). Free
practice deliberately breaks it.

Those two modes are *the review page with a different queue*: same four-way
grading, same `practiceGrade` write path, same daily-completion marker. Free
practice shares only the card face — it grades two ways, writes strictly
less, takes its words from a filter rather than the scheduler, and has no
notion of being finished for the day. Folding it in would mean four more
conditionals in a 500-line component that already carries three modes.

`ReviewCardBack` is exported and takes `{ word }`, so the expensive half —
meanings, examples, etymology, related forms — is reused directly. The
component boundary is where the sharing already is.

### The word set travels as filter criteria, not ids

```
/practice?q=<query>&status=<all|new|learning|review>&src=<sourceNote>
```

`/practice` calls the same `filterWords` the library page calls, with the
same options object, and gets the same list. A list of ids in the query
string would break on any large filter (`status=review` is ~300 words);
router location state would not survive a reload, which on an installed PWA
is the normal way back into a page.

Sampling lives in `src/lib/practice.ts` as a pure function taking an
injected `rng: () => number` — repo rule, and the only way the shuffle is
testable.

The sample is drawn **once on mount**, exactly like `buildQueue` in
`Review.tsx`: recomputing it live would reshuffle the deck under the user's
hands, and `filterWords` depends on `progress`, which changes on every sync
tick.

### What a card writes

`recordPractice(wordId, correct)` — nothing more than a miss, and less than
any existing practice surface:

| | writes |
|---|---|
| 不认识 | `missedAt = today`. Nothing else. |
| 认识 | clears `missedAt`; when there was none, returns the identical entry and commits nothing at all |

Compared with `practiceGrade`, two things are deliberately *not* written:

- **`stat.reviewed`** — this is the user's "不计入真的复习". A casual flip
  through 20 words must not be able to make the day's chart look like a
  review session. It is the one number free practice could inflate for free,
  and inflating it would make every other statistic on the page unreadable.
- **`lastReviewedAt`** — not an omission but a requirement, and the same
  reasoning `71fba29` recorded for `markMissed`: `buildLapseQueue` reads
  that field to decide what has already been dealt with today. Stamping it
  here would hide the word from the stubborn-word drill that this miss is
  supposed to feed.

`ease`, `intervalDays`, `due` and `lapses` are never touched. `lapses` in
particular stays out because it means "forgot a word you had learned",
established on a graded review card — the same distinction
`recordConsolidation` already draws.

### Session shape

20 words, shuffled — the same number as `LAPSE_SESSION_SIZE`, which was
itself chosen as "roughly what one sitting can clear". Finishing offers
另来一批, which redraws from the same filter with the words already seen this
session excluded; when the filtered set is exhausted the button is replaced
by a note saying so.

Grading is two-way (`不认识` / `认识`, keys `1` / `2`, printed on the
buttons per repo rule). Four-way grading exists to feed `gradeWord`'s
interval arithmetic; with the scheduler out of reach, three of the four
would do the same thing, and a control that does nothing is worse than no
control.

## What changes where

| Piece | Change |
|---|---|
| `src/lib/practice.ts` (new) | `samplePractice(words, size, rng, exclude)` — shuffle, exclude, take |
| `src/state/store.tsx` | new `recordPractice` action; `clearMissed` promoted out of `practiceGrade`'s closure so both can use it |
| `src/pages/Practice.tsx` + `.css` (new) | the page |
| `src/App.tsx` | `/practice` route |
| `src/pages/Library.tsx` | `练这 N 个 →` below the filter chips |
| `src/pages/Stats.tsx` | 还没记牢的词 card deleted |
| `src/pages/statsDerive.ts` | `strugglingSummary`, `StrugglingSummary`, `StrugglingWord` deleted — Stats was the only consumer, and `noUnusedLocals` would fail the build on the leftovers |
| `src/lib/queue.ts` | untouched; `rankStrugglingWords` still feeds `buildLapseQueue`, `todayPlan` and `tuning` |

## Tradeoffs accepted

- **The struggling list loses its only visible surface.** The ranking still
  drives the drill and the Today row, but there is no longer a page that
  names the words. Accepted on the user's judgement that reading the list
  was not what they wanted from it — practising it was, and that is what
  replaces it.
- **Free practice cannot be "completed".** No daily marker, no Today-page
  row, no streak contribution. That is the entire point, but it does mean
  the surface is invisible to every progress display in the app.
- **A miss in free practice is worth exactly as much as a quiz miss.** Both
  stamp `missedAt` alone. Someone could clear a stubborn word's stamp by
  flipping past it casually. Accepted: the stamp is a "look at this again"
  hint with a one-week shelf life, not a claim about mastery, and the
  ease-based ranking that also feeds the drill is unaffected either way.
- **The library's filters are the whole vocabulary of "what to practise".**
  No "recently learned", no "words I missed this week" preset. If those turn
  out to be wanted, they belong as library filters, where the rest of the app
  gets them too.

## Known data problem, tracked separately

`rankStrugglingWords` selects on `ease < 2.5 && intervalDays < 21`. The
pre-`71fba29` bug inflated `intervalDays` (a practice miss set `due = today`,
and the next review multiplied whatever interval it found) and never touched
`ease`. Since `intervalDays` is an *exclusion* here, the damage runs one way:
genuinely hard words carried past 21 days are filed as mature and vanish from
the list. `71fba29` measured 9 words below initial ease scheduled 60+ days
out; those are exactly the ones missing.

`71fba29` stopped new pollution but repaired nothing already stored, and
`MAX_INTERVAL_DAYS` is documented as forward-looking only. The displayed
count is therefore an undercount. Measuring it needs the live
`progress.json`, which exists only in `volcab-data` and the browser — a
read-only script is ready and waiting for an exported backup. Repair is out
of scope for this spec.

## Testing

- `src/lib/practice.test.ts`: sampling is deterministic under an injected
  rng, returns everything when the pool is smaller than the size, honours
  the exclusion set, never repeats a word within a draw.
- `src/state/store.test.tsx`: a correct answer over an unmissed word commits
  nothing; a wrong answer writes `missedAt` and leaves `ease`,
  `intervalDays`, `due`, `lapses`, `lastReviewedAt` and `dailyStats`
  identical; a correct answer over a missed word clears the stamp.
- The page itself gets no component tests, per repo policy.
