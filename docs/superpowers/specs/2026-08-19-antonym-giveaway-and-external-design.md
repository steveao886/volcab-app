# `antonymPick` — closing the shape leak, opening the library

**What is being built**: two changes to the opposite question, one that
removes questions and one that adds six times more of them.

1. A question whose answer can be read off the *spelling* of the prompt
   (`fallible` → `infallible`) is no longer generated, in `antonymPick` or
   in `synonymHint`.
2. `antonymPick`'s answer is no longer required to be a library headword.
   Any string in the prompt word's `antonyms` may be the answer.

Measured against `data/words.json` at 599 words, 2026-08-19.

Supersedes the coverage numbers in
`2026-08-16-antonym-quiz-design.md`, which were measured at 566 words.

---

## Part 1 — the shape leak

### What it is

`2026-08-16-antonym-quiz-design.md` names one failure and guards it three
ways: **a four-choice question with two correct answers**. This is its
mirror image and it went unguarded — **a four-choice question with zero
required knowledge**.

Prompt `fallible`, options `infallible / austere / turbid / laconic`. A
learner who has never met either word answers correctly by noticing that
one option is the prompt with two letters bolted on the front. The
question measures nothing and, worse, teaches that the quiz can be beaten
without reading.

That is the same defect as rule 3 of the original spec ("three verbs
standing beside one adjective hand the answer over without the learner
reading a single word"), arriving through spelling instead of grammar.

### How much of it there is

Library-internal opposite pairs: **94 pairs / 188 directions**, of which
**5 pairs / 10 directions (5.3%)** are pure affix flips:

| pair | relation |
|---|---|
| fallible ↔ infallible | `in-` |
| conspicuous ↔ inconspicuous | `in-` |
| opportune ↔ inopportune | `in-` |
| pretentious ↔ unpretentious | `un-` |
| artful ↔ artless | `-ful`/`-less` |

`synonymHint` has the same leak from a second direction: it pools
`synonyms` and `antonyms` into one hint list, and **28 of its 1,964
reachable hints are a shape flip of their own headword** — an expected
**1.58%** of that question type. `equitable ← inequitable`,
`sociable ← unsociable`, `dishearten ← hearten`, `impurity ← purity`.

The synonym half of that same pool leaks too, differently:
`topple ← topple over`, `mire ← quagmire`, `mime ← pantomime`,
`begrudge ← grudge`, `entanglement ← tangle`. The hint literally contains
the answer.

### The rule

`isShapeGiveaway(a, b)` in `src/lib/shapeGiveaway.ts`. Three clauses,
each measured over the whole library:

1. **Containment** (53 hits) — the shorter string, at least 4 characters,
   appears inside the longer one.
2. **`-ful`/`-less` swap** (3 hits) — `artful`/`artless`,
   `effortful`/`effortless`. Containment cannot reach these.
3. **One-token multiword difference** (4 hits after the guard below) —
   both strings are multiword with equal token counts and differ in
   exactly one token, **and at least one shared token is not a function
   word**.

**Containment does the work a prefix list would do, without the list.**
`un- / in- / im- / il- / ir- / dis- / non- / anti-` need not be enumerated
anywhere: `fallible` is inside `infallible`, `purity` inside `impurity`,
`hearten` inside `dishearten`. An enumerated prefix list is a second thing
to keep correct and would rot the first time a word arrived under a prefix
nobody listed. The 4-character floor stops a short word landing inside an
unrelated long one.

The content-word guard on clause 3 is not decoration. Without it the
clause fires on `stem from ~ arise from`, `stem from ~ derive from`,
`account for ~ answer for` and `in the wake of ~ in the aftermath of`,
where the only shared tokens are `from`, `for`, `in/the/of`. Sharing a
preposition hands over nothing — the learner still has to know the verb.
With the guard it fires on exactly the four that do leak:
`level playing field ~ tilted playing field` (shares `playing field`),
`race to the bottom ~ race to the top` (shares `race`),
`with a pinch of salt ~ with a grain of salt` (shares `salt`),
`fall through ~ fall apart` (shares `fall`).

### The rule that was tried and rejected

A "shared leading stem of N characters" test looks more general and is
wrong. At N=4 it flags, as giveaways:

```
contentious ~ controversial      intercede ~ intervene
interlude   ~ interval           irreparable ~ irreversible
intersperse ~ interlace          superintend ~ supervise
```

Sharing `inter-` or `super-` is not a hint. Those are six different words
a learner has to know one at a time, and suppressing them would delete
good questions to prevent an imagined defect. Raising N or scaling it
against word length does not separate the classes — it only moves which
ones are wrong.

**Knowingly out of scope, and this is the cost of the tight rule:**
`credulity ~ credulousness`, `pretension ~ pretentiousness`,
`commensurate ~ commensurable`, `oxidization ~ oxidation`. These do leak,
and every rule loose enough to catch them also catches the six above.
Recorded here so the next session reads "measured and declined" rather
than rediscovering the stem rule and shipping it.

### Where the filter attaches, and where it must not

The filter goes in `generateAntonymQuestion`, on the **answer candidates
only**. It must **not** go into `antonym.ts` at graph-build time, and this
is the load-bearing sentence of Part 1.

`antonymIndex` is doing two jobs at once inside the generator: it chooses
the answer, and it supplies rule 1's distractor exclusion set ("every
opposite of the prompt, not just the one drawn as the answer"). Deleting
the `conspicuous — inconspicuous` edge at build time looks like one filter
in one place, and it silently re-opens the original failure: with prompt
`conspicuous` and answer `unobtrusive`, `inconspicuous` becomes an
*eligible distractor* while still being a correct answer.

**Answer candidates shrink. The exclusion set never does.**

Five words — `artful`, `artless`, `fallible`, `infallible`,
`pretentious` — have no library opposite except their own affix flip.
Under Part 1 alone they would leave the question type entirely. Part 2
puts four of them back through their external antonyms.

## Part 2 — answers from outside the library

### The hole

The original spec ended on a ceiling it could not raise: "106 eligible
words is 18.7% of the library against a 1/7 ≈ 14.3% share of the
rotation... repeats start showing up within a dozen sessions. This is the
ceiling of the data, and the only way up is more library-internal words in
`antonyms` arrays."

There is a second way up, and it needs no authoring. Of **1,172 antonym
strings, 1,055 name a word outside the library** — 801 distinct ones, and
**499 of 599 words carry at least one**. They are already trusted enough
to render on the word card and to serve as `synonymHint` prompts. The only
thing they have never been allowed to be is an *answer*.

Requiring both sides to be headwords was never a correctness rule. It was
what `buildAntonymPairs` happened to produce.

### The new population leak

Letting the answer come from outside creates a leak that is worse than the
one Part 1 removes, because it needs no vocabulary at all:

> If the answer is an external string and the three distractors are
> library headwords, **"the one I have never studied" is always right.**

Structurally identical to rule 3 of the original spec — a dimension the
options vary along that correlates perfectly with correctness — except the
dimension is membership rather than part of speech, and unlike part of
speech the learner sees it without knowing any English.

**All four options are drawn from one population.** A library answer keeps
today's path and takes library headwords. An external answer takes
external strings, drawn from other words' `antonyms`.

### Translating the three exclusions outward

| library rule | external form |
|---|---|
| exclude every library opposite of the prompt | exclude every **string** in the prompt's `antonyms` and `synonyms` |
| exclude anything confusable with the answer | exclude the `antonyms` **strings of every word confusable with the prompt**, read off `buildContrastPairs` |
| distractors share the answer's part of speech | external strings carry no POS — use the **source word's** `meanings[0].pos`, which must equal the prompt's |

The middle row is the one that earns its place. Prompt `garrulous`,
answer `taciturn`: a distractor lifted from `loquacious` — a confusable
partner — would be `reticent` or `quiet`, and both are also correct. A
confusable partner's opposites are the prompt's opposites; nobody wrote
them into the prompt's own array, which is exactly why absence there
cannot be trusted. Same inference `contrast.ts` already makes, pointed the
other way.

One exclusion has no library counterpart and is needed anyway: **the
synonyms of the prompt's library opposites**. With prompt `garrulous` and
answer `taciturn`, anything listed as a synonym of `reticent` is a second
correct answer.

`sharedSynonyms` is deliberately **not** applied to answer selection here.
It exists because a hint naming two entries makes two options correct when
the string is the *prompt*; when the string is the *answer* that inference
does not run. `praise` opposing both `disparage` and `belittle` costs
nothing when the prompt is `disparage`.

### Polysemy, which is where this gets sharp

**`antonyms` is word-level, not sense-level.** 267 of 1,172 directions
(**22.8%**) come from a word with more than one meaning, and **33 of those
words have meanings under different parts of speech**.

```
agnostic   [n.] 不可知论者  /  [adj.] (技术上)平台中立的
             → believer, platform-specific

underhand  [adj.] 不正当的  /  [adj. & adv.] (投球)下手的
             → aboveboard, straightforward, overhand
```

Both antonym lists are *correct*; each string opposes a different sense.
Nothing in the data says which.

Two consequences.

**Safety is already covered.** `believer` and `platform-specific` can
never appear in the same question, because rule 1 excludes every opposite
of the prompt from the distractor pool. The external form of that rule
excludes every *string*, so the guard carries over unchanged.

**Fairness is not.** The original spec withholds the prompt word's gloss
on purpose — showing it "turns the question into a free review of the
prompt word and tests only the relation". So `agnostic` stands alone on
screen with `platform-specific` as the answer, while the learner is
thinking about epistemology.

The fix is a part-of-speech tag on the prompt, and it has to be honest
about what it can know:

- **Answer is a library word** — its `meanings[0].pos` is known. Tag the
  prompt with it. The tag is always true.
- **Answer is external and the prompt is single-POS** — the prompt's own
  `meanings[0].pos` is unambiguous. Tag it.
- **Answer is external and the prompt has mixed-POS meanings** (33 words)
  — there is no honest tag. **Skip.** Cost: 71 directions.

Tagging `agnostic (adj.)` while the answer is `believer` would be a
fabricated label on a study surface, which is worse than a hard question.
Skipping is what every other dead end in `generateQuiz` does.

### What it costs on the reveal card

An external answer has no word entry, so the reveal cannot show its
Chinese gloss. `AntonymCard` renders the prompt's side only.

This is a continuation, not a new wound: `synonymHint` has always used
external strings as prompts and has never glossed them. `antonymId` stays
optional and is simply absent for an external answer — the rendering
branch at `QuizQuestion.tsx:400` already tests it, which is why the field
was made optional in the first place.

### Coverage

```
                        before        after
askable directions         188         1117      ×5.9
askable words              135          476      ×3.5

  excluded: shape giveaway (Part 1)      55
            mixed-POS prompt + external  71
```

`antonymPick` keeps its 1/7 share of the rotation. It is the same question
against a bigger source, not a new surface, so `QUIZ_TYPES` and
`QUIZ_METRIC_KEYS` are untouched for the reasons the original spec gives.

At 476 of 599 words (79.5%) the type now over-fills its 14.3% share
instead of only just filling it, and a 20-question mixed quiz draws its
~3 antonym questions from 1,117 rather than 138. The repetition ceiling
the original spec recorded is gone.

## Not doing: an obscurity filter

The obvious worry about external answers is that some are too rare to be
fair. Measured, the worry does not survive.

The 801 distinct external strings are overwhelmingly ordinary — `calm`,
`praise`, `humble`, `anxious`, `lucky` — with a tail of normal advanced
vocabulary (`taciturn`, `laconic`, `abstemious`, `gauche`) that this
library exists to teach. The strings that *look* manufactured
(`erasable`, `simplifiable`, `satiable`, `stoppable`, `unblock`,
`disorganize`) turn out to be morphologically indistinguishable from
`reliable`, `admirable`, `reasonable`, `sociable`, `comparable`,
`agreeable`. A draft suffix/prefix heuristic aimed at the first group
deleted 86 strings, nearly all from the second.

The separating property is frequency, and there is no frequency signal in
this repo. `data/wordlist.json` is a backlog of words to add, not a rank
list. The "appears under more than one entry" count does not separate them
either — `erasable` and `denotation` both appear exactly once.

That leaves a bundled frequency list, whose threshold would cut
`taciturn` and `laconic` before it cut `erasable`, or a hand-maintained
denylist that drifts with every batch of new words. Both cost more than
the defect.

Checked one by one, the strings that first looked wrong are right:
`agnostic → platform-specific` opposes meaning 2, `underhand → overhand`
opposes meaning 2, `myopia → farsightedness` and
`connotation → denotation` are exact. **One** is genuinely invented —
`race to the bottom → upward convergence`, which is not an English
phrase — and clause 3 of the shape rule already removes the sibling
`race to the top`. Data quality belongs to the `word-content` refresh,
not to a runtime filter.

## Not doing: the synonym direction

`synonymHint` already asks "one in, one out" on the synonym side — an
external string as the prompt, a library headword as the answer, over 572
words. The missing half is headword → synonym, which would be an eighth
question type and would cut every existing type's rotation share from 1/7
to 1/8. That is a separate change with a separate cost, and it gets its
own spec.

## Testing

Logic lives in `src/lib/`, so tests are colocated and the render layer
gets none (`CLAUDE.md`). `rng` is injected.

`shapeGiveaway.test.ts`
- each clause's positive cases
- **the rejected stem rule's false positives, asserted false**:
  `contentious/controversial`, `intercede/intervene`, `interlude/interval`,
  `irreparable/irreversible`, `stem from/arise from`, `account for/answer for`.
  These are the exact pairs that killed the looser rule. Written as
  assertions so the next attempt fails a test instead of shipping.

`quiz.test.ts`
- no distractor is an opposite of the prompt, in either population
- all four options come from one population — never three headwords
  around one external answer
- the POS tag matches the answer's POS when the answer is a library word,
  and a mixed-POS prompt with an external answer produces no question
- no generated question has an answer that `isShapeGiveaway` accepts
- the same seed reproduces the same question

Full-library regression, in the spirit of `headword.test.ts`: every one of
the 1,117 askable directions builds a complete question, and any that
cannot is **reported by name**. If it ever fails, the fix is to find why
the distractor pool ran dry — not to relax an exclusion.

## Stale numbers retired

`antonym.ts`'s header and the 2026-08-16 spec were measured at 566 words
and say "69 pairs across 106 words... 138 questions". At 599 words it is
94 pairs across 135 words. `CLAUDE.md` requires re-measuring rather than
leaving a stale figure, so both are updated as part of this change.
