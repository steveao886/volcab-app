# Word notes: the contrast point settles onto the word's own card

**Date:** 2026-08-06
**Status:** approved

## Problem

The contrast quiz explains itself well. After answering, `QuizQuestion`
renders the note for that pair from `src/data/contrastNotes.json` — 325
authored explanations, one per confusable pair, naming the dimension that
decides which twin a sentence wants (object, transitivity, connotation,
register).

That explanation is read once, at the moment of the mistake, and then it is
gone. It lives only in the quiz. The word's own card — the back of the review
card, the entry detail page — shows meanings, examples, synonyms, antonyms,
collocations, etymology, related forms, and says nothing about the one thing
the learner keeps getting wrong.

The user's report: the same words keep being missed in the contrast quiz, the
explanation makes sense each time, and none of it is present when the word
comes back around in review.

## Decision

A **word note** (要点): one sentence about a single word's own usage
boundary, stored per word id, shown under the meanings on the back of the
review card and at the end of the meanings block on the entry page.

```
abate  vi. 减弱
────────────────────────────────────
要点  只形容风暴、疼痛、争议这类坏事自行减弱，
      主语是坏事本身，不能带宾语（the storm abates）。
```

### The content contract

A note states what **this word alone** does: what it takes as an object,
transitive or not, praise or blame, process or result, how formal it is, the
mistake it invites.

- **It never names another library word.** The moment a note says "不同于
  alleviate" it has become a pair note, and pair notes have a file already.
  This is the whole point of the feature: the pair note is relational and
  only true while both words are on screen; the word note has to survive on
  its own card, where the twin is nowhere in sight.
- **English fragments are wanted**, not tolerated. All 325 existing pair
  notes carry one (`the storm abates`, `alleviate pain/stress`); a
  collocation is the anchor that makes the abstract rule stick.
- **Chinese**, like every other piece of study content (see the language
  policy in CLAUDE.md).
- **A word with no real point gets no note.** This is the etymology rule
  (`Word.etymology`) applied again: 198 of the 498 words have no confusable
  twin at all, and manufacturing "正式用语，多见于书面" for them would dilute
  the notes that carry actual information. Blank is a valid, common, correct
  outcome.

### Where the content comes from

Distilled from the 325 pair notes, not invented. A word's note is the
property of *itself* that recurs across every pair it takes part in.
`abate` appears in four pairs; all four notes say some form of "不及物，坏事
自行减弱" — that recurrence is the note. Measured over the current library:
300 of 498 words appear in at least one authored pair note, and the median
word appears in 2 (maximum 11).

Where a word's only pair note says the two rarely compete (`abate|belittle`:
"两词很少同场竞争"), there is no shared point to extract and the word is left
blank unless another pair supplies one.

## Storage: bundled, read-only, outside the sync schema

`src/data/wordNotes.json`, keyed by word id:

```json
{ "version": 1, "notes": { "abate": "只形容风暴、疼痛……" } }
```

Types and the lookup live in `src/lib/wordNotes.ts`, alongside
`contrastNotes.ts` and `passage.ts` — deliberately **not** in
`src/types.ts`, which is the *synced* data model.

### Why not a field on `Word`

It was the obvious alternative and it was measured: `data/words.json` is
785 KB today, and one ~40-character Chinese line per word adds about 64 KB,
landing near 849 KB — roughly 175 KB short of the 1 MB ceiling above which
the GitHub Contents API stops returning file content inline and sync breaks
outright. Spending a quarter of the remaining headroom — on a file CLAUDE.md
already says not to add bulk to — buys the ability to edit a note in
`WordEditForm` and sync it between devices. The user does not edit contrast
notes, passages, or suggestions either; the same authoring loop (a session
tops the file up) covers this.

As shipped, `wordNotes.json` is 34.6 KB in the bundle and `data/words.json`
is byte-for-byte unchanged.

Accepted consequences, both already true of `contrastNotes.json`:

- A word the user adds by hand has no note until a session writes one.
- Correcting a note is a code change, not an in-app edit.

## Where it renders

| Surface | Position |
|---|---|
| Review card back (`ReviewCardBack`) | Directly under the meanings list, above 例句 |
| Entry page (`WordDetail`) | Inside the meanings card, at the end |
| Contrast quiz result | **Nothing.** The pair note is already there and is strictly better for that moment; stacking a second explanation blurs both |

Both surfaces reuse the etymology treatment — a hairline rule on the leading
edge, muted text (`.review-etymology` / `.worddetail-etymology`) — because a
note is the same kind of object: a sentence among blocks of chips. Vermilion
is not used; it is reserved for annotation and destructive actions.

A word without a note renders no heading, no empty block — the same rule the
etymology section already follows.

## Write side: `scripts/validate-word-notes.ts`

The fifth validator, following the four that exist. Bundled content ships and
stays until the next release, so the gate is strict here and the runtime is
lenient (unknown id → `undefined` → nothing rendered).

Failures:

- `version` is not 1
- a key is not a word id in `data/words.json` — a note that can never render
- a note is empty, or has no Chinese in it
- a note is over **80 characters**. The pair-note ceiling is 160 and covers
  two words; one word gets half.
- a note names another library word's headword

That last check is the content contract made mechanical, and it was measured
before being adopted: across the 325 existing pair notes, only 2 mention a
third library headword (`obdurate|refractory` → recalcitrant,
`pious|reverent` → platitude). A rule that fires on 0.6% of comparable
authored text is catching real drift, not generating noise. Matching is
case-insensitive on whole English tokens, excluding the note's own word;
the 12 multi-word headwords (`smoking gun`, `de facto`) are matched as
phrases, since their individual tokens are ordinary English.

It earned itself on the first authoring pass: the note drafted for `pious`
used `a pious platitude` as its example, and `platitude` is in the library.
The gate rejected it, and the rewritten note is better for not leaning on a
second word.

Coverage is **reported, not enforced** — how many of the words that take part
in a contrast pair have a note — for the same reason the pair-note validator
reports rather than enforces: the library moves, and a missing note degrades
to "nothing shown", which is safe.

## Testing

`src/lib/wordNotes.test.ts` covers the lookup: known id, unknown id,
malformed file. No component tests — the render layer stays thin enough not
to need them (CLAUDE.md; `store.test.tsx` is the one exception in the repo).

## Not doing

- **Per-meaning notes.** A polysemous word's usage boundary belongs to its
  dominant sense, and the meanings are already sorted by `share`. One line
  per word until a real case demands otherwise.
- **Showing a word's pair notes on its card.** The word with 11 pairs would
  get a wall in which "abate 不及物" appears four times. The distilled single
  line is the answer to that problem, not a companion to it.
- **Backfilling all 498 words.** See the content contract.
