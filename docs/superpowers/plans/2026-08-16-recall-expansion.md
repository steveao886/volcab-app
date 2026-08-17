# Plan — 回想 expansion

Spec: `docs/superpowers/specs/2026-08-16-recall-expansion-design.md`.
Tests first on everything in `src/lib/`.

## 1. `src/lib/recallSentence.ts` — types and the question builder

- `RecallSentence { id, i, zh, target }`, `RecallSentencesFile { version: 1; sentences: RecallSentence[] }`.
- `usableSentences(sentences, words, progress)` — the answer word must exist
  and be learned; the target must locate exactly once (read side stays
  lenient: an unlocatable target renders the plain sentence, it does not
  drop the question).
- `buildSentenceQuestion(s, words, pool, notConfusable, rng)` → the same
  `RecallQuestion` shape 唤词 already uses, or null.
  Distractors: same `meanings[0].pos` as the answer, **excluding** the
  answer's confusable partners from `buildContrastPairs`, four distinct
  options. Null rather than a mixed-POS fallback, as in `antonymPick`.

Tests: target located / not located; a confusable partner never appears as
a distractor; POS uniform; null when the pool is too thin; same seed same
question; full-file assertion that every authored sentence builds.

## 2. `scripts/validate-recall-sentences.ts`

Rules per the spec. Wire `validate-recall-sentences` into `package.json`
beside the other five. Reports coverage and the long-target tail; hard-fails
on a dangling id, a bad index, a duplicate `(id, i)`, Latin in `zh` or
`target`, and a target that does not locate exactly once.

## 3. Content — 730 renderings for 146 words

Fan out to 8 subagents (chunks already written to the scratchpad as
`gap-1..8.json`, each carrying the word's meanings and its five examples).
Central validation only; agents do not self-certify. Merge, sort by
`(id, i)`, run the validator.

## 4. Session wiring

`generateRecallSession` gains the second source. Sense groups keep 排序 and
their own 唤词; translated sentences add 唤词 only. Prefer the source the
word actually has; when both exist, alternate rather than always drawing
the sense group.

## 5. Proficiency

- `ProgressEntry.recall?` in `src/types.ts`, optional, plus `isProgressEntry`
  tolerance in `sync.ts` (read side lenient).
- `mergeProgress`: keep the side with the later `lastAt`; absent on both
  stays absent (`Object.hasOwn` assertion, as `bestGuess` has).
- Store settlement `recordRecall(results)` — writes only the `recall` field.
  A test must assert it leaves every SRS field byte-identical.
- Ordering: weakest first inside `generateRecallSession`.
- Display: a level on the word detail page.

## 6. Gates

`npm test && npx tsc -b --noEmit && npm run build && npx oxlint`, all six
validators, then drive 回想 in the browser and confirm a translated-example
question renders with its target marked.

## Commits

1. spec + plan
2. lib + validator + tests
3. the 730 sentences
4. session wiring
5. proficiency
