# 发散: one Chinese concept, produce every English word in its family

**Date:** 2026-09-18
**Status:** approved

## Problem

Every Chinese-to-English surface in the app asks for **one** word. 回想 shows a
scenario and you tap the word. 组句 shows a frame and you supply the word.
Both are one prompt, one answer.

The user's framing: "主要是给中文 想出尽可能多的英文 …… 就是单纯的单词", then,
one turn later, the part that changed the mode's nature: "比如形容词和名词 甚至
说是完全反义那种 加了个UN IN prefix那种 反正就是要锻炼思维脑回路".

So this is not a synonym-list drill. It is: **given one point in Chinese,
hand back everything English that sits around it** — the near-synonyms, the
opposite, the other part of speech, the negated form. Four different mental
paths out of the same starting point.

Nothing in the app measures that. A word can sit at ease 2.6 on a 20-day
interval, be recognised every time, and still never surface when you need it —
`ProgressEntry.recall` exists because recognition and production come apart.
This mode pushes on the same axis one level harder: not "can you retrieve the
word" but "can you retrieve *all* of them, and can you walk from one to its
neighbours".

## Measurements

Everything below is over `data/words.json` at 931 words and the live
`progress.json` at 779 learned words (all in `review`), read 2026-09-18.

### The input method: typing, and nothing else works

The user's first question was whether the options are shown. They are not —
the answer is a **set** of 3–12 words, and putting a set on screen as options
is printing the answer sheet.

The alternative to typing was prefix input: type the first few letters, and
if they uniquely identify a member, count it. Measured over the 751 member
slots in the raw synonym buckets, **the minimum prefix that is unique inside
its own bucket**:

| prefix length | 1 | 2 | 3 | 4 | 5+ |
|---|---|---|---|---|---|
| members | 481 | 118 | 56 | 32 | 64 |
| cumulative | **64%** | 80% | 87% | 91% | 100% |

**64% of answers are pinned by their first letter alone.** Prefix input is
guessing through the alphabet. So: full-word typing, which the app already
does in the 拼写 and 听写 question types.

### Typo tolerance is provably safe here

The user's second question: "我拼不对怎么办 比如差一点". The risk of forgiving a
typo is crediting the wrong word. Measured:

| | count |
|---|---|
| library headword pairs at edit distance 1 (of 432,915 pairs) | **14** |
| pairs at edit distance 1 **inside one answer set** (215 buckets) | **0** |
| pairs at edit distance 2 inside one answer set | 6 |

Of those 6, four are same-root morphology (`autocracy`/`autocrat`,
`imminence`/`imminent`, `reproof`/`reprove`, `machinate`/`machination`). The
three genuinely distinct near-pairs anywhere in the data are
`affable`/`amiable`, `empathetic`/`sympathetic`, `preeminent`/`prominent`, all
at distance 2.

**Edit distance 1 therefore cannot collide inside an answer set — measured, not
assumed.** It is forgiven.

The 14 library-wide distance-1 pairs (`swindle`/`dwindle`,
`disparate`/`disparage`, `inert`/`inept`, `gratify`/`ratify`,
`receptive`/`deceptive`, `condign`/`consign`, `imprudence`/`impudence`,
`entreat`/`entreaty`, `mire`/`mime`, and five inflection pairs) are disposed
of by one rule rather than a list: **what you typed is never treated as a typo
of something else if it is itself a library headword.** Answer is `dwindle`,
you type `swindle` — that is not a slip, that is the wrong word.

### Chinese glosses cannot supply the prompts

The obvious shortcut is to key concepts on `meanings[].zh` directly: split
each gloss on punctuation and group words that share a fragment. Over the 779
learned words that yields 2,072 distinct fragments, of which **only 33 are
shared by 3 or more words** (费力的 4, 易怒的 4, 诡计 4, 渗透 3, 安抚 3 …).

The output is clean but 33 questions is not a mode. Glosses are free text and
two authors writing the same sense will not write the same string. **The
Chinese prompt is authored.**

### The four axes have enough to ask

Seeded from the auto-merged clusters (see "Clusters are authored, not merged"
below), counting only learned members:

| axis | questions available today | note |
|---|---|---|
| 近义 | **86** (≥3 answers), 26 with ≥4, 17 with ≥5 | largest has 12 |
| 反面 | **24** (≥3 answers), 37 with ≥2 | largest has 13 |
| 换词性 | **43** | see "换词性 answers are not all library words" |
| 加否定 | authoring-bound | see below |

Underlying stock: 363 library-internal antonym pairs, 224 with both sides
learned, covering 392 words; 740 words carry `relatedForms` (1,157 forms, 256
of them library words in their own right).

> **Stale number found in passing.** `EMPTY_HINT.antonym` in `Quiz.tsx` says
> "only 106 of 566 words have a library-internal opposite". Re-measured at 931
> words it is **392**. Fix the string when touching that file.

### The negation axis cannot be derived, and here is the proof

Only **14** prefix/base pairs have both sides in the library (`infallible`/
`fallible`, `imprudence`/`prudence`, `irresolute`/`resolute`,
`unpretentious`/`pretentious`, …). So the axis cannot run off library
membership.

Nor can it run off spelling. A heuristic of "starts with un/in/im/ir/il/dis/
a/mis and is long enough" was run over the learned words; in one 15-word
sample it produced **7 false positives**: `understated` and `underhand` (that
is `under-`, not `un-`), `irritation` (not `ir-` + `ritation`),
`disputatious`, `annoyance`, `acrimonious`, `argumentative`. Close to half the
output was garbage.

The library already contains the semantic traps too: `ingenious` is not
"not genious", `impassioned` takes an intensive `im-`, and outside the library
sit `invaluable` and `inflammable`. This is the same call
`Word.etymology` makes — a derived negation that is 90% right plants a false
rule with full confidence. **The negation table is hand-written.**

And that is the axis worth drilling most: `im-` before p/b/m, `ir-` before r,
`il-` before l, `in-` otherwise, minus the exceptions. It is exactly the
"give it rules it cannot infer, precomputed" pattern in CLAUDE.md.

## Decision

### Clusters are authored anchors, members are derived

Three candidate cluster algorithms were measured:

| | ≥3 learned members | problem |
|---|---|---|
| greedy merge of overlapping buckets | 86 | **order-dependent**, not a function of the data |
| shared ≥2 synonym keys, connected components | 40 | deterministic, but discards half |
| raw synonym bucket, one English key each | 128 | 固执 splits into three near-duplicate questions (`stubborn` 9, `unyielding` 8, `obstinate` 6) |

None is the runtime algorithm. The shipped shape is:

```jsonc
{
  "id": "stubborn",
  "zh": "固执、不肯改变主意",
  "anchors": ["stubborn", "unyielding", "obstinate"],
  "exclude": ["tenacious"],        // 顽强 is a compliment; this concept is not
  "negations": ["intractable", "intransigent", "uncompromising"]
}
```

Members = ⋃ buckets(`anchors`) ∩ learned − `exclude`. The greedy merge is
demoted to an **authoring aid** — it proposes the ~86 concepts a person then
names, anchors, and prunes. It never runs in the app.

This follows CLAUDE.md's "store indices into content, not copies of it". The
payoff is the answer to "后面新学的词如何加入": a new word whose `synonyms`
mention `stubborn` joins the 固执 concept the moment it is added, with no
re-authoring. Three of four axes inherit that for free:

| axis | how a new word joins |
|---|---|
| 近义 | automatic, via `synonyms` |
| 反面 | automatic, via `antonyms` |
| 换词性 | automatic, via `relatedForms` |
| 加否定 | **hand top-up** — add the id to a concept's `negations` |

The one manual step belongs on the `word-content` skill's new-word checklist,
which already exists to carry exactly this kind of obligation.

### The denominator moves, and that is a feature

Because membership is `∩ learned`, an answer set grows as the library is
learned. Measured: finishing the 152 words already in the library and learning
no new ones takes the mode from 86 questions to **118**, and ≥4-answer
questions from 26 to **44** — 26 existing questions get fatter and 33 new ones
appear.

Three consequences, all load-bearing:

1. **No absolute best score is stored.** "8/8" is false the moment the
   concept reaches 9 members. Store hit rate and the most ever produced.
2. **Growth is announced.** Entering a concept whose learned membership grew
   since last time shows 「这题比上次多了 2 个词」. The alternative is a silent
   denominator change, which reads as a bug.
3. **Sets also shrink** — the user deletes words in the app, and those
   deletions only land in `volcab-data`. Reading a member id must tolerate it
   not existing, and a concept whose learned membership drops below 3 simply
   stops being asked. The question pool is live, not a fixed 86.

### Four axes, mixed within a round, each labelled

One round is 8 questions drawn across all four axes, each carrying a label
naming what it asks. The switching **is** the exercise the user asked for —
eight 近义 questions in a row trains one path. A label is mandatory: without
it you cannot tell which direction is being asked.

The axes share one authored Chinese prompt:

| axis | prompt | answer set |
|---|---|---|
| 近义 | 固执、不肯改变主意 | members |
| 反面 | 固执的反面 | ⋃ members' library `antonyms` ∩ learned, − members |
| 换词性 | 固执（名词） | (members ∪ their `relatedForms`) filtered to that POS |
| 加否定 | 固执（要带否定前缀的） | `negations` ∩ learned |

Writing 86 Chinese prompts yields 86 + 24 + 43 + N questions. The authoring
cost scales with one axis; the question count scales with four.

For 换词性 the POS is chosen at runtime: the non-dominant POS in the family
with ≥3 answers, never `adv.`. Labels come from `meanings[0].pos` for members
and `relatedForms[].pos` for forms; across the library that vocabulary is only
`adj.` (473), `n.` (234), `v.` (202), `adv.` (19), `prep.` (3) — a five-entry
Chinese label map covers it.

An axis is asked only when it has **≥3 answers** at draw time. Fail closed: a
发散 question with two answers is not a 发散 question. An answer counts as
available when it is a learned library word, or a `relatedForm` whose base
word is learned — a form is only fair to ask for if you have met the word it
hangs off.

### 换词性 answers are not all library words

This axis was first specified with its answers restricted to library words,
like the other three. Re-measured against that exact rule it produced
**one question in the whole library**, against the 33 an earlier and looser
count had suggested.

The cause: **only 256 of the 1,157 `relatedForms` entries are library words in
their own right.** The restriction discarded 78% of the axis's material, and
what remained could not clear the threshold, because a synonym cluster is
part-of-speech homogeneous by construction — synonyms of an adjective are
adjectives — so the family never grows past the cluster without the related
forms.

So this axis grades against `relatedForms` entries directly, library entry or
not. That is defensible content: each carries an authored `form`, `pos` and
`zh`, it is already rendered on the word detail page for the stated purpose of
remembering the family, and it went through the same write-side gate every
other authored field did.

Measured under the corrected rule: **43 questions** with ≥3 answers, 71 with
≥2. Examples — 奢华 (n. dominant) asks adj. and wants extravagant, grandiose,
lavish, ostentatious, prodigal, profuse, sumptuous; 淡然 asks n. and wants
complacency, insouciance, nonchalance.

**Adverbs are never the asked part of speech.** Producing `imperiously` from
`imperious` is a suffix, not a retrieval, and the mode is about retrieval. It
costs 3 of the 46 qualifying clusters. The asked POS across the remaining 43
is n. 28, adj. 12, v. 6.

### 加否定's answers are library words

`negations` lists **library word ids**, not free-form negated forms. A learner
typing `injudicious` when that word is not in the library gets the neutral
"not in your library" response, the same as any other axis. This keeps one
grading rule across all four axes and keeps every answer gradeable. The
hand-written part is the annotation of *which library words are this concept's
negated form* — which is the part that cannot be derived, and the whole of it.

### Grading: six rules

1. Exact match → hit.
2. **Edit distance 1 → hit**, tagged 「拼写差一点」 with the correct spelling
   shown. The tag is text, not only colour — quiz options already carry a text
   tag for exactly this reason.
3. **What you typed is itself a library headword → never a typo.** It is
   judged on its own: in the set it is a hit, outside it a neutral 「这是库里的
   另一个词」.
4. **Inflections count.** `obstinate` → `obstinately`, `condemn` →
   `condemned`, via `headword.ts` **used as-is**. Not loosened: CLAUDE.md
   records that loosening the suffix list makes the `mire` stem match
   *mirth*.
5. **A wrong negation prefix is never a typo.** `inprudent` → `imprudent` is
   edit distance 1 and rule 2 would swallow it — and that is the only thing
   the 加否定 axis tests. Rule 5 overrides rule 2 whenever the expected answer
   carries a negation prefix, on any axis. Without this carve-out, rule 2
   silently deletes axis four.
6. A correct English word that is in neither the answer set nor the library →
   neutral, neither hit nor miss. Marking it wrong makes the app look stupid;
   counting it makes the denominator meaningless.

Rule 3 before rule 2, rule 5 before rule 2. The order is part of the contract.

"In the answer set" is what decides a hit, and on 换词性 the answer set is not
a subset of the library (above). Library membership only ever drives rules 3
and 6 — never the hit test itself.

### Session flow

```
〔近义〕
  固执、不肯改变主意
  已答出 3 / 8
  [____________]   提示   我答完了
```

- Filling the set advances automatically.
- 提示 is a ladder: first tap gives the remaining count and their first
  letters; second gives more letters. Hinted words are counted separately —
  they are not the same evidence as an unhinted retrieval.
- 我答完了 is always available and reveals the rest.

### Scoring: reward only, with a manual knife

A produced word writes a production success to `ProgressEntry.recall`. **An
unproduced word writes nothing by default.** The reasons for a miss are not
distinguishable by machine — genuinely absent, momentarily absent, recognised
instantly on reveal, or a word you had no interest in — and a 7-answer
question that banked 3 misses would flood the lapse queue within two rounds.

Instead the summary screen puts 「这个我真不会」 beside each unproduced word,
and only what the user taps enters the lapse queue. This is the same design as
`ProgressEntry.recallRating`: both automatic signals are after the fact, the
user knows on sight, and until the field existed the app had no way to hear
it.

**Nothing here reaches `srs.ts`.** Not `ease`, not `intervalDays`, not `due`,
not `state`. The one door practice has into the schedule is a quiz miss
halving `intervalDays` under three guards, and this mode does not use it.

### Not a merge of the existing 反义 mode

`/quiz?mode=antonym` is four-choice recognition — "given a word, pick its
opposite". The 反面 axis here is production — "given a concept, produce every
opposite you can". Recognising an opposite and retrieving one come apart the
same way recognition and production do everywhere else in this app. They stay
separate surfaces, and this paragraph exists so that is not re-litigated.

## Files

| file | role |
|---|---|
| `src/data/concepts.json` | authored: Chinese prompts, anchors, exclusions, negation table |
| `src/lib/diverge.ts` | pure: cluster resolution, per-axis answer sets, input grading |
| `src/lib/diverge.test.ts` | colocated tests |
| `scripts/validate-concepts.ts` | ninth content gate, joins `npm run validate` |
| `src/pages/QuizDiverge.tsx` | the surface; thin, per the no-component-tests rule |
| `src/pages/Quiz.tsx` | ninth `MODES` entry, `?mode=diverge` |
| `src/types.ts` | new **optional** `ProgressEntry` fields |

`concepts.json` ships in the bundle like `passages.json` and
`senseGroups.json` — it is read-only content the user never edits, so it stays
out of the sync schema, and it loads through `useLazyContent` so the everyday
modes do not download it.

### What the validator gates

- every `anchors` key appears as a synonym on ≥2 library words
- every `exclude` and `negations` id exists in `data/words.json`
- `zh` carries no Latin letter (it is on screen before any answer — one letter
  is a leak, the same rule `SenseGroup.zh` already has)
- each concept reaches ≥3 members at **full-library** scope
- no two concepts resolve to the same member set (near-duplicate prompts are
  the specific failure the anchor design exists to prevent)
- every `negations` entry actually carries a negation prefix relative to a
  base — checked by hand at authoring time, asserted here as a spelling check
  so a typo cannot slip in

Write side strict, read side lenient: the runtime skips a concept it cannot
resolve rather than throwing.

## Rollout

Axis order is 近义 → 反面 → 换词性 → 加否定. The first three have their data
today. 加否定 is last because it is the only one blocked on a hand-authored
table, and the mode is useful without it.

## Open

Nothing blocking. The Chinese prompts are an authoring batch on the pattern
this repo already runs (`recallSentences.json`, `passages.json`), and per
CLAUDE.md the Chinese half is written by hand, not delegated.
