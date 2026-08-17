# `antonymPick` — testing the opposite relation

**What is being built**: a seventh question type in the mixed quiz rotation.
Show one headword, ask for its opposite, four library headwords as options.

Measured against `data/words.json` at 566 words, 2026-08-16.

---

## Why this and not something else

The library's three word-to-word relations are covered very unevenly.

| relation | how it is asked today | size |
|---|---|---|
| near-synonym / confusable | 辨析 mode (`contrast`) and 排序 mode (`senseGroups`) | 414 pairs, 371 groups |
| opposite | `synonymHint`, one direction only | 500 reachable strings over 317 words |
| same root | **nothing** — `relatedForms` renders on the card and stops there | 32 pairs |

Synonymy is the backbone of two whole modes. Antonymy has one partial
surface: `synonymHint` pools `synonyms` and `antonyms` into one hint list
and tags the drawn hint with `hintKind`, so the UI can say whether to pick
the matching or the opposite word (`quiz.ts:388-399`). Measured over the
library: 500 of 1097 antonym strings survive the `sharedSynonyms`
exclusion, so an antonym hint is drawn roughly **27%** of the times that
question type fires, covering **317 of 566** words.

That leaves two holes. The direction is fixed — the prompt is always the
*hint* and the answer is always the *headword*, so "given this word, what
is its opposite" is never asked. And the **69 pairs where both sides are
library words** are never asked as a pair, which is the highest-value
subset: both words are ones the learner is actually studying, so a miss
teaches on both sides at once.

Same-root families are deliberately left alone; see "Not doing" below.

## The 69 pairs

Derived, not authored: word A's `antonyms` array names word B's headword.

- **69 pairs over 106 distinct words** (18.7% of the library)
- POS of those words: 43 adj., 38 v., 25 n.
- **17 pairs are mutual** (both entries name each other); 52 are one-sided
- **25 words carry more than one library antonym** — `antagonize`,
  `agreeable` and `apathetic` have four each

One-sidedness does not disqualify a pair. Antonymy is symmetric as a
relation even when the authoring is not, so all 69 are askable **in both
directions**: 138 distinct questions, not 69.

## The question

Prompt: the headword alone, in the serif face used for word2meaning — it
is the sole protagonist on the screen. Options: four library headwords.

**The prompt word's Chinese gloss is not shown.** Showing it turns the
question into a free review of the prompt word and tests only the relation;
withholding it tests the prompt word's meaning *and* the relation, which is
what the pair is worth.

On reveal, both words' meanings stack vertically — the same `ContrastSide`
component 辨析 mode already uses, since 375px cannot hold two columns. The
prompt word renders first, untagged; the answer second, tagged 本题答案.

No authored note. 辨析 mode needs `contrastNotes` because near-synonyms
produce sentences where either word fits and only a human can say what
separates them. Opposites do not have that problem — two glosses side by
side is the whole explanation. Authoring 69 notes plus a sixth validator
would buy nothing.

## Distractor safety — the load-bearing part

A four-choice question with two correct answers makes the learner conclude
the quiz is broken. That is the exact failure `sharedSynonyms` exists to
prevent (`quiz.ts:161-170`, "228 of 1597 synonyms show up under more than
one entry"), and this question type has two fresh ways to hit it.

A distractor is rejected if it is:

1. **Any antonym of the prompt word**, not merely the one chosen as the
   answer. With 25 words carrying multiple library antonyms, drawing
   `antagonize`'s answer as `conciliate` and then offering one of its other
   three opposites as a distractor is not a rare edge case.
2. **A confusable partner of the answer word**, read straight off
   `buildContrastPairs`. If a distractor shares a synonym with the correct
   answer it is very likely an opposite of the prompt too, simply because
   nobody wrote it into the `antonyms` array. This is the same inference
   `contrast.ts` already makes in the other direction.
3. **A different part of speech from the answer.** Existing types do not
   filter on POS and do not need to; here, three verbs beside one adjective
   hand over the answer without the learner reading a word. Same-POS is
   preferred, and the question is **skipped rather than downgraded** if
   three same-POS distractors cannot be found — consistent with every other
   branch in `generateQuiz`, which `continue`s to the next candidate word
   whenever it cannot build cleanly.

## Where it plugs in

- `QuizType` gains `'antonymPick'`; `QUIZ_TYPES` goes from six to seven.
- `QuizQuestion` gains `antonymId?: string`, **the id of the answer word**,
  mirroring `contrastId`. Not merged with `contrastId` into one
  `partnerId`: that renames a field 辨析 mode already depends on, and buys
  one identifier.
- `QUIZ_METRIC_KEYS` is **not** touched. That array is append-only because
  each key is a surface's stats history; `antonymPick` is a question type
  inside 综合, not a new surface, so adding a key would create a bucket
  that is empty forever.
- `wordId` is the **prompt** word, not the answer. Every existing branch
  writes `wordId: w.id` where `w` is the candidate drawn from the
  difficulty-weighted pool; recording the answer word instead would
  decouple what the weighting chose from what the session records, and a
  miss would demote a word the scheduler never selected.

A miss therefore demotes the prompt word under the unchanged SRS contract:
`intervalDays` halved, at most once per word per day, `ease` / `lapses` /
`state` untouched, `due` never pushed away from now.

## Repetition, stated rather than discovered

106 eligible words is 18.7% of the library against a 1/7 ≈ 14.3% share of
the rotation, so the generator fills its slots — but only just. A 20-question
mixed quiz carries about 3 antonym questions, drawn from 138, so repeats
start showing up within a dozen sessions.

This is the ceiling of the data, not a defect in the design, and the only
way up is more library-internal words in `antonyms` arrays. Recording it
here so a future session reads "known and bounded" instead of rediscovering
it as a bug.

## Not doing: special scheduling for same-root families

The second half of the question that produced this spec was whether
`bewilder`/`bewildering`-style families need their own review rule. They do
not, and the live `progress.json` says so.

Of the 32 library-internal same-root pairs, 16 have both members in review.
**Three share a due date**; the rest have already pulled apart on their own
— `sycophant`/`sycophantic` sit at 17 and 5 days, `disparate`/`disparity`
at 20 and 14, `canonical`/`canonicalization` at 13 and 4. Per-word
`intervalDays` and `ease` desynchronise family members within a few
gradings without anyone asking them to.

`relatedForms` stays display-only. The one place a rule could still bite is
the *fresh* queue, which sorts new words by `usageScore` descending and so
introduces family members adjacently — this batch alone added
`bewilder`/`bewildering`, `alienate`/`alienation` and four members of the
`pretentious` family. Whether learning a family together is efficient or
merely feels easy is a judgment only the learner can make, and nothing in
the data forces the question.

## Testing

Logic lives in `src/lib/`, so tests are colocated and the render layer gets
none (`CLAUDE.md`). `rng` is injected.

- `src/lib/antonym.ts` + `antonym.test.ts` — pair index, both directions,
  and the per-question exclusion set.
- `quiz.test.ts` — a generated question never offers two valid answers
  (no distractor is an antonym of the prompt, none is a confusable partner
  of the answer), all four options share a POS, both directions are
  reachable, and the same seed reproduces the same question.
- One full-library assertion, in the spirit of `headword.test.ts`: every
  one of the 138 directions can build a complete question. A direction that
  cannot must be reported by name — if this ever fails, the fix is to look
  at why the distractor pool ran dry, not to relax the exclusions.
