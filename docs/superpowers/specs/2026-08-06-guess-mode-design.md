# 猜词: the one direction the app never tested

**Date:** 2026-08-06
**Status:** approved

## Problem

Five quiz modes exist — 综合, 辨析, 听音, 极速, 短文 — and every one of them
is **recognition**: four options, or a word picked from a candidate list.
Nothing in the app ever asks the learner to *produce* an English word from
its meaning.

That gap matters twice over. Recognition is far easier than production, so a
library that feels mastered under four-choice questions is not writable; and
retrieval practice is strongest precisely in the direction that is hardest.
The user reads a Chinese gloss and cannot summon the word — the app has no
mode that finds this out.

The second problem is motivational. This is a single-user app with no
opponents; a previous spec already rejected leaderboards, win streaks and an
achievement system for exactly that reason. What is left to build on is
puzzle quality, a visible score to beat, and agency.

## Decision

A sixth destination, **its own page at `/guess` with its own tab**, not a
sixth mode inside `/quiz`. The interaction is a text field and a shop of
clues, which has nothing in common with the tap-one-of-four rhythm the quiz
page is built around.

One question is a Chinese gloss and an empty box. Six clues sit underneath
with prices on them; the learner buys whichever ones they want.

```
把法律、条约正式废除掉                      10 分

┌────────────────────────┐
│                        │   ⏎ 提交
└────────────────────────┘

词性 -1   要点 -2   搭配 -2
词源 -3   例句 -3   首字母 -4      ▸ 看答案(0 分)
```

### Free choice, not a fixed ladder

The learner picks which clue to buy rather than unlocking them in order.
This is the whole point of the mechanic: over time you find out which kind
of hook actually works for you — the root, the collocation frame, the
grammatical slot, the first letter — and buying one becomes a deliberate act
rather than pulling a lever.

### Prices are measured, not assigned

Across the 498-word library:

| Clue | Price | Basis |
|---|---|---|
| 词性 | 1 | Partitions into 5 classes; **174 of 498 candidates survive** (35%) |
| 要点 | 2 | States the usage boundary, but only **60%** of words have one |
| 搭配 | 2 | Masked, it leaves a grammatical frame and one co-occurring word |
| 词源 | 3 | **97%** coverage, and a root often points straight at the spelling |
| 例句 | 3 | Masked, still a whole context — the most informative maskable clue |
| 首字母 | 4 | **38 of 498 survive** (7.6%) — the strongest mechanical cut |

词性 and 首字母 are priced off the measured partition. The other four cannot
be partitioned that way and are priced by editorial judgment, ordered by how
much of the answer they hand over; the numbers above are the claim, and if
play shows one of them mispriced, re-measure and update this table.

### Masking is mandatory, and failing closed is the rule

Measured over the library, the clue text contains the headword itself in
**498/498 collocations, 495/498 examples, and 254/300 word notes**. Shown
raw, those three clues are not clues, they are the answer.

So each is masked before display, reusing `isInflectionOf` from
`headword.ts` — the same matcher the passage validator uses. **If the word
cannot be located in the text, that clue is not offered for that word.**
Showing an unmasked example would be worse than offering one clue fewer, and
this is the codebase's standing rule: skip it rather than guess.

A clue with no data behind it (no etymology, no note) simply does not
render its button — the same treatment `Word.etymology` already gets.

### Scoring

A word starts at 10 points; each clue bought subtracts its price. Solving it
is always worth at least 1 point however many clues were bought; revealing
the answer scores 0. Wrong guesses cost nothing — the score measures how
much help was needed, not how many attempts.

Ten questions, so a session is out of 100.

Alongside the session score, one **personal best: how many words were solved
with no clue at all**. That is the only honest scoreboard a single-player app
has — the opponent is the previous you. Stored like `bestSprint`: optional
field, merged by taking the higher value.

### Answer checking is lenient

Case and surrounding whitespace are ignored, and inflected forms count:
typing `abrogated` for `abrogate` is right. The mode tests whether the word
is in your head, not whether you conjugated it.

The input must set `autocapitalize="off"`, `autocorrect="off"`,
`spellcheck="false"`. A phone keyboard that capitalises and rewrites C1
vocabulary would fight the user on every question.

### A near miss says so

Being one letter out and reaching for the wrong word are different failures,
and a single "不对" hides which one happened. A guess within a quarter of the
word's length in edit distance — one edit for `raze`, two for `abrogate`,
three for `circumlocution` — is reported as 就差一两个字母 rather than as a
wrong answer. It costs nothing and does not end the question: you are told,
you fix it.

Two things are never called a near miss, however close they measure:

- **Another headword in the library.** At this threshold, 21 pairs of
  genuinely distinct words sit inside each other's allowance out of 117,855 —
  imperious/impetuous, contentious/conscientious, gratify/ratify,
  disparate/disparage, mire/mime. Telling someone their spelling was close,
  when what they did was recall a different word, is the one actively
  misleading thing this feature could say. (At a 0.34 ratio it is 97 pairs
  and includes arduous/garrulous, which is why the threshold is 0.25.)
- **The word's own synonyms and antonyms.** `raze`'s gloss warns 注意与
  'raise' 反义, and `raise` is one edit away.

**A near miss is not accepted as correct.** Spelling is part of producing a
word, and this is the only mode that tests production at all; auto-accepting
two edits would also swallow the 21 pairs above whenever one of them is
outside the library. The hint removes the unfairness without removing the
task.

### The schedule is not touched

Settlement goes through the existing `recordQuiz(score, total, wrongIds)`,
which only pulls a missed word's `due` forward and never touches `ease` or
`intervalDays`. Practice must not reshape the review schedule.

A word solved with clues counts as **correct** — it was retrieved. A word
whose answer was revealed counts as **wrong**.

## Word pool

Learned words only (`state !== 'new'`). Asking someone to produce a word
they have never met is not practice.

Selection reuses `difficultyWeight` + `weightedShuffle` from `quiz.ts`, so
the words that are giving trouble come up more often, without the easy ones
ever being excluded.

## Structure

| File | Responsibility |
|---|---|
| `src/lib/guess.ts` (new) | Question building, clue masking, answer checking, scoring — all pure |
| `src/lib/guess.test.ts` (new) | Tests for the above |
| `src/pages/Guess.tsx` (new) | The session: prompt, input, clue shop, settlement |
| `src/pages/Guess.css` (new) | `.guess-*` |
| `src/components/Icon.tsx` | One more entry in `PATHS` |
| `src/components/TabBar.tsx` | A sixth tab |
| `src/App.tsx` | The `/guess` route, inside `RequireAuth` |
| `src/types.ts` | `bestGuess`, optional |
| `src/lib/merge.ts` | Merge rule for it, mirroring `bestSprint` |

The tab bar is a `grid-auto-flow: column` with `1fr` columns, so a sixth item
needs no layout change; it must still be checked at 375px, where six items
share the width.

## Not doing

- **Forgiving a confusable twin.** An earlier draft proposed that typing
  `assuage` when the answer is `alleviate` should not count as wrong, since
  the two are a scored contrast pair and the Chinese gloss genuinely fits
  both. Cut on the user's call: it hands over a very strong clue for free —
  being told your answer is "the confusable one" narrows the field to two.
  The unfairness it addressed is real and remains; if it starts to bite, the
  cheaper fix is to prefer prompts whose gloss is not shared.
- **A daily deterministic puzzle.** A good delivery shape for this mechanic,
  but a separate feature; the mode has to be worth playing before it is
  worth ritualising.
- **Achievements, streaks, leaderboards.** Already rejected in
  `2026-07-27-drill-modes-design.md` — single-user app, no opponents.

## Testing

`guess.test.ts` covers the pure layer: pool selection excludes new words,
masking blanks every inflected form, a clue whose word cannot be located is
withheld, prices sum correctly, a solve floors at 1 point, a reveal scores 0,
and lenient matching accepts case and inflection. The render layer gets no
component tests, per the repo rule.
