# 形近 — telling look-alike words apart

## Why

The user asked for a review of words that *look* alike, because they had
noticed some getting mixed up, and expected there to be few of them. Asked for
an example, they could not name one and handed the design over: build it,
then report. Every call below was made without asking.

Nothing in the app covered this. 辨析 pairs words that **mean** nearly the
same (contrast.ts, built on shared synonyms) and asks which fits a sentence.
A look-alike confusion happens earlier, while reading: the eye lands on
`elude` and the head supplies `allude`. Those two share no synonyms, so the
synonym graph cannot see them, and none of the nine existing modes puts them
side by side.

## What

A tenth mode on the 测试 hub, 形近 (`/quiz?mode=lookalike`), ten questions a
round through the shared `QuizSession`:

- **Prompt:** one headword, in the headword serif.
- **Options:** four Chinese meanings — the word's own, every look-alike
  partner's (up to three, closest first), and unrelated fillers.
- **Reveal:** each trap option is named once answered (`elude 的意思`; under
  你的选择 when it was the pick), and below the 下一题 button a card stacks the
  asked word and its partners — headword with the differing letters under a
  cinnabar 着重号, phonetic, part of speech and gloss, one example.

`src/lib/lookalike.ts` decides everything; the page paints.

## Which words are look-alikes

Computed from spelling at runtime, not authored. All rules are in
`buildLookalikePairs`; each has a test that goes red when it is removed.

1. Single words of four letters or more, lengths within two.
2. One edit apart (a swap of adjacent letters counts as one), or two edits
   apart when both words have five letters or more and the common opening plus
   the common ending cover at least two thirds of the longer word. The frame
   is what the eye reads; two edits alone is mostly rhymes (`devious`/`tedious`
   frames 4 of 7 and is out; `allude`/`elude` frames 4 of 6 and is in).
3. Not one word plus an ending (`haste`/`hasten`), not an inflection, not a
   word and its negation (`resolute`/`irresolute`).
4. Not one base in two parts of speech (`eminence`/`eminent`) — one idea in
   two grammatical roles, answerable off the suffix. The same base in the same
   part of speech **is** kept, because there the meanings drifted apart:
   `precedence`/`precedent`, `perceptible`/`perceptive`.
5. No gloss term in common, across every meaning: a shared term makes the
   partner's meaning a second right answer (`amiable`/`affable`, both
   和蔼可亲的). Parentheticals, 令人-type openers and runs containing 的/地/得 are
   ignored, since 内在的/外在的 share 在的 and mean opposite things.
6. Not near-synonyms: those are 辨析's, where a sentence can decide.

Measured on the live library, 2026-10-29 (1,549 words, 1,064 learned):
**128 pairs**, 20 of them one edit apart. Of the candidates that passed on
spelling, the rules dropped 58 as word-plus-ending, 9 as inflections, 30 as
negations, 48 as one base in two parts of speech, 21 on a shared gloss term
and 2 as near-synonyms. **61 pairs are askable** (both words learned), over
106 words; 93 of those words have one partner and `perceptive` has four.
Fifty generated rounds all came out at ten questions, every one with four
distinct options containing the answer, averaging 1.17 traps a question.

## Calls made without asking

- **Computed, not a curated list.** A loosely alike pair costs targeting,
  never correctness: rule 5 guarantees the partner's meaning is wrong, so the
  worst a weak pair produces is a fair question about a confusion the user
  may never have had. A curated list would add a curation step to every new
  word for that, and the user asked for something they would not maintain.
- **One word as the prompt, not the pair.** The confusion happens one word at
  a time; showing both would make it a matching puzzle solved by elimination.
- **`meanings[0]` on both sides**, not `pickMeaning`'s draw: the confusion is
  between core senses, and a secondary sense would test polysemy instead.
- **No two options share a gloss term** — fillers against the answer, the traps
  and each other; partners against each other. Found by playing: `preside`
  drew presage's 预示;预兆 as its trap and another word's 预示,预兆 as a filler,
  and two options meaning one thing rule each other out.
- **Both words learned**, as in 辨析 and for its reason.
- **Each pair at most once per round.** After one side's reveal has printed
  both meanings, the other side would be answered from the screen.
- **Recency by prompt word** (`volcab.recentLookalike`, local, the 辨析 window
  of two thirds of the pool), so the other side of a pair comes up next round.
- **Writes are 辨析's**, through `recordQuiz`, demotion included (the 08-09
  quiz-demotion spec): picking a partner's meaning marks both words missed —
  the confusion lives in the pair — and any other wrong pick marks only the
  asked word (`lookalikeMissIds`).
- **No authored note per pair**, for AntonymCard's reason: two glosses that
  share no term are their own explanation. The card drops collocation chips
  and adds the phonetic, since spelling and sound are what tell look-alikes
  apart.

## Non-goals

- Phrases (`give in`/`give up`): their look-alike is a different particle,
  a collocation problem rather than a reading one.
- Same-sound words spelled differently (`complement`/`compliment` sound alike
  *and* look alike, so they are in; `aloud`/`allowed` would not be).
- Words the user has not learned yet, as either side.

## Failure conditions

- If a round regularly shows a pair the user calls "not alike at all", the
  frame threshold is too loose — re-measure rule 2 before reaching for a deny
  list.
- If a round shows a trap the user calls "that is also right", rule 5 missed
  a synonym written with no shared characters; that pair needs the gloss or
  the synonyms fixed in the word data, not an exception here.
- Round generation costs 47 ms in Node over the live library (rule 2's frame
  check runs before the edit-distance table; without it, 1,150 ms). If the
  library grows past roughly 5,000 words and a round visibly stalls on a
  phone, build the pairs once per session instead of once per round.
