# Extra-Practice Modes Design (Discrimination / Listening / Sprint) + Etymology

**Date**: 2026-07-27
**Background**: once the daily queue is empty, there's nothing left to do. "Done for today 🎉" is a disabled button, and of the six question types in Quick Test, five are recognition (multiple-choice) and the only production-type one is spelling. What's missing isn't a safe channel for extra practice — that already exists — it's a *form* for that extra practice to take.

## Prerequisite: extra practice not polluting SRS is already solved

`recordQuiz` only moves a missed word's `due` up to today; `ease` and `intervalDays` are never touched (`store.tsx:527`). **All three new modes copy this convention exactly**, so there's no need to redesign the scheduling, and no need to touch `srs.ts`.

---

## I. Entry point: mode switcher at the top of `/quiz`

No new page — add a row of chips at the top of `/quiz`: **Mixed / Discrimination / Listening / Sprint**, driven by the `?mode=` query param (matching the existing precedent of `/review?mode=lapses`).

**Why not a new `/drill` page**: all three new modes are fundamentally quizzes, reusing the existing `QuizQuestionView` rendering and the `recordQuiz` convention; the Today page already has 3 buttons, adding 3 more would be clutter.

**Defaults to "Mixed," the everyday path is unchanged in every step** — no added cost on the path taken every day.

Switching modes starts a fresh round (swapping the session component via `key`, the same trick already used for "take another round").

---

## II. Discrimination mode

### Data basis

`sharedSynonyms()` currently computes synonyms shared across multiple entries, and is used to **exclude** them (so you don't end up with two correct-looking options out of four, `quiz.ts:82`). Looked at the other way around, that's a ready-made map of confusable words.

Measured against the full 476-word list: **317 pairable pairs, covering 293 words (62% of the list)**, of which 94 pairs are mutual synonyms and 83 pairs share 2 or more synonyms.

### Pairing quality must be scored, not treated uniformly

Noise is a real issue: `promulgate` and `metastasize` share `disseminate`, but one is about enacting a law and the other is about cancer cells spreading — a two-way choice between them would be a free point.

New pure function `src/lib/contrast.ts`:

```
buildContrastPairs(words) → ContrastPair[]
score = number of shared synonyms + (mutual synonyms ? 2 : 0) + (same part of speech for the main sense ? 1 : 0)
```

Sorted by score descending, ties broken by id lexical order (to guarantee determinism). Implemented with an **inverted index** (synonym → list of word ids), pairing only within buckets, avoiding a 476² nested loop.

When generating a question, take the top-scoring batch as a candidate pool and shuffle it — favoring tight pairs, but not the same handful of questions every time.

### Question type

Take a cloze from A's example sentences (reusing `headword.ts`'s location logic, the same implementation as the existing cloze questions), with **only two options**: A and B. Answered by judging collocation and context.

If it can't be located, swap in B as the answer instead; if neither can be located, skip that pair.

### The comparison card is where the real value is

After answering, show A and B's definitions, examples, and collocations side by side. Even when a question could arguably fit both words (unavoidable with synonyms), laying them side by side makes the distinction clear — **turning "the question might be ambiguous" from a flaw into a teaching moment**.

Mobile-first, and two columns are too cramped at 375px, so it's two stacked blocks with a divider rather than a side-by-side layout.

`QuizQuestion` gets a `contrastId?: string` carrying the counterpart word's id. The render layer looks it up from `useApp().words` — `ChoiceQuestion` already calls `useApp()`.

---

## III. Listening mode

Two question types in rotation, both using the existing `lib/tts.ts`:

| Type | Prompt | Options | Tests |
|---|---|---|---|
| `audio2meaning` | reads the headword aloud | four definitions | sound → meaning |
| `audio2spelling` | reads the headword aloud | text input | sound → form |

**The `prompt` field stores what's to be read aloud, and the render layer must never display it** — displaying it would just be handing over the answer. This is a real footgun: `SpellingQuestion` currently renders `prompt` as a visible question, so the audio questions have to go through a different branch.

`audio2spelling` **doesn't show the phonetics**: the user just heard the pronunciation, so showing the IPA too would leave nothing left to test. Both are shown once the answer is revealed.

### iOS autoplay risk (known, not a blocker)

`speechSynthesis` on iOS may block autoplay without a user gesture.

**Handling**: every question has an explicit "🔊 play again" button, and it attempts to autoplay once on question entry — **being blocked doesn't affect the ability to answer**. No error detection or status indication is done for the autoplay attempt at all — such detection is unreliable, and the button itself is a complete fallback.

Includes a hint: "Can't hear it? Check the system volume and mute switch." The iOS side mute switch pitfall has already been noted once in HANDOFF.

---

## IV. Sprint mode

A 60-second countdown, only "see word pick meaning" and "see meaning pick word," both four-choice — spelling questions would kill the pace.

- Tapping an option **scores it immediately and advances**, no need to tap "Next"; correct/incorrect flashes a color for 350ms
- A wrong answer doesn't cost points, straight to the next question
- The end screen shows the score + personal best + whether it's a new record

Because the interaction is completely different from "answer, then tap next," it gets its own `src/pages/QuizSprint.tsx` rather than stuffing a timer into `Quiz.tsx`.

The countdown uses a **deadline timestamp + periodic tick**, not accumulating `setInterval` calls — to avoid drift.

### Personal best

`Progress` gets `bestSprint?: { score: number; date: string }`.

**Optional field**, for the same compatibility reason as `soundEnabled` and `settings.updatedAt`: when an older app version on another device pushes up a progress record without this field, the correct outcome is "no record yet," not "the whole data set gets judged corrupt."

**Merge rule** (touches `merge.ts`, with tests): take the higher score; on a tie, take the earlier date — whichever was achieved first is the record; if only one side has it, take that side; if neither has it, don't write the key at all.

`generateQuiz` gets an optional question-type restriction parameter (defaults to the existing `QUIZ_TYPES`). This parameter **must be a subset of `QUIZ_TYPES`** — discrimination and listening have their own generator functions, the function body doesn't handle them.

---

## V. Etymology

`Word` gets `etymology?: string`, one sentence, shaped like:

```
ab-(away) + rogare(to propose) → to abolish
```

- Shown on the **review card back** (next to the same-root words) and on the **entry detail page**
- Both forms get an optional input field
- `validate-words.ts` validates the format (non-empty, length cap) **only when the field is present**, it's not required
- Backfilled in batches, in-session, across the 476 words

### Why it stays optional rather than becoming required once backfilled

Not every word has a breakable etymology. For common words of Germanic origin, or words of uncertain origin, **making one up is far worse than leaving it blank** — a wrong etymology is more harmful than no etymology, because it becomes a false memory anchor.

Expected coverage is 60–75% (advanced words of Latin/Greek origin make up most of it); words without one simply don't show that block.

This also means the "strict on write, lenient on read" approach used for `usageScore` is only half-applied here: both ends are lenient. That's deliberate, not an oversight.

---

## Testing

Per project convention: pure functions get mandatory TDD, UI gets no component tests.

| File | What it tests |
|---|---|
| `lib/contrast.test.ts` | pairing score, sort determinism, inverted index gives the same result as a naive nested loop |
| `lib/quiz.test.ts` | generation of the three new question types: option count, answer is among the options, cloze doesn't leak the answer, the type-restriction parameter |
| `lib/merge.test.ts` | the four bestSprint cases (both sides have it / one side missing / both missing) |
| `scripts/validate-words.ts` | format validation when etymology is present |

## Not doing

- **Today's free recall (unprompted recall)** — reviewing several dozen words a day, writing them from memory doesn't add difficulty, retrieval strength doesn't go up enough. Cut.
- **Sentence composition + AI grading in-session** — cut.
- Sprint mode leaderboard, win streaks, achievement system — single-user app, no opponents, YAGNI.
