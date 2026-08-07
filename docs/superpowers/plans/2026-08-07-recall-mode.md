# 回想 mode — implementation plan

Spec: `docs/superpowers/specs/2026-08-07-recall-mode-design.md`

Tasks, in commit order; each lands green (`npm test`, `npx oxlint`,
`npm run build`) before the next starts.

1. **Pure layer.** `src/lib/senseGroup.ts` + colocated tests: file types,
   `eligibleGroups` (every member learned and present), `buildRecallQuestion`
   (唤词: answer `order[0]`, distractors = rest of group + same-POS fillers,
   never leaking the answer twice), `buildOrderQuestion` (排序),
   `orderVerdict` (exact match), `wrongIdsFor` (pick+answer /
   answer-only / misplaced-only), all rng-injected.
2. **Content + gate.** Merge the three authored slices into
   `src/data/senseGroups.json`; write `scripts/validate-sense-groups.ts`
   (ids exist in `data/words.json`, 2–4 members, same POS, no duplicate ids,
   distinct non-empty `zh` ≤40 chars with zero Latin letters, non-empty
   `why`); add `npm run validate-sense-groups`; run it and fix or drop any
   entry it rejects. Fail closed: a dropped group is fine, a leaky one is not.
3. **Recency.** `src/lib/recency.ts` + tests: localStorage-backed seen-set
   with injected storage, capped; `demoteSeen(items, key, seen)` stable-sorts
   unseen before seen without excluding anything.
4. **Store.** `consolidateWord(id)` in `src/state/store.tsx`: due → today,
   `lapses + 1`, `lastReviewedAt` stamped, **no dailyStats write** (the
   difference from `practiceGrade`, see spec). Store tests in
   `store.test.tsx` cover: entry updated, stats untouched, missing id no-op.
5. **Page.** `QuizRecall.tsx` + `.recall-*` CSS: commit gate (我想好了 /
   想不起来), both question views (tap-to-order with ①②③ stamps and
   un-tap), reveal with `why`, settlement through `recordQuiz`, 巩固 button
   per wrong word on results. Wire into `Quiz.tsx`: sixth chip 回想,
   `EMPTY_HINT.recall`, lazy `import()` of senseGroups.json like passages.
   Verify in the browser preview at 375px, six chips included.
6. **Skill + scheduled refresh.** `.claude/skills/word-content/SKILL.md`
   carrying the audited add-a-word checklist (from the 2026-08-07 audit:
   repo `data/words.json` updates *before* notes are authored; new-pair
   computation only valid in batch; five manual validators) plus the
   monthly top-up procedure; then a local scheduled task with
   catch-up-on-missed-run semantics that invokes it.
7. **Rotation wiring for the older modes** — separate follow-up, driven by
   the repetition audit's numbers; not part of this plan's exit criteria.
