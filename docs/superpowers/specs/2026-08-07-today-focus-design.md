# Today Page: Focus Hero + Day Plan (sketch 001, winner A)

## What is being built

The Today page currently shows three equal-weight cards (stats / progress
bar / action buttons) plus a 7-day bar chart. None of them answers "what
should I do right now". This rebuild gives the page one job:

1. **Hero card** — one adaptive "do this now" action with a large count
   and a single primary button.
2. **Day plan card** — the day's tasks as a list with auto-derived states
   (todo / done / pending), each row an entry point.
3. **Footer stat line** — streak, overall progress, and 7-day accuracy
   compressed into one line, linking to /stats.

The sync badge and the full-sentence sync-error note are unchanged.

## Tradeoffs and decisions

**Plan states are derived from data, never toggled by hand.** The mock's
tap-to-check rows were demo sugar. A checkbox the user can flip records
nothing and lies the moment sync updates the queue. Every row's state
falls out of the same functions the review page already uses
(`buildQueue`, `buildConsolidateQueue`, `buildLapseQueue`,
`rankStrugglingWords`) plus the two existing local markers
(`lapseDrilledOn`, `consolidatedOn`) and `dailyStats[today]`. If the row
and the review page ever disagree about a count, one of them is lying —
so the row must call the same code.

**Hero priority: review → consolidate → lapses → complete.** The quiz row
never becomes the hero: it is labeled 可选 in the plan, and promoting an
optional task to "现在该做" would contradict the label. When everything
above it is done, the hero says 今日完成 🎉.

**The hero number is due + fresh combined** (one review session covers
both), with the split shown in the meta line (`到期 X · 新词 Y`). No
"预计 N 分钟" estimate: there is no measured per-card time to base it on,
and an invented number is worse than none (fail closed over guessing).

**The 7-day bar chart is removed, not relocated.** It existed as the entry
point to /stats when stats had no tab slot; stats has had its own tab
since the five-slot bar bar (see TabBar.tsx). The footer line keeps a
compressed summary and remains a link to /stats, so the entry point
survives at lower cost.

**Consolidation gets a visible "pending" state.** Today the entry point
simply doesn't exist until 3 hours after learning, which reads as "the
feature is gone". The plan row shows 学完 N 小时后出现 when words learned
today are still inside the fade window — same filter as
`buildConsolidateQueue` with the time test inverted.

**已学 N hint on the new-words row.** `fresh.length` only shows what's
left; after finishing, "done" with no number would erase the morning's
work. `dailyStats[today].newLearned` supplies the accomplished half.

## Non-goals

- No changes to Review, queue building, or SRS.
- No new synced fields; the two local markers stay local.
- No manual plan editing or reordering.

## Where logic lives

All derivation is pure and testable in `src/pages/todayPlan.ts`
(colocated with `todayStats.ts`, same precedent), with tests in
`todayPlan.test.ts`. `Today.tsx` stays a thin render layer — UI gets no
component tests.
