# Spacing related words out of the review schedule

**Date:** 2026-09-09
**Status:** approved (option 1 of 4 presented to the user)

Companion to `2026-09-03-new-word-spacing-design.md`, which solved the same
complaint on the **intake** side. This one covers the **review** side, the
half that spec explicitly did not touch.

## Problem

The user asked whether same-root and synonym words landing on one day could
be shuffled, or staggered by a day either way.

Measured over the live `progress.json` on 2026-09-09 — 697 scheduled words,
95 distinct due dates from 2026-09-09 to 2027-03-03:

| | |
|---|---|
| related pairs among scheduled words, any date | 569 |
| **of those, sharing a due date** | **16 (2.8%), on 9 of 95 dates** |
| same-day pairs by shared stem | 4 (all also declared) |
| words per due date | min 1, median 3, p90 19, **max 47** |

```
09-09  repulsive | revolting        09-15  delineate | obscure
09-09  effortful | laborious        09-15  discontent | discontented
09-10  antipathy | antipathetic     09-15  discontent | resentment
09-10  impertinent | insolent       09-15  prominent | obscure
09-11  extenuate | extenuation      09-25  understated | subtle
09-12  rhetoric | declamation       10-03  interchange | interchangeable
09-12  conscientious | careless     10-08  headstrong | obstinate
09-12  humdrum | mundane
09-14  discursive | rambling
```

**13 of the 16 fall in the next seven days, and that is the whole
explanation**: near-term dates carry 20–47 words each while the median date
carries 3. Nothing in `srs.ts` groups relatives — collisions are a function
of how crowded a day is, and they thin out on their own as the backlog
spreads. This is a small, real annoyance, not a structural fault, and the
fix has to be proportionate to that.

### Why `fuzz` does not already handle it

`fuzz()` applies ±5% and **nothing below 3 days**. At the intervals that
actually collide (4–37 days) ±5% rounds to 0 or ±1 day, and it is blind to
what else is scheduled — two words that graduated together with the same
ease march together indefinitely.

## Decision

Two changes, both narrow:

1. **Session ordering** — `buildQueue`'s `due` half gets the same greedy
   spacing pass `orderFreshWords` runs, so relatives that do share a date
   are not served back to back.
2. **`due` nudge, forward only** — when `gradeWord` computes a review-phase
   due date that a related word already occupies, it moves the date **+1
   day, at most +2**, and leaves `intervalDays` untouched.

### Why forward only, when the user asked for ±1

Pulling `due` backward is the accident `71fba29` was: `gradeWord` computes
`next = intervalDays * ease` **knowing nothing about elapsed time**. A word
reviewed a day early and graded "good" grows as if the full interval had
been served — a systematic over-estimate, small per event and compounding
over a word's life. That is the same failure the quiz-demotion spec
(`2026-08-09`) had to design around, and the reason `demoteWord` changes the
interval itself rather than only the date.

Pushing forward has the mirror property and it is the safe one: the word is
reviewed a day *late*, `intervalDays` is unchanged, so the next interval is
computed as if slightly *less* time had been served than really was. It
under-estimates, which is conservative. The user was shown this and chose
forward-only.

**`intervalDays` is deliberately not bumped along with `due`.** Adding the
nudge to the interval would compound through `next = intervalDays * ease` at
every future review; leaving it alone keeps the nudge a one-off shift of a
single date. This is the exact mirror of the demotion rule in CLAUDE.md
("never pull `due` forward while leaving `intervalDays` alone") — here we
push `due` back while leaving `intervalDays` alone, and the asymmetry is the
whole point, not an oversight.

### Floor: no nudge below a 3-day interval

The same threshold `fuzz()` already uses, for the same reason: at 1–2 days
the word is in rapid consolidation and a day's delay is a 50–100% change.
Above 3 days a 1-day push is ≤33% and falls fast. This also keeps the nudge
out of the learning steps and the lapse path (`again` sets `due = today`,
interval 0) without a special case.

### Gap of 5 in the session pass

Measured over the next 30 simulated sessions, counting related pairs that
land within 5 positions of each other:

| gap | sessions with a close pair | pairs | max usageScore crossed |
|---|---|---|---|
| 0 (today) | 6 | 7 | — |
| 3 | 6 | 7 | 1 |
| **5** | **2** | **2** | **1** |
| 8 | 2 | 2 | 1 |
| 10 | 2 | 2 | 1 |

5 is the smallest gap that helps and 8 and 10 buy nothing further. The 2
that remain are sessions too small to separate anything — the pass fails
open rather than dropping or duplicating a word, exactly as
`orderFreshWords` does. The largest `usageScore` a deferred word crosses is
**1 point**, matching what the intake spec measured for the same pass.

### Relatedness: declared links and shared stem, not capture adjacency

`orderFreshWords` counts three things as related: a declared
synonym/antonym/relatedForm link, a shared stem, and **adjacency within 3
positions in `words.json`** (capture order — the intake pool is one synonym
walk, so neighbours really are related).

The review population is not a capture batch, and that third rule is noise
over it: of 80 same-day pairs it flags, **64 are capture-adjacency only**,
and they are pairs like `angular | canonicalization`, `petulant |
rapturous`, `rhetoric | zenith`. The review side therefore uses declared
links + shared stem only. `freshOrder` keeps all three.

## Rejected alternatives

- **Session ordering alone.** Zero scheduler risk, but the two words still
  arrive on the same day; the user asked for the dates to move.
- **±1 day.** The user's original wording. Rejected on the `71fba29`
  argument above, with the user's agreement.
- **Repairing every existing collision.** The user kept today's two
  (`repulsive|revolting`, `effortful|laborious`) — they are already in
  today's session — and asked for the other 14 to be moved.

## Shape

New `src/lib/related.ts` holds what both sides now share: `sharesStem`,
`declaredLinks`, and the greedy `spaceApart` pass. `freshOrder.ts` imports
them and keeps its capture-window rule; its own tests are the check that the
extraction changed no behavior.

`gradeWord` and `previewIntervals` take one new optional argument,
`dueTaken?: (due: string) => boolean`. The scheduler stays ignorant of the
word list and of `Progress` — the caller supplies the predicate. Omitted, it
behaves exactly as before, which is what keeps every existing test honest.

The preview under the grade buttons takes the same predicate, so the label
never promises a date the write will not produce.
