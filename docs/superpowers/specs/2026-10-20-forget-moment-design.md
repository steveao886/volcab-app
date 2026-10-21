# When a learned word is forgotten: ask how, then untangle

**Date:** 2026-10-20
**Status:** approved 2026-10-20; implementing

## Problem

Asked what moment in a study session feels most like wasted effort, the user
named one: **a word they had already learned, found forgotten**. In their
words it is one of two things: their mind goes blank, or they recall the
wrong meaning. What they do today is reread the senses and the examples,
recite the word silently, and from then on grade more cautiously.

Rereading is the weakest remedy there is, and the data says it is not
working for the words that need it most. The point of this design is to make
the moment of forgetting do something: find out *how* the word was lost, and
when it was confused with a neighbour, take the confusion apart.

## What the data says

Measured on the live `progress.json` on 2026-10-20. The library had 1411
words and 978 had been studied, all of them in the review phase. The data
covers 86 days of near-daily use.

- **Forgetting is concentrated.** 331 of the 978 studied words (33.8%) have
  lapsed at least once, 503 lapses in all.
  - 113 words have lapsed two or more times. They carry 285 of the 503
    lapses, and 2009 of all 8353 gradings.
  - The worst cases each have 7 lapses and 27–38 gradings: `ostentatious`,
    `impetuous`, `ignominious`.
  - Words with 3+ lapses average 21 gradings, against 6 for words never
    lapsed.
  - **More of the same review is not saving them.**
- **Confusion is real, but in one place.** The measure is any-lapse rate,
  split by how many *studied* confusable partners the word has.
  - For usageScore 4–5 adjectives:

    | studied confusable partners | any-lapse rate |
    |---|---|
    | none (n=14) | 21% |
    | 1–2 (n=54) | 39% |
    | 3+ (n=78) | 49% |

  - For usageScore 6–7 adjectives, verbs and nouns the effect is flat or
    absent.
  - Across all studied pairs, both words have lapsed in 162 pairs, against
    about 136 if lapses were independent.
  - Typical tangles:
    - `corroborate` / `substantiate` / `vindicate` / `ratify`: 12 lapses
      between them
    - `impertinent` / `insolent` / `presumptuous`: 9
    - `presage` / `portend` / `foreshadow`
- **Volume.** 503 lapses over 86 days is about 6 a day.
- **Partners are usually available.** Of the 331 lapsed words:
  - 276 (83%) have at least one studied confusable partner;
  - 99 are polysemous;
  - 40 have neither.
- **A tangle cannot be a connected component.** Among studied words the
  contrast graph's largest component holds 346 words. A confused pair plus
  the studied words that are partners of *both* is small:

  | over 1184 studied pairs | words in the tangle |
  |---|---|
  | median | 4 |
  | p90 | 6 |
  | max | 10 |

  Examples:
  - `corroborate` + `vindicate` → `substantiate`
  - `impertinent` + `insolent` → `presumptuous`
  - `alleviate` + `assuage` → `abate`, `slacken`
- **The review card never shows a contrast note.** The 2087 notes in
  `contrastNotes.json` (coverage 2087/2087) render only in the 辨析 quiz's
  `ContrastCard`.

No per-review history exists. A lapse resets `intervalDays` to 0, so the
interval a word was forgotten at cannot be recovered. That is a gap this
design partly fills (see Data).

## What exists today

- **The review page** (`Review.tsx`).
  - Front: the headword. Back: `ReviewCardBack`, which shows meanings, 要点,
    例句, 近义/反义/搭配, 词源 and 同根词.
  - Grades: 重来 1 / 困难 2 / 良好 3 / 简单 4. The confirm showing after
    困难 offers only 重来 and 记住了.
  - 重来 on a review-phase card is a lapse (`srs.ts`): lapses +1, ease −0.2,
    the card goes back to learning and returns later in the same session,
    front first, with nothing marking it as relearning.
- **Contrast practice.**
  - 辨析 (`generateContrastQuiz`): an example of one word, blanked, with
    the two words as options; `ContrastCard` shows the note afterwards.
  - Sense groups: 唤词 and 排序 (`senseGroup.ts`).
- **今日** (`todayPlan.ts`). `PlanItem.count` is remaining work; a pool size
  goes in `hint`.
- **Sync merge** (`merge.ts`).
  - Per-word fields like `missedAt` ride the whole-entry pick by
    `lastReviewedAt`.
  - `recall` and `recallRating` have their own merges.
  - The top-level `diverge` map merges per key, with the later `lastAt`
    winning.

## Design

### 1. The forget question (decided with the user)

Every 重来 that is a **lapse** asks how the word was forgotten. A lapse is a
重来 on a card that was in the review phase before grading, including the
confirm showing. A 重来 on a learning-step card does not ask: that word was
never learned in this pass. The user accepted the extra step on every lapse.

After 重来 the card stays where it is. Under it, one row: **怎么忘的？**,
with two buttons and printed keys.

- **一片空白**: record it and move on.
- **想成了别的**: show a short list of what the word might have been taken
  for.
  - **The list holds meanings, never headwords** *(decided with the
    user)*.
    - Asked whether they can tell afterwards which word they mixed it up
      with, the user said 想成别的 is often just a wrong Chinese meaning, not
      another English word in mind.
    - So each option is a studied confusable partner's `meanings[0].zh`,
      **with every gloss term the word's own glosses already contain
      removed**. `vindicate`'s 证明…正确;证实 offered for `corroborate`
      (证实;确证) reads 证明…正确.
    - Drop a partner if nothing is left, and merge identical options.
    - The reason: unfiltered, 230 of 833 options (28%) shared a gloss with
      the answer, and the six closest pairs share one outright. A list of
      the right answer's own meaning cannot diagnose a confusion.
  - **Measured on the filter as written** (2026-10-20, live progress):
    - 275 of the 331 lapsed words (83%) keep at least one option, with a
      median of 2.
    - So do 102 of the 113 words that have lapsed twice or more.
    - Example: `impertinent` gets 傲慢无礼;放肆 (from `insolent`) and
      放肆;自以为是 (from `presumptuous`).
  - Order the partners by pair score and show at most 6 options.
  - Add **它自己的另一个意思** if the word is polysemous, and **意思想错了,但不在这里**
    always. The second is what 说不清 was in an earlier draft.
  - **A partner's meaning is chosen**: record the partner, then reveal both
    headwords and their contrast note in place, and continue on a key press.
  - **它自己的另一个意思**: record it and move on.
  - **意思想错了,但不在这里**: record it without a partner and move on. It
    opens no tangle and is treated like 一片空白 in §2.
  - If a word has no option and one sense, the list would hold only the last
    choice. Skip it and record directly.

Nothing about grading changes. The question is asked after the grade has been
applied.

### 2. A blank word's second showing (my call)

When a card comes back in the same session and its latest forget record is
from today, the front gets a hint ladder before it can be flipped. This
applies when that record is **一片空白**, or **想成了别的** with no partner (the
wrong meaning matched nothing offered):

1. one of its own example sentences, headword marked, no meaning shown;
2. its etymology up to the first `→`, if it has one;
3. flip.

Each rung is one key press. The user can flip at any rung.

**Rung 2 stops at the arrow, and nothing after it is shown.** Every one of
the 1042 etymologies in `data/words.json` (of 1411 words, measured
2026-10-20) ends in `→ <the Chinese meaning>`: `corroborate` is
`cor-(加强) + robur(力量) → 加固 → 证实`. Shown whole, rung 2 hands over the
answer, which is the reason 要点 was rejected below. The part before the
first `→` is the parts and their glosses, the memory anchor without the
meaning. If an etymology has no `→`, or nothing before it, the word has no
rung 2; fail closed rather than guess where the answer starts.

This deliberately differs from what I sketched in conversation (要点 → 词根 →
a blanked example). The front asks for the *meaning* of an English word, so
a 要点 would give the meaning away, and a blanked example asks the opposite
direction.

### 3. Tangles (decided with the user: day 1 and day 2)

A **tangle** is born when a forget record names a partner.

- **Members**: the confused pair, plus the studied words that are confusable
  partners of both. Rank them by pair score and cap the tangle at 5 words.
  *(Cap: my call; the median tangle is 4.)*
- **Key**: the sorted pair, `a|b`. If both words of a new confused pair
  already belong to an open tangle, refresh that tangle rather than opening
  another.

Its life:

1. **Day 1, light.** The review page's 复习完成 screen gets a section,
   **今天混过的词**, with each tangle born today. For each one:
   - its confused pair's contrast note;
   - one two-option question built like 辨析 for that specific pair: one
     word's example blanked, the two words as options, skipping sentences
     that contain the other word;
   - if no usable sentence exists, the note alone.
   - About a minute or two in total.
2. **Day 2, complete.** From the next day the tangle is due on 今日, in a new
   row **拆开缠在一起的词**. `count` is the number of tangles due, shown at
   most 3 per day, oldest first *(cap: my call)*. A session takes one tangle:
   - **Side by side**: every member's headword, `meanings[0].zh` and 要点,
     then the contrast notes between members, with the pair the user
     confused first and marked.
   - **Questions**:
     - For each member, one cloze from its own examples, with the members as
       options. Skip any sentence containing another member's surface form;
       skip a member with no usable sentence.
     - Where a sense group's `order` lies inside the members, add its
       question too: 排序 if it is rankable, otherwise 唤词. It is extra
       practice and does not gate completion.
   - **Each member needs one right answer, and it carries over.** *(My
     call.)*
     - A member answered right is settled.
     - The next session repeats the side-by-side but asks only the unsettled
       members.
     - When every member is settled, the tangle is done.
     - A miss leaves that member unsettled and the tangle due the next day.
   - **Why not "a clean session or nothing"**: measured accuracy on similar
     questions is 69% (辨析: 270 asked; 回想: 1560 asked). At that rate a
     4–5-question session is clean about one time in four. The due pile
     would grow every day, which is the backlog the anti-goals forbid.
   - **The 3-a-day cap is a default, not a wall.** *(My call.)*
     - The 今日 row counts at most 3 due tangles as today's work, oldest
       first.
     - After 3 sessions the row is done but stays a link
       (`PlanItem.reopenable`) while more are due.
3. **Refreshed.** A new confused pair whose two words are both members of an
   open tangle does not open another one:
   - the pair is appended to the tangle's `pairs`;
   - it gets today's day-1 treatment on 复习完成;
   - its two members become unsettled;
   - `dueOn` is not pushed back. *(My call.)*
4. **Reopened.** A later confused forget record inside a done tangle opens
   it again from day 1. Its members are recomputed then and only then.

### 4. The schedule is not touched

Everything here is practice in CLAUDE.md's sense.

- A miss in a tangle question stamps `missedAt` and nothing else, like the
  drills and 顽固词.
- It never demotes.
- `due`, `intervalDays`, `ease`, `lapses` and `state` stay the scheduler's.

## Data

New optional fields only. Another device on an older build pushes data
without them.

- **`ProgressEntry.forgot?: ForgetRecord[]`**, keeping the last 10.
  - A record is `{ at, kind, with?, prevInterval, prevReviewedAt }`:
    - `at`: an ISO string
    - `kind`: `'blank' | 'confused'`
    - `with`: a word id, or `'self'` for its own other sense, or absent for
      意思想错了,但不在这里
    - `prevInterval` and `prevReviewedAt`: the entry's `intervalDays` and
      `lastReviewedAt` **before** the lapse was graded. `gradeWord`
      overwrites both, so they must be captured first. *(My call.)*
  - It is written on the same entry the 重来 just graded, but it does **not**
    ride the whole-entry merge by `lastReviewedAt`. It is unioned by `at`
    and capped at `FORGET_LOG_LIMIT`.
    - *Why:* the phone records a lapse, then the laptop grades the same word
      later. The laptop's entry has the later `lastReviewedAt`, wins the
      pick, and has no record of the lapse, so the record would be dropped
      silently, along with the `prev` fields that cannot be recovered. A log
      has no single winner, so the union keeps every lapse either device
      saw.
    - Cutting the union at the cap, oldest first, makes the result a
      function of the two logs, so both devices converge on the same ten.
  - It is also the first per-lapse history the app keeps. The two `prev`
    fields tell a later analysis the interval each word was lost at, which
    today cannot be recovered.
- **`Progress.tangles?: Record<string, TangleStat>`**, keyed by the pair
  that opened it. Fields:
  - `pairs`: every confused pair inside it, latest last
  - `members`: stamped when the tangle is born and recomputed only on
    reopen, so the 60-day evaluation can tell who was in it *(my call)*
  - `settled`: members answered right since the last reopen or refresh
  - `bornOn`, `dueOn`, `doneOn?`, `lastAt`
  - There is no stored stage. Day 1 is `bornOn === today`, and due is
    `!doneOn && dueOn <= today`, so no stored state can disagree with the
    dates, which are the only thing a second device can be sure of.
  - Merged per key with the later `lastAt` winning, the `mergeDiverge`
    pattern.
  - Malformed entries are skipped, never thrown on.

Everything under `src/state/` that touches sync is data-safety logic. Read
`store.test.tsx`'s header before touching it.

## Goals, non-goals, anti-goals

- **Goals**
  - Every lapse leaves a record of how it happened.
  - Every confusion is shown its contrast at once, and studied as a tangle
    on day 1 and again on day 2.
- **Non-goals, for this version** (recorded so they are not taken as
  forgotten):
  - user-written memory hooks;
  - look-alike words (`impetuous` / `impervious`): the user says they
    rarely confuse those, so only synonym neighbours are offered;
  - diagnosing misses outside the review page;
  - anything aimed at fun;
  - any change to the scheduler;
  - new authored content.
- **Anti-goals.** It has failed even if it works when:
  - a review that isn't a lapse gets any slower;
  - tangles pile up into a backlog;
  - a question offers two right answers. The existing 辨析 quiz carries that
    risk for a blank both words fit; tangle questions must at least apply
    its sentence filter.

## Success and failure conditions

- **Baseline.** Of the 331 words that had lapsed by 2026-10-20, 113 (34%)
  have lapsed again.
- **Success.** After 60 days, the words that matter lapse again at a
  clearly lower rate than 34%. They are the words that:
  - carry a `confused` forget record naming a partner, the first written
    after shipping;
  - and whose tangle has since been done.

  The group is the word that lapsed, not every member. *(My call.)*
- **Failure: the tangle part is not working.** The second-lapse rate for
  those words is not below the baseline. In that case it goes back for
  redesign rather than further tuning.
- **Failure: too much.** More than 7 tangles sit due and unopened at once
  for more than a week. Then day 2 is too heavy as designed.

## Constraints

From CLAUDE.md:

- UI strings are Chinese, with full-width punctuation.
- 375px is the design width, built from `components.css`'s vocabulary.
- Cinnabar is for marks only; correctness is never conveyed by color alone.
- Every shortcut is printed on its control.
- Logic lives in `src/lib/` with colocated tests, and there are no component
  tests.
- Anything random takes an injected `rng`.

## Left to the builder

- The route and component split for the tangle session (`/practice?pick=…`
  or a page of its own).
- Which example the blank hint uses.
- How day 1's done state is stored.
- The exact tie-breaks in the partner list and the member ranking.
- Layout within the design vocabulary. Screenshot every new screen at 375px.
