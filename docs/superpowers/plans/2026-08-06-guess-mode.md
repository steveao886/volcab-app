# 猜词 Implementation Plan

**Goal:** A sixth destination at `/guess` with its own tab: a Chinese gloss, a text box, and six priced clues. The first mode in the app that tests production rather than recognition.

**Architecture:** Every decision — which words, which clues survive masking, what a guess is worth — lives in `src/lib/guess.ts` as pure functions with a colocated test. `src/pages/Guess.tsx` paints an already-computed question and owns only session state. Settlement reuses `recordQuiz`, so neither `srs.ts` nor the scheduler changes.

**Design doc:** `docs/superpowers/specs/2026-08-06-guess-mode-design.md`

---

## Task 1: Answer checking

**Files:** create `src/lib/guess.ts`, `src/lib/guess.test.ts`

- [ ] Failing tests: exact match; case-insensitive; surrounding whitespace; inflected form (`abrogated` → `abrogate`) via `isInflectionOf`; a different word is wrong; empty input is wrong.
- [ ] Implement `checkGuess(input, headword)`.

## Task 2: Clue masking

**Files:** modify `src/lib/guess.ts`, `src/lib/guess.test.ts`

- [ ] Failing tests: the headword is replaced by a blank in a collocation, an example, and a note; every inflected form is caught, not just the exact one; text with no locatable form returns `null` (clue withheld) rather than leaking.
- [ ] Implement `maskHeadword(text, headword)` returning `string | null`.

## Task 3: Building a question

**Files:** modify `src/lib/guess.ts`, `src/lib/guess.test.ts`

- [ ] Failing tests: clues with no data are absent; masked clues that fail to mask are absent; 词性 and 首字母 are always present; prices match the table in the spec.
- [ ] Implement `CLUE_PRICES` and `buildGuessQuestion(word, note)`.

## Task 4: The session

**Files:** modify `src/lib/guess.ts`, `src/lib/guess.test.ts`

- [ ] Failing tests: only non-new words are drawn; harder words come up more often (deterministic `rng`); the session is capped at 10; a library with too few learned words yields what it can.
- [ ] Implement `generateGuessSession(words, progress, notes, count, rng)`.

## Task 5: Scoring

**Files:** modify `src/lib/guess.ts`, `src/lib/guess.test.ts`

- [ ] Failing tests: no clues → 10; one 词源 → 7; every clue bought still floors at 1 when solved; revealed → 0; the zero-clue count only counts solves.
- [ ] Implement `scoreWord(cluesUsed, outcome)` and a session tally.

## Task 6: The personal best

**Files:** modify `src/types.ts`, `src/lib/merge.ts`, `src/lib/merge.test.ts`

- [ ] Failing test: merging two progress records keeps the higher `bestGuess`; an absent field on either side is not treated as zero.
- [ ] Add the optional field and the merge rule, mirroring `bestSprint`.

## Task 7: The page

**Files:** create `src/pages/Guess.tsx`, `src/pages/Guess.css`

- [ ] Prompt, input (`autocapitalize`/`autocorrect`/`spellcheck` off), clue shop with prices printed on the buttons, reveal, per-word result, session settlement calling `recordQuiz`.
- [ ] Correctness carries a text tag, never colour alone.
- [ ] The Enter shortcut is printed on the submit control.

## Task 8: Wiring

**Files:** modify `src/components/Icon.tsx`, `src/components/TabBar.tsx`, `src/App.tsx`

- [ ] A `guess` icon in `PATHS` (1.5px strokes, 24 grid).
- [ ] Sixth tab; route inside `RequireAuth`.

## Task 9: Verify

- [ ] `npm test`, `npx oxlint .`, `npm run build`
- [ ] Browser at 375px: six tabs fit; a full session plays; a word missing etymology/note shows fewer buttons; no horizontal overflow.
