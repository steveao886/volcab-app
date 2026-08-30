# 组句: assembling a sentence from meaning chunks, with the word withheld

**Date:** 2026-08-30
**Status:** approved

## Problem

回想 owns the Chinese-to-English direction and stops at the word. You see a
Chinese scenario, retrieve one English word, and tap it. What the app has
never asked is the next thing up: **can you put that word into a sentence** —
the collocation it takes, the form it takes, the frame it sits in.

The user's framing: "中文想英文这条路 …… 但这次主要是比如整句的造句 …… 我感觉
这种练习是可以加深印象的".

Three input forms were on the table — full typing, half typing, Duolingo-style
word ordering. Two measurements decided between them before any of them could
be designed.

### Measurement 1: the library's sentences are long

Over the 1215 sentences that already have a Chinese rendering:

| | EN tokens |
|---|---|
| min | 9 |
| p25 | 17 |
| **median** | **19** |
| p90 | 22 |
| max | 28 |
| ≤12 tokens | **5 of 1215** |

Duolingo's word bank runs at 4–8 tokens. **A 19-token word bank does not fit
375px**, which is the design width, and typing 19 words on a phone is the
friction that killed 猜词 (retired 2026-08-17, see `quiz.ts` — "removed
because it went unused next to 回想").

So neither word-level ordering nor full typing survives contact with the
content that exists. The length that kills both is, however, exactly right for
**ordering at the meaning-chunk level**: 19 tokens cut into 5 chunks is ~4
tokens a chunk, one or two chunks to a row at 375px.

### Measurement 2: chunking cannot be derived

A splitter that cuts only at high-confidence boundaries — commas, dashes,
semicolons, and the coordinators/subordinators (`and but or so yet because
once while before after until when unless though although since that which
who whose if`), deliberately **not** at bare prepositions — run over all 1215
sentences:

| chunks produced | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| sentences | 159 | 627 | 338 | 79 | 12 |

**1.0% land in 5–6 chunks.** Block length comes out at median 8 tokens, p90
13, max 25 — a 13-token block is half a sentence and does not fit the screen,
let alone read as one meaning unit.

The reason is structural: these are 2–3 clauses of ~8 tokens each, not 5–6
meaning units. Reaching 5 chunks requires cutting *inside* a clause, at the
NP/VP/PP level, and that is precisely where a heuristic starts emitting
`over a` / `single Slack message`. Loosening the rule to reach 5 chunks is the
90%-correct derivation CLAUDE.md forbids.

**Chunk boundaries are therefore authored, not computed.** That is the same
call `Word.etymology` and `Meaning.speakAs` already make, and the same content
rhythm `recallSentences.json` already runs on (commit `6ca9d5b` authored 730
renderings in one batch).

## Decision

An eighth `/quiz` mode, `?mode=compose`, label **组句**.

The label is not 造句. You are not producing a sentence freely; you are
assembling given meaning units and supplying one word. The hub card has to say
what the mode is, or the first tap is a disappointment.

### One question

```
中文提示（recallSentences 的 zh，target 标着重号）

块池   [ the new ceo ]  [ and half the team started job-hunting that week ]
       [ over a single slack message ]  [ within a month ]  ← 干扰块
       [ ______ the remote-work policy ]

答题区  5 个空位

目标词  [            ]
```

Order the chunks, then type the missing word. **One submit, no retry.** Before
submitting you may take chunks back out and rearrange freely; after submitting
the question is settled.

That single-submit rule is the sharpest divergence from Duolingo, which grades
the moment the row is full and therefore permits unlimited trial and error.

### The blank is what makes this a vocabulary mode

**Pure chunk ordering does not test the word at all.** You can order five
meaning units without recognising a single one of them: English word order is
rigid, so five chunks usually admit one or two grammatical arrangements, and
two positions are given away for free by the initial capital and the final
period. The distractor does not help either — it is rejected by reading the
Chinese prompt, which tests comprehension, not production.

That is a *structure* mode, and it would leave the target word lying in a
chunk, never passing through the learner's head. Since the whole premise is
"中文想英文，加深印象", the word has to be withheld, and withholding it leaves
exactly two mechanisms: type it, or offer options. Options are 回想's
territory, and its design doc rules them out for production anyway — four
visible choices turn production back into recognition. So: **type it**.

Typing is bounded to **one word**. The chunk is shown as
`______ the remote-work policy`, not withheld whole. Withholding the whole
chunk would ask for `abrogated the remote-work policy` and mark
`abolished the remote-work policy` wrong — the "either one fits, and a
defensible answer is simply marked wrong" trap `recallSentence.ts` documents
for confusable distractors. One word has one right answer.

This is also a different friction profile from 猜词. 猜词 asked you to
reconstruct a word from a bare Chinese gloss, with a clue shop beside it; the
cost was in the "from nothing". Here the full Chinese sentence is on screen,
the syntactic slot is already built by your own ordering, and you type a word
you have just finished thinking of.

### Two verdict axes, not one

| axis | values |
|---|---|
| order | `ok` / `wrong` |
| word | `ok` / **`form`** / `wrong` |

`form` is "right word, wrong inflection" — `abrogate` typed where `abrogated`
was wanted. Detecting it needs no stemmer: normalise the input; if it equals
the `headword` or some `relatedForms[].form` but not the stored answer, it is
`form`.

Three values rather than two because the three failures ask for different
remedies, the same reasoning as 回想's four miss kinds: `form` means the word
*is* in productive vocabulary and grammar is what slipped, while `wrong` is
the finding this mode exists to produce.

### The SRS door

CLAUDE.md opens exactly one door from practice into the scheduler: a quiz miss
halves `intervalDays`, under three guards (review-phase words only, at most
once per word per day via `demotedOn`, `due` only ever moves toward now).

**Only `word === 'wrong'` walks through it.** Not `form`, and not a wrong
order.

A wrong order is a syntax slip and says nothing about whether the word is
remembered. Feeding it to `demoteWord` would push a word-independent signal
into that word's interval — the same family as the drift `71fba29` removed,
where something that did not mean "this word is hard" was moving this word's
schedule.

`RecallStat` is **not** written. Its doc comment defines it as the 回想 record,
and `recallWeight` and `recallRating` both read it under that meaning; a
second mode writing into it would make `generateRecallSession`'s draw reflect
a mode it does not know about. `RecallRating`'s own comment states the rule —
a rating collected in one direction must not be silently spent in the other.
组句 history goes to `DailyStat.quizModes` under a new append-only key
`compose`.

### Difficulty is a runtime weight, never a content allocation

The user asked for "普通词1个，难词3题". The app already knows which words are
hard, on three axes that all multiply into the one `weightedShuffle`:

| multiplier | where | measures |
|---|---|---|
| `difficultyWeight` | `quiz.ts` | recognition, from the scheduler's own numbers |
| `recallWeight` | `senseGroup.ts` | production, from `RecallStat` — 2.5 on a live miss streak, 0.5 after three straight |
| `ratingWeight` | `senseGroup.ts` | the manual 要多考 / 太简单 — 6 and 0.05 |

组句 draws through the same three. Nothing new is invented, and
`senseGroup.ts`'s rule holds: **a weight, never a filter** — heavy items tend
toward the front, light ones are never excluded.

**The allocation cannot live in the content.** Difficulty sits in
`progress.json`: synced, and different every day. Chunk annotations are
bundled content: authored once and shipped inside the app. At authoring time
nobody knows which word is hard for this learner, and a word that is hard
today is not in three weeks.

What content depth *does* decide is whether "ask it three times" can avoid
repeating itself. A word drawn three times in a session needs three distinct
chunked sentences; with one, the second question is the same sentence again,
and the second time through you are remembering the sentence, not the word.
So depth is a target for the content backlog, not a per-word decision made by
hand.

## The data

New bundled file `src/data/sentenceChunks.json`. Not a field on
`recallSentences.json`: 回想 downloads that file every session and must not
pay for a mode it does not use.

```json
{ "version": 1, "chunks": [
  { "src": "ex", "id": "abrogate", "i": 0, "cuts": [3, 7, 12], "blank": 3, "answer": "abrogated" }
]}
```

- `src` — `"ex"` (the English is `word.examples[i]`) or `"sg"` (`i` indexes
  `senseGroups.json`'s `groups`, and the English is that group's `en`).
- `cuts` — **token indices where a new chunk starts**, over
  `en.split(/\s+/)`. Three cuts make four chunks.
- `blank` — token index of the word to withhold.
- `answer` — that token, lowercased and stripped of surrounding punctuation.

**Cuts, not chunk text.** The English exists in exactly one place already, and
storing a copy beside the annotation gives it somewhere to drift to — the same
reasoning as `RecallQuestion.en` reading straight off the word entry. It is
also ~30 bytes a sentence instead of ~150.

`answer` carries a second job: it is a **drift checksum**. Words are editable
in-app and the repo copy of `words.json` has diverged from the live library
before (CLAUDE.md, commit `f53adb9`). If `tokens[blank]` does not normalise to
`answer`, the whole sentence is skipped and no question is built. One fewer
question beats a question whose chunks are cut mid-phrase.

### Two pools, two chunk floors

| pool | English lives on | sentences | tokens (median) | chunk floor |
|---|---|---|---|---|
| `ex` | `word.examples[i]` | 1215 (243 words) | 19 | 5 |
| `sg` | `senseGroups[i].en` | 325 at ≥10 tokens (309 words) | 12 | 4 |

The floor started at 5 and was lowered to 4 for the `sg` pool. It was set when
ordering was the only test; with a blank and a distractor, four chunks is
P(5,4) = 120 arrangements *plus* a word to produce, which is not a mode you
can coast through.

That one relaxation is worth 37 points of coverage:

| | words askable | of 691 |
|---|---|---|
| `ex` only | 243 | 35.2% |
| `ex` + `sg` at ≥10 tokens | **501** | **72.5%** |

258 of those words are reachable **only** through the `sg` pool, and that pool
needs no new Chinese at all — sense groups already carry an aligned pair.

A sense-group sentence can only ever blank `order[0]`. The other members are
the ranked alternatives, so blanking and demanding one of them would be
wrong. That is why 421 groups yield 309 askable words, not 545.

### The distractor

One extra chunk in the pool, drawn from **another chunked sentence of the same
word** where one exists, otherwise from any other chunked sentence. Three
rejection gates, and if nothing survives, the question ships with no
distractor:

1. Its normalised text equals a chunk of this sentence.
2. **It contains the target word in any form.** Another example of `abrogate`
   naturally contains `abrogated`; using it prints the answer on the screen.
3. Its length differs from this sentence's median chunk length by more than
   two tokens — shape alone would give it away.

A cross-word distractor may be obvious enough to discard on sight. That is
acceptable: it means the question did not get harder, not that it became
ambiguous. Failing toward easy is fine here; failing toward ambiguous is not.

Confusable-word distractors are **out**, permanently. `recallSentence.ts`
already documents why: example sentences were written to show a word in use,
not to make one of two near-synonyms clearly better, so a near-synonym chunk
produces "either one fits" and marks a defensible answer wrong. Discrimination
belongs to 辨析.

### Free knobs taken

- **Chunks render lowercase, and the final period is not part of any chunk**
  (it sits at the end of the answer row). Otherwise the first and last
  positions are given away. Proper nouns keep their capitals; only the
  sentence-initial capital is suppressed.
- **6 questions a session**, not the usual 10. Ordering 5 chunks and typing a
  word runs 30–60s against a few seconds for a multiple-choice question; ten
  of them is 短文's session length, not a daily mode's.

## Coverage scanning

`content-staleness.ts` gains a 组句 coverage line that is **printed, never a
STALE trigger** — the same treatment passage coverage already gets, and for
the same reason spelled out there: the ceiling is a subset of the library by
construction, so a trigger would sit red permanently, and a permanently red
scan stops being read.

## Content plan

Breadth before depth. The mode is usable at one sentence per word; depth only
changes how often a hard word can repeat without repeating a sentence.

| batch | annotations | effect |
|---|---|---|
| v1 | `ex` 243 (1/word) + `sg` 325 | 501 words askable, **zero new Chinese** |
| later | `ex` +486 (to 3/word) | hard words reach 3 questions without repeating |

## Files

| file | role |
|---|---|
| `src/data/sentenceChunks.json` | new bundled content |
| `src/lib/sentenceChunk.ts` + `.test.ts` | types, eligibility, distractor, verdicts, normalisation — all pure |
| `src/pages/QuizCompose.tsx` | the surface, lazy-loaded like passage / recall |
| `scripts/validate-sentence-chunks.ts` | write-side gate, plus an npm script |
| `src/lib/quiz.ts` | `compose` in `QUIZ_METRIC_KEYS` / `QUIZ_METRIC_LABELS` |
| `src/pages/Quiz.tsx` | eighth `MODES` entry |
| `scripts/content-staleness.ts` | printed coverage line |

## Out of scope

- **Free sentence production.** Nothing here asks for an unconstrained
  translation; there is no server and therefore no grader that could judge one.
- **Typing more than one word.** See the `abolished` trap above.
- **Confusable distractor chunks.** 辨析 owns discrimination.
- **Writing `RecallStat` or `recallRating`.** 回想 owns the production axis it
  already measures.
- **New Chinese renderings.** v1 uses only pairs that already exist.
