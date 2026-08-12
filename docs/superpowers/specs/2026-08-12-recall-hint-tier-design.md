# 回想 提示层: the English definition as a second retrieval attempt

**Date:** 2026-08-12
**Status:** approved

## Problem

The user reports that 回想 — the Chinese-to-English direction — is the mode
they keep failing, and that the failure does not feel like forgetting. Their
words: the Chinese shown does not map one-to-one onto the English word, so
the retrieval has nothing definite to aim at.

Measured over the 523-word library, they are right, and it is structural:

| | |
|---|---|
| words sharing a Chinese gloss fragment with another word | **148 / 523 = 28.3%** |
| Chinese gloss fragments claimed by more than one word | 97 |
| covered words having exactly **one** 回想 scenario | 344 of 398 (86%) |
| words with no 回想 entry point at all | 125 |

**Correction.** The first pass at this reported 192 words / 36.7%, and that
number is wrong. It split glosses on parentheses as well as on punctuation,
so `(医学)扭转` contributed the fragment `医学` and collided with seven
unrelated medical entries. Stripping the parenthetical qualifier before
splitting — a qualifier is not a meaning — gives the figures above. The
conclusion is unchanged and the named examples are all real collisions; the
magnitude is smaller than first claimed.

`减轻` points at alleviate, assuage and extenuate. `满足` points at assuage,
gratify and appease. `渗透` points at percolate, pervade and permeate.
`有害的` points at malign, inimical, detrimental and malignant. A learner
retrieving from the Chinese side is being asked to invert a lossy hash, and
no amount of practice makes a lossy hash invertible.

The recall-mode design already knew half of this — it is why the prompt is a
scenario sentence rather than a gloss
(`2026-08-07-recall-mode-design.md`, and the comment at the top of
`src/lib/senseGroup.ts`). What it did not provide is a second tier. Today
`想不起来` flips straight to the answer, so a learner who cannot produce the
word gets no further retrieval attempt — only reading, and reading is input.
Production is not trained by more input.

## Decision

**After `想不起来`, show the answer word's English definition and ask
again.** One new stage between the commit gate and the reveal.

```
                    烧焦的爆米花味弥漫了整个办公室
                    [ 我想好了 ]   [ 想不起来 ]
                                        │
                                        ▼
        to spread through and fill every part of something
                    [ 我想好了 ]   [ 想不起来 ]
                         │                │
                         ▼                ▼
                    four options      reveal (blank)
```

The point is the pathway it exercises. A native speaker does not go
`中文 → 英文`; they go `situation → concept → word`. The English definition
*is* that middle term, and the library already carries one per sense, written
under a rule that makes it usable here — `docs/word-entry-spec.md`: the `en`
field is "the main goal is 'understand English in English' — this needs to
stand on its own." The Chinese ambiguity that makes the first attempt
unfair does not exist at this tier: `减轻` is three words, but
"to make suffering or a problem less severe" is one.

### Why not the alternatives

**A hint button at the commit gate** was rejected. The commit gate is the
whole mechanism of the mode — it replaces typing without turning production
back into recognition. A third button competing with `我想好了` becomes the
reflexive tap, and every question quietly downgrades to the easier tier.
Reachable only *after* an honest `想不起来`, the hint cannot be taken
pre-emptively.

**Printing the definition on the reveal card** was rejected outright. It is
not a retrieval attempt, it is more reading, and reading is what already is
not working.

### Scope limits, both deliberate

**唤词 only, never 排序.** In 排序 all three members are on screen from the
start; their English definitions would hand over the ranking the question
exists to ask.

**One sense, not all of them.** 79 of the 329 groups have a polysemous
answer word, and showing every definition would sometimes put a cue in front
of the learner that points away from the word being asked for.

Audited across all 329 after the field was added: **exactly one** group is
about a secondary sense — `agreeable`'s 只要各方都点头 scenario means
"willing to go along with" (sense 1), against sense 0's "pleasant, and easy
to spend time with or in". Every other scenario was written about its
answer's dominant sense, so the default carries them.

One case in 329 is a thin justification for a field, and it was nearly
dropped. What keeps it is the alternative: without it the rule becomes
"a group must be about its answer's dominant sense", which silently bans
every 30%-share sense from ever being asked — a much larger restriction
than the field costs.

## Data model

`SenseGroup` gains one optional field:

```ts
/** Index into the answer word's `meanings` — which sense this scenario is
 *  about. Drives the English hint. Defaults to 0, the highest-share sense. */
sense?: number
```

Optional rather than required, and read leniently: a group whose `sense` is
missing or out of range falls back to `meanings[0]`, and a word with no
usable `en` yields no hint at all, in which case `想不起来` settles
immediately exactly as it does today. This is the same write-strict /
read-lenient split every other bundled-content field in this file already
uses (`target`, `en`).

`validate-sense-groups` enforces the write side: when present, `sense` must
be a non-negative integer less than the answer word's `meanings.length`. A
group pointing at sense 3 of a two-sense word is dangling content, and
dangling content is the one thing the content validators hard-fail on.

`RecallQuestion` gains a parallel `hint?: string`, resolved by
`buildRecallQuestion` at build time. The page paints what the pure functions
decide; it does not reach into `Word` itself.

## Scoring

**A question reached through the hint is scored wrong, whatever is picked
afterwards.** You could not produce the word cold, and that is what the mode
measures. The score, `recordQuiz`, and the SRS signal are untouched by the
new tier.

What changes is the *reporting*. `Miss` grows from two values to four, and
each is a different diagnosis with a different remedy:

| value | tag in the results list | what it means |
|---|---|---|
| `blank` | 没想起来 | nothing came, not even with the English definition in front of you |
| `other` | 意思到了 | a word came, just not one of these — usually a simpler one |
| `hint-hit` | 提示后想起 | the English unlocked it. The concept is there; the Chinese handle is what failed |
| `hint-miss` | 提示后仍错 | even with the definition you reached for a confusable. The sharpest finding the mode can produce |

`hint-hit` is the row that answers the user's actual question. A screen full
of them means the words are learned and only the Chinese-side handle is
missing — which is a content problem, addressed by the companion batch
below, not a study-harder problem.

The wrong-answer sound plays on `hint-hit`, because it is a miss. The
feedback line says so without punishing: 提示后想起来了 —— 这次不算对,通路正在建立.

## Companion content batch

The feature gives a second attempt; it does not reduce the ambiguity that
caused the first one to fail. That is content work, and the unit is the
**collision cluster, not the word**: for each Chinese gloss fragment claimed
by more than one word, one sense group that forces the distinction. `减轻`
becomes a single 排序 question over alleviate / assuage / extenuate, whose
members are each other's natural distractors.

Two filters decide what is authorable, and both were found by trying:

- **Parenthetical qualifiers are not meanings.** `医学`, `法律`, `正式` are
  domain and register markers that happen to sit inside a gloss. Stripping
  them is what turns 126 apparent collisions into 97 real ones.
- **The validator ranks on `meanings[0].pos`**, the entry's *primary* part
  of speech, so a cluster held together by a member's secondary sense can
  still be unaskable. `有害的` looks like four adjectives — detrimental,
  inimical, malignant and `malign`, which is primarily a verb. Nine
  clusters fail this way and are dropped, not worked around.

Any cluster whose ranking cannot be made unarguable from a member's own
example sentence is skipped as well: `docs/superpowers/HANDOFF.md` and the
word-content skill both say an arguable answer key is worse than no
question, and this session already dropped two groups on that rule.

## Testing

`src/lib/senseGroup.test.ts` covers the new pure surface: `buildRecallQuestion`
resolves `hint` from the named sense, falls back to sense 0 when `sense` is
absent or out of range, and yields `undefined` when the word carries no
usable definition; `buildOrderQuestion` never produces one.

The stage machine is UI and gets no component test, per `CLAUDE.md`. It is
kept thin enough not to need one — the decision of *what* the hint says lives
in `senseGroup.ts`, and the page only decides *when* to show it.

`validate-sense-groups` gains a case for an out-of-range `sense`.
