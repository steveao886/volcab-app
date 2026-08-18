# Passage selection: play counts instead of a score

Supersedes the "which passage" half of
`2026-07-28-passage-cloze-design.md`. Everything else in that document —
marker syntax, blank selection, distractor tiers, submit-once grading — still
stands.

## What was wrong

The original picker ranked passages by how much review they would deliver:
`3 × (blanks due today) + 1 × (blanks learned but not due)`, highest wins.
A recency window then excluded the two-thirds most recently served.

Both halves failed, and they failed at the same thing.

The score is a spread, not an ordering. Seven due blanks scores 21; three
learned blanks scores 3. Nothing bounded that gap, so the passages that
happened to hold due words won every time they were eligible, and the rest
waited for the window to force their turn. The window then had to do all the
levelling on its own, and it could only ever say "not this one again yet" —
never "this one hasn't had a turn at all." Measured over 60 consecutive
sessions on the 42-passage corpus with 15% of words due: **12 passages were
never drawn once.**

Growing the corpus does not fix this. The window scales with the corpus, so
the starving set scales with it too.

## What replaces it

**Fewest plays wins, ties break towards whatever was served longest ago.**

The picker keeps `{ n, last }` per passage id in localStorage: `n` is how many
times it has been served, `last` is the serve ordinal of the most recent time.
`n` levels the corpus; `last` only ever separates passages already level on
`n`.

Measured over 126 sessions, three full cycles of the corpus: every one of the
42 passages served **exactly three times**.

### Why `last` is not a refinement

Fewest-plays alone leaves the order inside a cycle to the rng, so a passage
drawn late in one cycle can return early in the next. Measured: 8 of 84
repeats came back within 20 sessions, the closest at 6 — which is the
complaint that started this. Holding a just-served passage out of the
tie-break for half the pool takes that to **0 of 84, closest 22**, and costs
the count guarantee nothing: everything the cooldown skips is level on `n` and
still gets its turn this cycle. See the table on `COOLDOWN_SHARE` for the
sweep from 1/4 through 1/2.

### The unlearned gate

A passage is set aside when more than `MAX_UNLEARNED_SHARE` (a third) of its
marked words are still unlearned. Unlearned words are printed as plain text,
so a passage over the line asks the reader to read past a pile of words nobody
has taught them, and it yields fewer blanks besides.

The threshold was picked against the pre-rewrite corpus, where 31 of 42
passages marked exactly 7 words and a tighter bar turned a single unlearned
word into a disqualification. Measured over 200 trials per level, passages
still eligible out of 42:

| new words | buildable | ≤1/3 | ≤1/4 | eligible ≥ 7 |
|-----------|-----------|------|------|--------------|
| 5%        | 42.0      | 41.8 | 40.3 | 30.5         |
| 10%       | 42.0      | 41.1 | 36.4 | 23.9         |
| 30%       | 40.9      | 26.3 | 14.0 | 7.9          |

"Every passage must be able to fill a full-size question" (eligible ≥
`MAX_BLANKS`) looked like the rule this should be, and stranded a quarter of
the corpus at 5% new words.

**That argument no longer applies to the corpus as it stands, and the rule is
kept anyway.** Every passage now marks 10, so a third and `eligible ≥ 7` mean
the identical thing — at most 3 unlearned — and the same sweep re-run on the
rewritten corpus shows the two columns matching exactly:

| new words | buildable | ≤1/3 | ≤1/4 | eligible ≥ 7 |
|-----------|-----------|------|------|--------------|
| 5%        | 42.0      | 41.9 | 41.3 | 41.9         |
| 10%       | 42.0      | 41.4 | 38.9 | 41.4         |
| 30%       | 41.9      | 26.6 | 15.4 | 26.6         |

The ratio is still the better *form*. It is the one that degrades gracefully
if a future passage marks fewer than 10, and the 7-mark measurement is exactly
what that failure looks like when it happens.

When nothing clears the gate, the whole buildable set is used instead. A
passage thick with unlearned words still beats the empty state.

## Deliberate non-goals

**The count is not synced.** Same call as `recentPassages` before it: a second
device keeping its own tally costs one early repeat; a new field in
`progress.json` costs a schema migration on a file three devices write to.

**Counts are not levelled across the gate.** They level within whatever pool
clears `MAX_UNLEARNED_SHARE` today. A passage held back keeps its low count and
goes to the front of the queue the moment it qualifies. Measured with 10% of
the library unlearned, 2 of 42 passages never qualified over 126 sessions and
their counts stayed at 0 — that is the gate doing its job, not a levelling bug.

**Serves are counted at build time, not at submit.** Abandoning a passage
halfway still counts, or backing out would hand the same passage straight back.

**Due words no longer influence which passage is served at all.** They still
order blank selection within a passage (`selectBlanks`), which is untouched:
the cap never comes down at a due word's expense.

## Corpus side

Two properties of the data turned out to matter as much as the picker, and
both were fixed in the same sweep (`84a8c22`, `66fdb4d`).

- **Corpus size sets the floor on repeat distance.** Nothing in the picker can
  put more sessions between repeats than there are passages. 34 -> 42.
- **Marking more words than `MAX_BLANKS` is what makes a repeat feel new.** A
  passage marking 7 words has exactly one blank set, because the cap rotates
  out a single word. All 42 passages now mark 10. Measured over 300
  assemblies each: mean 110.9 distinct blank sets per passage, worst 107,
  against a C(10,7) = 120 ceiling. The old 7-mark shape scored 7.

Word coverage went 236 -> 420 of 566 across the two commits.

## What the exclude audit found

All 42 exclude lists were read by hand, and the tier-1 pool is nowhere near
safe by default. `validate-passages` prints the pool precisely because no
check can decide whether a word would also fit the blank.

The recurring offender is the **stubborn cluster** — obdurate, obstinate,
intractable, intransigent, recalcitrant, refractory, headstrong, tenacious,
inexorable, uncompromising. Any passage marking one of them draws most of the
rest as tier-1 candidates, and they are mutually substitutable in almost any
sentence. `volcano-observatory` needed 17 exclusions. Smaller repeat
offenders: the *soothe* family (assuage / placate / appease / conciliate /
alleviate / abate / slacken) and the *diligent* family (assiduous /
conscientious / painstaking / industrious / sedulous).

Emptying a tier-1 pool is the right call when it comes to that. Distractors
fall back to same-part-of-speech and then any learned word, which makes the
passage slightly easier — and an easier passage beats one with two correct
answers. The difficulty lives in placing 7 answers into 7 blanks anyway, not
in the 2 distractors.
