# 回想 expansion — translated examples, and a proficiency of its own

**What is being built**: a second source of 唤词 questions, drawn from
Chinese renderings of example sentences the library already carries, plus a
per-word recall proficiency that is tracked separately from the SRS.

Measured 2026-08-16 against the live library (566 words) and the live
`progress.json` (454 learned words).

---

## The problem, measured

回想 is the mode the user reports practising most and being weakest at. It
is also the mode with the thinnest content, and the two facts are related:
you cannot get better at something the app can only ask you once.

| | |
|---|---|
| learned words | 454 |
| **learned words 回想 can ask at all** | **307 (68%)** |
| learned words it can never ask | **147** |
| askable words with exactly 1 question | 290 |
| askable words with 2 | 17 |

A third of what the user has learned is unreachable in 回想, and for
everything else there is one sentence. Once seen, that word's recall
question is spent.

The cause is structural rather than an authoring backlog. A sense group is
a *ranking* unit: the answer needs same-POS confusable partners to be
ranked against, or hand-written outside distractors. Words with no
confusable twin — 198 of the library by the count in
`wordNotes.ts` — cannot host one cheaply. `senseGroups.json` reaching 371
groups did not fix this and would not at 700.

## Why translated examples rather than more sense groups

Two routes were costed.

**Route A, keep authoring sense groups**: 146 groups to give every learned
word one question (132 have a same-POS partner, 14 would need invented
distractors), and **~991** to reach three questions each. Each unit needs a
scenario, a target, a defensible ranking, a why, and distractors — and the
skill's own rule is to throw the whole group away when second place is not
defensible.

**Route B, translate the examples already written**: every word carries
exactly **5** examples, **2830** library-wide, already gated by
`validate-words` for locating the headword, being 12–30 words, and having
five distinct scenes. The authoring unit is one Chinese rendering plus one
marked chunk — no ranking judgment, no distractor design.

Route B wins on coverage per unit of work, but the stronger argument is
that it splits 回想's two halves cleanly:

- **排序 tests discrimination** — several members fit, which is best? Sense
  groups are the right unit and stay exactly as they are.
- **唤词 tests retrieval** — a situation is on screen, produce the word.
  This is the half the user is weak at, and a translated example is a
  better prompt for it than a ranking scenario.

## Where the content lives, and why not in `words.json`

**Not** as `examplesZh` on the word entry. Measured: `words.json` is
**897 KB** today, and 2830 Chinese renderings add **221–387 KB** of UTF-8,
landing the file at **1118–1284 KB**. The GitHub Contents API only returns
file content inline below **1024 KB**, and `sync.ts` reads the library that
way. Crossing that line does not degrade 回想 — it takes the whole app
down, because the library stops loading at all.

This is the concrete form of `CLAUDE.md`'s "do not add bulk to it", and it
is not a near miss: even the low estimate overshoots by ~94 KB.

So the renderings go in **`src/data/recallSentences.json`**, bundled with
the app exactly like `passages.json` and `senseGroups.json`. It is
read-only content the user never edits, so it does not belong in the sync
schema, and its types live in `src/lib/recallSentence.ts`, not
`src/types.ts` — the same split `passage.ts` documents.

## The authored unit

```json
{ "id": "extricate", "i": 0,
  "zh": "两个律师、八个月，才把她从一个下午就签下的合同里解脱出来。",
  "target": "解脱出来" }
```

`i` indexes into that word's `examples`. **No `en` field**: the English is
already `words[id].examples[i]`, and a second copy would drift.

`target` carries over unchanged from `SenseGroup`, including its reasoning:
without a marked chunk the question is unanswerable, because a sentence
holds half a dozen content words and nothing says which one is wanted —
user-reported on the day 回想 shipped. It is the answer word's Chinese
rendering, not the clause around it.

### Gate: `scripts/validate-recall-sentences.ts`

Strict on write, lenient on read, like the other five.

- `id` exists in `data/words.json`; `i` is a valid index into its examples
- `(id, i)` unique
- `zh` non-empty, contains Chinese, **contains no Latin letter at all** —
  the prompt is on screen before the options, so a single English fragment
  is the answer arriving early. Same rule, same reason, as `senseGroups`.
- `target` non-empty, no Latin, ≤16 chars, appears in `zh` **exactly once**
- reports coverage: words with ≥1 rendering, and the long-target tail

## The question

`kind: 'recall'`, the existing 唤词 shape: prompt on screen, four options,
tap one.

**Distractors are same-POS words that are deliberately _not_ confusable
with the answer** — the exact inverse of the sense-group rule, and the one
decision in this spec most likely to look like a mistake later.

A sense group *wants* its confusable members as the wrong options: mistaking
`pervade` for `suffuse` is the finding worth having. That works because the
scenario was authored to make one member clearly best. A translated example
was not — it was written to show the word in use. Offering its confusable
twin as a distractor there produces "either one fits", and unlike 排序
there is no ranking to absorb a near-miss: a defensible answer is simply
marked wrong.

So retrieval questions take unambiguous distractors and discrimination
stays with 排序, which is built for it. The result is an easier question
than a sense group, on purpose.

## Recall proficiency

New **optional** field on `ProgressEntry`:

```ts
recall?: { reps: number; correct: number; streak: number; lastAt: string }
```

Optional because another device on an older build will push entries without
it — the rule `Meaning.share` and `settings.updatedAt` already follow.

**It never touches the scheduler.** Not `state`, not `ease`, not
`intervalDays`, not `due`, not `lapses`, not `lastReviewedAt`. `CLAUDE.md`
is explicit that practice surfaces reach `srs.ts` through exactly one door
— a quiz miss halving `intervalDays` under three guards — and this does not
go through that door at all. It is a second, parallel axis, and that is the
whole point of it: a word can sit at `ease` 2.6 with a 20-day interval,
perfectly recognised, and still be unproducible from Chinese. Today nothing
in the app can see that. This makes it visible.

Uses, both read-only against the SRS:

1. **Ordering** — 回想 deals weakest first (low streak, low accuracy), then
   least recently recalled, so practice lands where retrieval is failing
   rather than where the review queue happens to point.
2. **Display** — a level on the word detail page.

`mergeProgress` reconciles two devices by keeping the entry with the later
`lastAt`, matching how the file already resolves `bestSprint`/`bestGuess`
by picking a winner rather than summing.

## Staging

1. Content and question generation. This alone moves **146 learned words
   from 0 questions to 5**, which is the coverage hole closed.
2. Proficiency. It is only meaningful once a word can be asked more than
   once, so it follows rather than leads.

Full-library expansion (the remaining ~2100 sentences) is deliberately not
in this spec: the first batch is the test of whether the question type
feels right, and finding out at 730 costs less than finding out at 2830.
