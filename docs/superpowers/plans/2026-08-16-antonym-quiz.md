# Plan — `antonymPick`

Spec: `docs/superpowers/specs/2026-08-16-antonym-quiz-design.md`.
Tests first on every task that has logic.

## 1. `src/lib/antonym.ts` — the pair index

New file, no dependency on `quiz.ts` (which will import it).

- `buildAntonymPairs(words)` → `{ a, b }[]`, ids sorted, deduped. A pair
  exists when either side's `antonyms` names the other's headword,
  normalised the way `contrast.ts` normalises (`trim().toLowerCase()`).
- `antonymIndex(words)` → `Map<id, Set<id>>`, symmetric, so the generator
  can ask "every library antonym of the prompt word" in O(1). This is the
  set rule 1 excludes, and it is not the same as "the answer".

Tests: one-sided authoring still yields a pair; a word naming itself is
impossible (`validate-words` forbids it) but an unknown headword is simply
skipped; the index is symmetric; empty and whitespace antonym strings never
produce a pair (the `contrast.ts` empty-string bug, one file over).

## 2. `QuizType` and the question shape

- `QuizType` += `'antonymPick'`; `QUIZ_TYPES` += the same.
- `QuizQuestion.antonymId?: string`, documented as the answer word's id.
- `TYPE_LABEL` in `QuizQuestion.tsx` must gain a member or the build fails
  — it is a `Record<QuizType, string>`, which is the point.

## 3. The generator branch in `quiz.ts`

Inside `generateQuiz`'s candidate loop, before the generic option types:

```
if (type === 'antonymPick') {
  const opposites = [...(antonyms.get(w.id) ?? [])] present in the pool-or-library
  if none → continue
  pick one as the answer (rng)
  distractors: same POS as the answer, excluding
    – w itself and every id in antonyms.get(w.id)
    – every confusable partner of the answer (contrast index)
  if fewer than 3 → continue
  push { type, wordId: w.id, prompt: w.headword, options: shuffle([answer, ...3]),
         answer: answerWord.headword, antonymId: answerWord.id }
}
```

Two indices are built once outside the loop, beside `sharedSynonymsCache`,
for the same O(n²) reason its comment gives: the antonym index and a
`Map<id, Set<id>>` of confusable partners from `buildContrastPairs`.

POS is `meanings[0].pos`, matching how `validate-sense-groups.ts` decides
"members must compete in the same slot".

Distractors come from the pool first, then the whole library — the
`pickDistractorLabels` fallback order — because a word the learner has not
met is still a legitimate wrong option.

## 4. Tests in `quiz.test.ts`

- no distractor is an antonym of the prompt word
- no distractor is a confusable partner of the answer
- all four options share `meanings[0].pos`
- both directions of a pair are reachable across seeds
- same seed → same question
- full-library: all 138 directions build; failures reported by name

## 5. Render in `QuizQuestion.tsx`

- `TYPE_LABEL.antonymPick = '选出意思相反的词'`
- `promptLang` includes it (the prompt is an English headword)
- prompt uses the `word quiz-q__prompt` serif, same as `word2meaning` — one
  headword, sole protagonist
- reveal: `AntonymCard`, reusing `ContrastSide`. Prompt word first untagged,
  answer second tagged 本题答案. Label 这对反义词, no note row.

## 6. Gates

`npm test && npx tsc -b --noEmit && npm run build && npx oxlint`, then drive
the dev server via the preview tooling: reach a real `antonymPick` question
at 375px, answer it wrong on purpose, and read the reveal card.

## Commits

1. `src/lib/antonym.ts` + its tests
2. generator + `quiz.test.ts`
3. render layer
4. spec and plan land with commit 1
