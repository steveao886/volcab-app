# 回想 difficulty rating — a manual lever beside the automatic one

**Date:** 2026-08-25
**Status:** approved

**What is being built**: a three-state rating the user sets by hand on a
word — 太简单 / default / 要多考 — read by 回想's question selection and by
nothing else, sitting beside the two automatic difficulty signals as a third
multiplier.

---

## The problem, measured

回想 already has an automatic difficulty signal. `recallWeight`
(`src/lib/senseGroup.ts`) reads the user's own answers: a live miss streak
weighs 2.5, a lifetime rate under 50% weighs 2, under 80% weighs 1.5, and a
word answered correctly three times running drops to 0.5.

Two things it cannot do, both user-reported:

- **It is after the fact.** A word that is trivially easy has to be answered
  right three times before it eases off; a word that is hard has to be
  missed before it climbs. The user knows which is which on sight, and the
  app has no way to hear it.
- **Its easy end is far too shallow.** 0.5 is the floor, and the floor is
  deliberate — nothing in this app is ever excluded outright. But 0.5 is not
  "I never want to see this again", which is what the user actually said.

Measured 2026-08-25 against the bundled content — **412 sense groups +
1155 sentence renderings = 1567 candidates**, a round of 10 questions,
20000 rounds simulated through `weightedShuffle`'s own formula
(`rng() ** (1 / weight)`), with a well-covered word owning 6 candidates
(one group plus five renderings):

| weight | one marked word surfaces | 15 marked words' share of a round |
|---:|---:|---:|
| 1 (baseline) | every 26 rounds | 0.6 / 10 |
| **0.5** (today's automatic floor) | **every 48 rounds** | — |
| **0.05** (chosen: 太简单) | **every 540 rounds** | — |
| 3 | every 10 rounds | 1.5 / 10 |
| **6** (chosen: 要多考) | **every 6 rounds** | **2.7 / 10** |
| 10 | every 4 rounds | 3.7 / 10 |
| 20 | every 3 rounds | 5.4 / 10 |

A word the user has explicitly given up on still arrives every 48 rounds
under the automatic floor. That gap is the whole reason this exists.

## Scope: 回想 only

The field lives on the word (`ProgressEntry`) but **only
`generateRecallSession` reads it**. Not `/review`, not the other quiz modes,
not the drills.

Extending it to every practice surface later is a small change to
`difficultyWeight` — but it is not this change. 回想 is where the user
reported the problem, and production and recognition genuinely come apart
(the entire premise of `ProgressEntry.recall`): "easy to produce from
Chinese" implies "easy to recognise", but "hard to produce" implies nothing
about recognition. A rating collected in one direction should not be
silently spent in the other.

Reaching the scheduler was considered and rejected outright. `CLAUDE.md` is
explicit that practice surfaces reach `srs.ts` through exactly one door — a
quiz miss halving `intervalDays` under three guards — and a manual "this is
easy" pushing `due` outward would be the mirror of the drift `71fba29`
removed.

## The field

New **optional** field on `ProgressEntry`:

```ts
recallRating?: { level: 'easy' | 'hard' | 'none'; at: string }
```

Optional for the reason every added field is: another device on an older
build pushes entries without it, and the correct reading of its absence is
"never rated", not a rejected merge. Same rule as `Meaning.share`,
`settings.updatedAt`, `demotedOn`, `recall`.

### Why not inside `RecallStat`

`RecallStat` is a **measurement** — reps, correct, streak — and its `lastAt`
is documented as "ISO timestamp of the last 回想 answer". A rating set from
the word detail page involves no answer, so writing `lastAt` there would
make that sentence false, and `lastAt` is the merge key. A rating is a
user **instruction**, not a measurement of one; it gets its own field and
its own timestamp.

### Why not on the word entry

`words.json` is content and is at 989 KB against the limits documented in
`2026-08-22-contents-api-size-limits-design.md`. This is per-user state,
which is what `progress.json` is for.

### Why `'none'` instead of deleting the field

`'none'` means "I explicitly cleared this rating"; `undefined` means "never
rated". Both weigh 1, so the runtime never distinguishes them — the
distinction exists only for the merge.

If clearing were expressed by removing the field, the merge would have to
choose between "the side that has a value wins" (which resurrects a rating
the user just cleared on the other device — the bug `unionDismissed`
documents from the other direction) and losing the rating whenever one side
lacks it. A tombstone carries a timestamp, so the ordinary rule — later `at`
wins — covers clearing for free.

Cost: about 40 bytes per cleared word, and the key never goes away. Against
`progress.json`'s ceiling that is nothing; a few hundred lemmas is a couple
of kilobytes.

## Weighting

`ratingWeight` becomes the third multiplier on the candidate weight in
`generateRecallSession`, beside the two already there:

```
difficultyWeight    ×   recallWeight    ×   ratingWeight
(automatic:             (automatic:         (manual:
 can I recognise         can I produce       what the user
 it?)                    it?)                says)
```

| level | weight |
|---|---:|
| `'easy'` | 0.05 |
| `'hard'` | 6 |
| `'none'` / absent | 1 |

**Multiplied, never a filter.** A marked-easy word stays in the candidate
pool and remains reachable — the one sentence that has to stay true across
this whole app is `weightedShuffle`'s: heavier items tend toward the front
*without ever excluding the light ones*. 0.05 is not "gone", it is once per
540 rounds, and that is what was asked for.

**The two ends are deliberately asymmetric.** The automatic signal already
tops out at 2.5 on the hard end, so manual intent only has to push further;
on the easy end its floor of 0.5 is the thing being complained about, so the
manual lever there has to be roughly an order of magnitude stronger.

**6 rather than 20.** At 6 a marked word arrives every 6 rounds and fifteen
marked words take 2.7 of a 10-question round — clearly tilted toward what
the user flagged, without turning 回想 into a fixed list, which is the
failure the stubborn-word drill already produced once and
`weightedShuffle`'s own comment warns about.

**No cap on the product.** A word that is marked 要多考, on a miss streak,
and low on ease multiplies to a very large weight — and that is the right
answer. `generateRecallSession`'s first pass takes at most one question per
word, so a single word can never occupy more than 1 of the 10 slots however
heavy it gets.

## Where it is set

### On the question, at reveal

One button, chosen by state:

- The word **already carries a rating** (`'easy'` or `'hard'`) → show that
  level's button, selected; tapping it writes `'none'`.
- **No rating** — `'none'` or absent, which the UI does not distinguish any
  more than the weighting does → 太简单 after a correct answer, 要多考 after
  a wrong one.

This copies 巩固, which already appears only on a wrong answer
(`QuizRecall.tsx`, the `!correct` guard): the moment you want to say "too
easy" is the moment you just answered it without thinking, not ten questions
later. Showing the existing rating rather than the context-appropriate one is
what keeps a mark from becoming invisible and therefore unchangeable.

A wrong answer therefore carries at most two secondary buttons — `巩固 ·
再想一遍` and `要多考` — above 下一题.

No keyboard shortcut, matching 巩固: an undocumented shortcut does not
exist, and there is no room to print one here.

### On the word detail page

A three-segment control — `太简单 · 默认 · 要多考` — beside the existing
回想说出 tile. This is the only place that reaches all three states in one
tap, and **the only place a 太简单 word can be found again**: at 0.05 it will
not come back on its own.

Shown for any word with a progress entry, unlike the 回想说出 tile next to
it, which appears only once `recall.reps > 0`. That tile reports a
measurement and has nothing to say before the first answer; a rating is an
opinion, and the user can hold one about a word 回想 has never asked.

A word with **no** progress entry has never been studied at all, so 回想
cannot reach it and `rateRecall` would no-op on it. That case shows no
control rather than a dead one.

The selected segment is ink, not vermilion. Vermilion is reserved for
annotation and destructive actions.

### Written on tap, not at settlement

New store action `rateRecall(id, level)`, shaped like `consolidateWord`:
write `recallRating`, `commitProgress`, `flushProgress`.

A rating is user intent, not a round result — quitting a round halfway must
not discard it. The word detail page has no settlement to wait for anyway.

## Self-healing

**A wrong answer clears an `'easy'` rating**, writing `'none'`.

It fires in `handleAnswered`, at the moment of the answer — not in
`recordRecall` at settlement. Batching it into settlement is tidier and
produces a visibly wrong screen: the reveal would still show 太简单
selected, and pressing 下一题 would silently flip it. Clearing on the spot
means the reveal already shows the cleared state.

Because it sits in `handleAnswered`, it fires during the 巩固 re-drill as
well, which is correct rather than incidental: a miss is a miss for the
purpose of refuting 太简单, and the re-drill's exclusion from scoring is
about not letting 巩固 buy points, not about pretending the answer did not
happen. In practice the case is nearly unreachable — a word only enters the
re-drill by being missed in the scored round, which has already cleared it.

**A `'hard'` rating never clears itself.** The asymmetry is the point:
太简单 is a claim of fact and a miss refutes it, while 要多考 is a wish and
three correct answers are not grounds for the app to overrule it.

## Merge

`recallRating` **must not ride the wholesale `lastReviewedAt` pick** at the
top of `mergeProgress`. That pick resolves an entry by a timestamp only the
scheduler stamps, so a phone that rated a word and a laptop that graded the
same word in `/review` would resolve to the laptop's entry and the rating
would vanish silently and for good — the identical failure the comment above
the `recall` loop already records.

It merges in that same dedicated loop, by its own `at`: later `at` wins;
undefined on one side yields to the other. Because clearing is `'none'` and
not absence, that single rule covers setting, changing, and clearing.

`isProgressEntry` (`sync.ts`) validates only the required fields, exactly as
it ignores `recall` and `demotedOn`, so **sync.ts needs no change**. The
`validate-*` scripts gate content files and are untouched.

## Tests

Per `CLAUDE.md`: pure logic in `src/lib/*.ts` with a colocated test, no
component tests outside the one authorized file.

- `senseGroup.test.ts` — the three `ratingWeight` values; the rating
  multiplies into the candidate weight alongside the other two; **a
  marked-easy word is still present in the candidate pool** (this is the
  test that fails if someone later "optimises" the rating into a filter).
- `merge.test.ts`, extending `describe("mergeProgress's recall")` — merged
  on its own `at` rather than `lastReviewedAt`; a `'none'` beats an older
  rating from the other device; undefined on one side yields.
- `store.test.tsx` (the single authorized exception) — `rateRecall` writes
  nothing the scheduler owns; a wrong answer clears `'easy'` and leaves
  `'hard'` alone.

## Explicitly out of scope

The review schedule; the other quiz modes; a library filter for rated words;
any stats chart. The field is on the word, so each of these stays a small
change if it is ever wanted.
