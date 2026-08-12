# Plan — 回想 提示层 + 碰撞簇补题

Spec: `docs/superpowers/specs/2026-08-12-recall-hint-tier-design.md`

Two commits, in this order. The feature ships first because the content
batch is authored against a schema the feature introduces (`sense`).

---

## Commit 1 — the hint tier

### 1. `src/lib/senseGroup.ts`

- `SenseGroup` gains `sense?: number`, documented as an index into the
  **answer word's** `meanings`, defaulting to 0.
- `RecallQuestion` gains `hint?: string`.
- New pure helper `hintFor(word, sense)`: returns
  `word.meanings[sense ?? 0]?.en` and falls back to `meanings[0]?.en` when
  the index is out of range; `undefined` when neither is a non-empty string.
- `buildRecallQuestion` fills `hint`. `buildOrderQuestion` does not — 排序
  never gets one.

### 2. `src/lib/senseGroup.test.ts`

Written first, per test-driven-development:

- named sense resolves to that sense's `en`
- absent `sense` resolves to `meanings[0].en`
- out-of-range `sense` falls back to `meanings[0].en` rather than throwing
- a word whose meanings carry no usable `en` yields `hint === undefined`
- `buildOrderQuestion` output has no `hint`

### 3. `scripts/validate-sense-groups.ts`

When `sense` is present: integer, `>= 0`, `< order[0]`'s `meanings.length`.
Error, not a warning — a dangling index is the class of thing the content
validators already hard-fail on.

### 4. `src/pages/QuizRecall.tsx`

- `Stage` gains `'hint'`.
- `Miss` becomes `'blank' | 'other' | 'hint-hit' | 'hint-miss'`.
- Commit gate: `想不起来` routes to `'hint'` when
  `question.kind === 'recall' && question.hint !== undefined`; otherwise it
  settles `blank` exactly as today.
- Hint stage: label `想不起来?先看它的英文释义,再想一次`, the definition in
  `lang="en"`, then the same two buttons. `我想好了` → `'answer'` with a
  `hintedRef` set; `想不起来` → settle `blank`.
- `settle` takes the pick and, when `hintedRef.current`, scores false and
  classifies `hint-hit` / `hint-miss` by whether the pick matched the key.
- Option rendering is untouched: it already keys off `question.answer` and
  `picked`, not off `correct`, so the right word still renders as 正确答案.
- Feedback line per the spec's table.
- Focus: the hint card focuses its own `我想好了`, same as the commit gate.

### 5. `src/pages/Quiz.css`

One rule for `.recall-hint` — the definition block. Ink on paper, no
vermilion (it is not an annotation and not destructive).

### 6. Results list

Two new tags, 提示后想起 / 提示后仍错, alongside the existing two.

### Gate

`npm test && npm run build && npx oxlint && npm run validate-sense-groups`

---

## Commit 2 — collision-cluster groups

### 1. Mine the clusters

Script in scratch: group words by shared Chinese gloss fragment, drop
domain/register markers (`医学`, `法律`, `正式`, `书面`, `口语`, `情绪等`, …)
and any fragment shorter than 2 characters. Print each surviving cluster
with its members, their POS, their `en` definitions and one example
sentence each.

### 2. Author

One group per cluster, adapted from a member's real example sentence:

- same-POS members only — a cluster spanning POS is split or dropped
- 3+ members and a defensible ranking → 排序-capable group with the full
  `order`
- 2 members, or a third whose rank is arguable → 2-member `order` plus one
  outside distractor
- **no defensible best member → skip the cluster.** Recorded in the commit
  message with the count, so a later session knows it was decided, not missed.

### 3. Gate

`npm run validate-sense-groups` (coverage line), then
`npx tsx scripts/content-staleness.ts` to confirm the anchor backlog moved,
then the full `npm test && npm run build && npx oxlint`.
