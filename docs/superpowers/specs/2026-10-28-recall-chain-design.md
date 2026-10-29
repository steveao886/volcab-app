# 顺着这串练 — a 发散 question opened from a 回想 miss

## Why

The user reported words that keep failing in 回想 even after 要多考. Measured
on the live progress the same day: 604 words have a 回想 record, 108 were
missed twice or more, and about 60 fail persistently (missed ≥2 with the
streak at 0, or under 50% over ≥3 reps). Those 60 are not weak in /review —
their median interval is 22 days. Recognition is fine; production is not.

What the user described, in order:

1. On the reveal the answer felt **unconnected** to the Chinese, not "on the
   tip of my tongue".
2. Even the English definition did not bridge it. `impair`'s gloss literally
   reads 削弱 and its 回想 record is 2/2, yet on 削弱判断力 it did not come at
   all — the record was earned by recognising it among four options.
3. What does come is the plain word: 削弱 → `weaken`, and translation stops
   there because weaken is right. Showing `weaken` as a stepping stone was
   rejected: "我本来也会想起来,但是没有别的词的链接,或者链接还不通".
4. 发散 has made a word "click" for them before.

So the remedy is not more exposure to the same question (要多考, the miss
streak weight and 巩固 all do that) but walking the path from the plain word
to its neighbours — which is what a 发散 近义 question is.

## What

On a 回想 miss, when the answer word belongs to a 发散 concept, the reveal's
ruled row gains a third button, 顺着这串练. Pressing it replaces the card
with that concept's 近义 question; finishing it moves on to the next 回想
question. **A button, not automatic** — the user's choice: a 50-question
round with eight or nine misses would grow too long.

`chainFor` and `chainCredit` in `src/lib/diverge.ts` decide everything; the
page paints.

## Calls made without asking (the user said build it, then report)

- **Only the 近义 axis.** 反面 and 否定前缀 lead away from the missed word.
- **Smallest set wins** when the word sits in several concepts, ties by id —
  the detour is mid-round, and a shorter one gives the round back sooner.
- **No credit for anything the 回想 card printed** — the answer and every
  option. Typing a word seen seconds earlier is short-term recall, which
  `grade` already refuses to credit. A set made entirely of on-screen words is
  not offered at all.
- **Writes are 发散's, minus `recordDiverge` and the recency list.** Produced
  answers go through `recordRecall` (reward only), 这个我真不会 through
  `recordPractice(id, false)`. `recordDiverge` is the 发散 round record and a
  detour is not a round; leaving the recency list alone keeps the question
  free to come back in the next 发散 round, which is the spaced re-test.
  Nothing here reaches `srs.ts`.
- **Once per concept per round.** A second miss in the same concept shows the
  button disabled as 这串本轮练过了.
- **Concepts load in 回想 without gating it.** If `concepts.json` fails the
  button simply never appears.
- Only `RecallSession` offers it. /untangle's end-screen questions reuse
  `RecallQuestionView` and do not.

## Coverage at ship (live library, 2026-10-28)

1,052 learned words, 297 reachable through a chain. Of the 60 persistent
misses, **21**; of the 260 words missed in 回想 at least once, **91**. Chain
size median 4, max 10. `impair` — the user's own example — has none, because
no concept is anchored on `weaken`.

## Not done, deliberately

- **Content.** The other 39 persistent misses need concepts authored around
  the plain words they hang off (weaken, worsen, scheme, complain, …): 353
  synonym strings are shared by three or more words, 150 of them already
  anchors. That is a content round under the concept rules in CLAUDE.md
  (prompt is the members' intersection; check excludes and opposites).
- **Weighting 发散's own draw toward 回想 misses.** Proposed and not chosen —
  the user picked the in-the-moment version.

## Failure conditions

- If the user reports the detour credited a word they had just seen, the
  on-screen exclusion is wrong.
- If chains routinely open on a concept about a different sense of the missed
  word (the antonym/synonym homograph disease), the concept needs an
  `exclude`, not this code.
