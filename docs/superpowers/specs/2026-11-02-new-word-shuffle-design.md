# New words in a stable shuffle, with word families two weeks apart

**Date:** 2026-11-02
**Status:** approved (asked for by the user; the 14-day window chosen from the replay below)

Follow-up to `2026-09-03-new-word-spacing-design.md` and
`2026-10-01-new-word-day-spacing-design.md`.

## Problem

The user, verbatim: 每天的新词里怎么好像都是按近期加入的顺序排的,这个不对,我觉得
应该随机;同时避免同词根的不同词性的排到一起,这种应该尽量隔开.

Both halves were real, and neither was the bug it looked like.

1. **Not capture order, but close to it.** The queue was sorted by `usageScore`,
   high to low, with a hash tiebreak. The user captures what they are reading now,
   and drafted entries score those words 6–9, while the backlog mostly scores 4–5
   (of 550 unlearned words on 2026-11-02: 2 at 7, 45 at 6, 266 at 5, 150 at 4). So
   each capture batch was served ahead of everything older — every word started
   2026-10-30 and 10-31, and 11 of 12 on 11-01, came from indices 1549–1662, the
   batch added 10-29.
2. **Families were held apart three days, not more.** `LOOKBACK_DAYS` = 3 counts a
   shared stem the same as a synonym. Replaying live progress, the user's last week
   held `empower` (10-27) / `empowering` (11-02), `delight` / `delighted`,
   `bureaucratic` / `bureaucrat`, `marked` / `markedly` — four to six days apart,
   which reads as the same word met twice in one week.

## Decision

1. **Order by the id hash alone.** `usageScore` no longer decides who is learned
   first. A hash rather than `Math.random`, for the reasons already written on
   `hash()` in `freshOrder.ts`: Today and Review must agree, and so must two devices.
   A new word lands at a random place in the queue and stays there.
2. **A word family is its own, longer lookback.** Family = `sharesStem` or a
   `relatedForms` link in either direction (`vain` / `vanity` share no stem). A
   word whose family member was started in the last `FAMILY_LOOKBACK_DAYS` = 14 is
   passed over while anything else within `LOOKAHEAD` fits.
3. **And off the whole day.** Inside one day's ordering the spacing gap is
   `min(newPerDay, 10)` slots, so at `newPerDay` 12 two family members could land
   in slots 0 and 11. `spaceApart`'s `blocked` predicate now also receives the
   picks made so far, and the family rule checks all of them.
4. Synonyms, antonyms and confusable pairs keep the 3-day window — the request was
   about families, and those were measured on their own (10-01 spec).

Fails open exactly as before: the pass never drops a word or shortens a day.

## Measured

Replayed `buildQueue`'s ordering day by day from 2026-11-03 over the live library
with the 2026-11-02 batch (1766 words, 654 unlearned, `newPerDay` 12, 46 days),
counting family pairs by how many days apart they start:

| | family pairs ≤ 14 days apart | words started later than hash order | median / worst delay |
|---|---|---|---|
| before (score order, 3-day lookback) | 47 | — | — |
| family lookback 7 | 15 at day 8, 16 more by day 14 | 51 | 2 / 8 days |
| **family lookback 14** | **0** | **56** | **3 / 16 days** |
| family lookback 21 | 0 | 55 | 4 / 22 days |

Before, the pairs sat exactly on the old window's edge: 21 of the 47 four days
apart (`tempting` / `tempt`, `worsen` / `worsening`, `substantially` /
`substantial`; `constitute` / `constitution` five). At 14 the pile moves to day 15 (25
pairs) and nothing is closer. 30, tried on the pre-batch library, starts failing
open (pairs back at 11 and 13 days).

Randomness: the first replayed week's 84 new words held 41 from the latest 114
added under the score order and 24 under the hash, against a 17% share of the pool
(111 of 654). Still above share — the backlog is where older family members and
recent relatives sit, so it is blocked more often — but no longer a capture batch
served first.

## What it costs

`usageScore` stops buying anything at intake: a 2-point word is now as likely to be
learned today as an 8-point one. The intake bar is already C1/C2 and 76% of the
pre-batch backlog scores 4–5 (416 of 550), so the spread it was choosing between is narrow; the user asked
for random over that.
