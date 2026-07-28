# Passage Cloze Design

**Date**: 2026-07-28
**Background**: Of the seven existing question types, `clozeExample` and `clozeCollocation` already test "recognizing a word in context," but the context is only **a single sentence**, and each sentence tests only one word. The real difficulty isn't "knowing apprehensive" — it's "should this sentence use apprehensive or agnostic" — several words competing for the same blank, and a single-sentence cloze simply can't do that.

The original source material for the word list is itself a series of conversational notes that string new words together into a narrative. This feature brings that format back into the quiz.

## Premise: Don't Pollute the SRS, Don't Touch the Store

`recordQuiz(score, total, wrongIds)` only pulls the `due` date of wrong words forward to today; `ease` and `intervalDays` are never touched (`store.tsx`). **Passage mode copies this convention exactly**: each blank counts as one question, and `recordQuiz` is called once at submit time. The stats page, the wrong-word list, and stubborn words all wire up automatically — not a single line of `store.tsx` or `srs.ts` needs to change.

---

## I. Question Format: Word-Choice Cloze

A passage of 80–120 words with 3–7 blanks; a set of candidate words (two more than the number of blanks) is listed below the passage, and you tap to fill each blank one at a time.

**Why not four-choices-per-blank**: that would just swap `clozeExample`'s question from a single sentence to a passage, with no competition between the candidate words — the difficulty stays exactly where it is today. Word-choice cloze forces you to discriminate between several words based on context, and **the blanks are mutual clues** — once blank A is settled as `apprehensive`, blank B can no longer be it. That inference process is unique to this question format.

**Why not typed spelling**: typing out 6 long words for a 6-blank passage is too slow a pace, and it's easy to give up halfway through. Production ability is already covered by the existing `spelling` / `audio2spelling` types.

---

## II. Data Structure

`src/data/passages.json`, shipped with the app.

```ts
interface Passage {
  id: string        // stable short id, e.g. "merger-friday"
  title: string     // 「并购泡汤的那个周五」, used on the empty state and results page
  /** Sentence-by-sentence English. Target words are marked with {{wordId|surface form}}; shorthand to {{concoct}} when the surface form matches the headword */
  en: string[]
  /** Sentence-by-sentence Chinese translation, one-to-one with en */
  zh: string[]
}

interface PassagesFile { version: 1; passages: Passage[] }
```

**The English is also stored sentence by sentence, not as one long string.** Pairing the Chinese and English requires the sentences to line up one-to-one, and splitting on punctuation is a trap: `9 a.m.`, `Inc.`, and `U.S.` would each split one sentence into two, and this kind of usage is common in the example sentences (`concoct`'s example sentence even has "9 a.m. standup"). Making the pairing **structural** rather than derived makes the problem disappear entirely. When rendering the whole passage, just join with spaces.

### Why It Lives in `src/data/` Instead of volcab-data

A passage is **read-only content, not user data** — you will never edit a passage on your phone.

Putting it in volcab-data means paying the full cost of two-way sync: `isPassage` validation, a merge strategy, conflict handling, one more push path added to `store.tsx`. That layer isn't wiring, it's data-safety logic (mutex locks, catch-up flags, session-invalidation checks) — and paying that price for read-only content isn't worth it.

`words.json` is already 753KB, closing in on the GitHub Contents API's 1MB body limit; passages should be kept out of that file even more so.

The `data/` directory is reserved for the script-facing copy of the word list (which diverges from the live word list — see `f53adb9`); `src/data/` is **content shipped with the app**. The two are never mixed.

Loaded dynamically as a separate chunk via `import()`, so it never enters the initial bundle. 30 passages comes to about 45KB; even scaled up to 200 passages at roughly 300KB, it still won't slow down startup.

### Why Explicit Markers Instead of Runtime Location

`headwordPattern` (`lib/headword.ts`) was validated empirically on **single sentences**: it uses a tight rule when the base form is present, and falls back to a loose stem match `stem + [a-z]*` when the base form is absent. That loose rule tested at zero false hits on single sentences, but a passage runs to about 100 words, so the odds of a false hit are far higher — and here, one false hit means either the wrong word gets blanked, or a word that shouldn't be blanked gets blanked.

So the author marks the passage text explicitly, and `headwordPattern` is repurposed as a **validator**: the validation script uses it to confirm that `concocted` in `{{concoct|concocted}}` really is an inflected form of `concoct`. A location algorithm is a better fit as a validator than as a locator — during validation there's only ever one candidate word, so there's no room for ambiguity.

---

## III. Blanks and Candidate Words

### Only Blank Out Words You've Learned

Among marked words, **only ones with `state !== 'new'` get blanked**; words that haven't been learned yet, and words that can't be found in the user's word list (the pitfall where the repo copy and the live word list diverge), are printed as-is, as reading material.

This follows the same lesson contrast mode already learned (see the long comment on `generateContrastQuiz` in `quiz.ts`): don't quiz you on a word you've never seen. But unlike contrast mode, **an unseen word is allowed to stay in the context** — it isn't a question there, it's reading material.

### Upper and Lower Bounds on Blank Count

- Eligible blanks **< 3** → skip the whole passage (with fewer than three blanks the mutual-clue inference no longer holds; it degenerates into a few single-sentence clozes)
- Eligible blanks **> 7** → take the top 7 by priority "due today > learned but not due," and print the rest as-is. Too many blanks on one screen and you won't finish

**The same word gets at most one blank per passage.** When the same word is marked in more than one place, only the first is blanked and the rest are printed as-is — otherwise the candidate area would show two identical words, and the rule "used means crossed off" would immediately contradict itself.

### Candidate Words

Candidate words = every blank's answer + **2 distractors**, shuffled and placed below the passage.

Distractor sources, in priority order:

1. Words from `buildContrastPairs` (`lib/contrast.ts`) that are easily confused with one of the answers and that the user has already learned — a ready-made confusable-word graph, and a natural fit here
2. If that's not enough, take already-learned words whose primary sense shares its part of speech with one of the answers
3. If still not enough, take random already-learned words

A distractor can never be the same word as any answer, and distractors can't repeat each other. If 2 can't be filled, give fewer — one fewer distractor just makes this particular passage a bit easier, whereas surfacing a duplicate option is a defect.

### Candidate Words Show the Base Form, the Blank Takes the Surface Form

Candidate words always display the **headword's base form** (`concoct`); once one is chosen, what fills the blank is the **surface form** (`concocted`).

This question tests which word to pick, not inflection. The inflected form is handed to you directly, and you pick it up along the way — that's worth more than making you spell out `concocting` yourself, and it keeps a context question from being marked wrong over a stray `-ing`.

---

## IV. Passage Selection Algorithm

```
valid passage = eligible blank count ≥ 3
score         = (blanks due today) × 3
              + (blanks learned, not due) × 1
              − (done within the last 10 passages ? 5 : 0)
pick the highest score; ties broken at random
```

The penalty is set to 5 specifically to outweigh "one more due word" (+3): better to switch to a new passage with slightly worse coverage than to do the same passage two times in a row — the second time through, what you remember is last time's answers, not the words.

Due words are weighted above merely-learned words, because this question type is **first a review tool**, and only second a reading exercise.

### "Recently Done" Lives in localStorage, Not progress.json

Records the ids of the last 10 passages done, via `lib/storage.ts`.

Adding a field to `progress.json` for a de-duplication record would mean thinking through merge rules, sync conflicts, and cross-device semantics all at once, and all it buys you is "don't do the same passage two days running." It's perfectly fine for each device to keep its own record.

### A Passage Can Be Redone, but Its Blanks Change

As you learn more words, which blanks are available in the same passage changes — a natural rotation that needs no extra mechanism. The penalty term only guarantees you won't run into the same passage two times in a row.

### When No Question Can Be Produced

Following the precedent set by `EMPTY_HINT`, give a **specific** reason rather than generic copy:

> 短文题只考你学过的词,一篇里至少要凑够 3 个。再学一阵子,这里的题会自己多起来。

---

## V. Interaction and Scoring

### Entry Point

A fifth chip, "短文", at the top of `/quiz`, `?mode=passage`, part of the same set as the existing four modes (one entry added to the `MODES` array). The default still stays on "综合" (Mixed).

### Submit-Once — A Deliberate Departure from Existing Question Types

Existing question types lock as soon as you tap an answer (`answeredRef` is set synchronously). Passage mode is **fill in the whole passage, then submit**:

- Tap a blank → that blank is selected
- Tap a candidate word → it fills the selected blank, and that candidate word is crossed off
- Tap a filled blank → it's cleared, and the candidate word becomes available again
- Submit is only possible once every blank is filled

Rationale: the blanks are mutual clues, so refusing to let you change an answer would strip away the core inference process of this question type — realizing at the fifth blank that the second one is wrong is the normal way to solve this kind of question, not a mistake.

Progress is shown as "filled / total blank count," not "which question number."

### Scoring

Everything is scored at once after submission:

- Each blank is marked right or wrong; wrong ones show the correct answer
- Below the passage, a **sentence-by-sentence Chinese-English comparison** expands, with the sentence(s) containing a wrong blank marked in the translation
- `recordQuiz(score, total, wrongIds)` is called once, with `total` = the number of blanks and `wrongIds` = the wordIds behind the blanks that were filled wrong
- The `playQuizResult` sound plays **once**, based on the overall right/wrong outcome at submit time — not once per blank (that would be noisy)

**Each blank counting as one question** means a 6-blank passage logs as 6 questions in `dailyStats`, so the "今日测试" (today's tests) number will climb faster than it does now. That's correct: 6 blanks really is 6 retrievals.

### The Chinese Translation Only Appears After Submission

Showing the Chinese translation while you're still answering would put the answer in Chinese right next to the blank — "董事会对并购感到忧虑" (the board is apprehensive about the merger), and there's nothing left to think about for `apprehensive`.

---

## VI. Content Production

### Scale: Pilot with 20–30 Passages First

Cover only the batch of words with a high `usageScore` that the user has already learned. Build the question type first, use it for a week, confirm this kind of question really does beat single-sentence cloze, before deciding whether to scale it up to the full word list (covering every word with ≥3 passages needs roughly 200 passages — English plus Chinese translation for twenty-thousand-plus words).

Getting it wrong only wastes the effort of 30 passages.

### Production Pipeline

1. Pick words by `usageScore` and learned status, split into groups of 6–8 words each
2. Dispatch agents in parallel, each agent taking one group and writing 1–2 passages, outputting a JSON fragment in a shared format
3. Merge and de-duplicate, run the validation script
4. Spot-check by hand, then check into the repo

### Validation Script `scripts/validate-passages.ts`

Follows the same pattern as `validate-words.ts`. Checks:

- `id` is unique and well-formed
- Every `{{wordId|form}}`'s `wordId` exists in the word list
- `form` really is an inflected form of that headword — decided using the newly exported `isInflectionOf(form, headword)` from `lib/headword.ts`. **Can't use `headwordPattern` directly**: when the base form is absent it falls back to the loose stem match `stem + [a-z]*`, and that rule would judge `reference` to be an inflected form of `refute`. A location algorithm is a better fit as a validator than as a locator — during validation there's only ever one candidate word, and this calls for the strict suffix-enumeration rule
- Every passage has ≥ 6 marked words (blanks only ever come from learned words, and too few markers means even an early passage can't scrape together 3 blanks)
- The sentence count in `zh` matches the English sentence count
- A coverage-distribution report: which words have never been strung into a passage, and which words appear in how many passages

**A passage that fails validation does not go into the repo.**

### Tolerant of Bad Data at Runtime

The validation script is the gate at write time; the read path still has to survive a broken passage: a malformed marker, a `zh` sentence count that doesn't match, a `wordId` that can't be found — in every case, **skip that passage**, without throwing and without a blank screen. This is the same rule as the "strict on write, lenient on read" rule for `words.json` (see the comment on `Meaning.share` in `types.ts`).

---

## VII. Testing

All the pure logic lives in `src/lib/passage.ts`, paired with `src/lib/passage.test.ts`:

- Marker parsing: both `{{concoct}}` and `{{concoct|concocted}}` forms, malformed markers, a bare `{{` appearing in the passage text
- Blank selection: only learned words get blanked, skip when eligible < 3, take the top 7 by due-first priority when eligible > 7
- Candidate word generation: distractor source priority, no duplicates, no conflict with answers, degradation when there aren't enough
- Passage-selection scoring: due weighting, the recently-done penalty, determinism of random tie-breaking (inject an rng)
- Edge cases: a word not in the word list, `zh` sentence count mismatch, a passage with no markers at all

No component tests for the UI, following the repo's convention (see the note at the top of `store.test.tsx`). All that's left for the render layer is "paint the result the pure functions already computed."
