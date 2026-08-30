# 组句 implementation plan

Spec: `docs/superpowers/specs/2026-08-30-sentence-compose-design.md`

Ordered so that every step is committable on its own and the content batch —
the one slow task — sits behind a validator that can reject it.

## 1. `src/lib/sentenceChunk.ts` + `sentenceChunk.test.ts`

All pure. No React, no `Math.random` in a function body — the draw takes an
injected `rng`.

- `ChunkAnnotation` / `SentenceChunksFile` types, `ComposeQuestion`.
- `resolveSentence(a, words, groups)` → tokens + chunk texts, or `null`.
  Returns `null` when: the word/group is gone, `i` is out of range, `cuts` are
  not strictly increasing or out of range, fewer than the floor's worth of
  chunks, or `tokens[blank]` fails the `answer` checksum. **Fail closed.**
- `usableChunks(annotations, words, groups, progress)` — the answer word must
  be learned, same rule as `usableSentences`.
- `pickDistractor(target, pool, rng)` — three rejection gates from the spec,
  `null` when none survives.
- `buildComposeQuestion(...)` → `ComposeQuestion | null`.
- `generateComposeSession(...)` — draws through `weightedShuffle` with
  `difficultyWeight × recallWeight × ratingWeight`, reusing the exports
  `senseGroup.ts` already has where possible.
- `gradeOrder(placed, reference)` → `'ok' | 'wrong'`.
- `gradeWord(input, word, answer)` → `'ok' | 'form' | 'wrong'`.
- `normalizeToken(s)` — lowercase, trim, strip surrounding punctuation, keep
  internal hyphens.

Tests cover each `null` path individually (a silent skip is exactly the bug
that hides), both grade functions including `form`, and a seeded rng for the
draw.

## 2. `scripts/validate-sentence-chunks.ts` + `npm run validate-chunks`

Write-side gate, strict where the runtime is lenient:

- every `id`/`i` resolves against `words.json` / `senseGroups.json`
- `cuts` strictly increasing, `0 < cuts[0]`, `last < tokens.length`
- chunk count ≥ 5 for `src: "ex"`, ≥ 4 for `src: "sg"`
- no chunk longer than 8 tokens (it stops reading as one unit)
- `blank` inside range, `tokens[blank]` normalises to `answer`
- `answer` is alphabetic + optional hyphen — no trailing comma or period
- `sg` annotations blank `order[0]`, never another member
- no duplicate `(src, id, i)`

## 3. Content batch → `src/data/sentenceChunks.json`

Helper `scripts/chunk-worksheet.ts` prints each candidate sentence with its
tokens numbered, so cut indices are read off rather than counted by hand.

Order: `sg` pool first (325, one per group, floor 4), then `ex` pool
(243, one per word, floor 5). Run the validator after each sub-batch.

## 4. Wiring

- `src/lib/quiz.ts` — `compose` into `QUIZ_METRIC_KEYS` and
  `QUIZ_METRIC_LABELS` (append-only; the comment there explains why).
- `src/pages/Quiz.tsx` — eighth `MODES` entry, lazy `import()` of the chunks
  file guarded on `mode === 'compose'`, an `EMPTY_HINT` of its own.
- `src/state/store.tsx` — `recordQuiz` already takes a mode key; confirm the
  demotion path can be told "word wrong only" rather than "question wrong".

## 5. `src/pages/QuizCompose.tsx` + `Quiz.css` additions

- Chinese prompt with `target` under an emphasis mark (reuse the 回想
  treatment).
- Chunk pool → tap to place, tap a placed chunk to take it back.
- Answer row: fixed slot count = reference chunk count, trailing period
  outside the slots.
- One 提交 button, enabled once every slot is filled and the word field is
  non-empty.
- Result: reference sentence, the two verdicts tagged in text (never colour
  alone), and the word's Chinese gloss.
- Keyboard shortcuts printed on the controls they trigger.
- 375px must not overflow.

## 6. `scripts/content-staleness.ts`

Printed 组句 coverage line. Not a STALE trigger.

## 7. Verify

`npm test`, `npm run build`, `npx oxlint`, both validators, then drive
`/quiz?mode=compose` in the browser preview at 375px: place chunks, take one
back, submit right, submit with a wrong order, submit with `abrogate` for
`abrogated` and confirm it reports `form`.
