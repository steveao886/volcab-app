# Review Interval Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each of the four grade buttons on the review page shows the interval it would schedule (稍后 / 12 天 / …), computed by the real scheduler.

**Architecture:** A pure `previewIntervals()` in `src/lib/srs.ts` runs `gradeWord()` per grade with `rng: () => 0.5` (fuzz factor exactly 1 → deterministic). `Review.tsx` renders the strings only in `mode === 'due'` — drill grades don't reschedule, so a preview there would lie.

**Tech Stack:** TypeScript, vitest. Read `CLAUDE.md` and `docs/superpowers/specs/2026-08-07-review-interval-preview-design.md` first.

**Repo rules that bite here:** `gradeWord` semantics are frozen — additive change only. Comments explain why with evidence. UI strings Chinese. UI gets no component tests; all logic goes in `src/lib/`.

---

### Task 1: `previewIntervals` in srs.ts

**Files:**
- Modify: `src/lib/srs.ts` (append)
- Test: `src/lib/srs.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/srs.test.ts` (reuse existing fixtures/imports where present — the file already imports from `./srs`; add `previewIntervals` to that import):

```ts
describe('previewIntervals', () => {
  // Local 2026-08-07 09:00. todayStr(NOW) === '2026-08-07'.
  const NOW = new Date(2026, 7, 7, 9, 0, 0)

  const reviewEntry = (over: Partial<ProgressEntry> = {}): ProgressEntry => ({
    state: 'review', ease: 2.5, intervalDays: 10, due: '2026-08-07', stepIndex: 0,
    reps: 5, lapses: 0, lastReviewedAt: '2026-08-01T08:00:00.000Z', ...over,
  })

  it('new card: everything same-day reads 稍后, easy graduates at 4 days', () => {
    expect(previewIntervals(undefined, NOW)).toEqual({
      again: '稍后', hard: '稍后', good: '稍后', easy: '4 天',
    })
  })

  it('last learning step: good graduates at 1 day', () => {
    const e = reviewEntry({ state: 'learning', stepIndex: 1, intervalDays: 0 })
    expect(previewIntervals(e, NOW).good).toBe('1 天')
  })

  it('review card at interval 10, ease 2.5: hand-computed SM-2 results', () => {
    // hard: 10×1.2=12 → 12 天; good: 10×2.5=25 → 25 天;
    // easy: ease→2.65, 10×2.65×1.3=34.45 → round 34 → 34 天; again relearns today.
    expect(previewIntervals(reviewEntry(), NOW)).toEqual({
      again: '稍后', hard: '12 天', good: '25 天', easy: '34 天',
    })
  })

  it('applies the interval modifier the same way the real grade does', () => {
    // good: round(25 × 1.3) = 33 → 33 天
    expect(previewIntervals(reviewEntry(), NOW, 1.3).good).toBe('33 天')
  })

  it('caps at MAX_INTERVAL_DAYS', () => {
    // good: 300×2.5=750 → capped 365
    expect(previewIntervals(reviewEntry({ intervalDays: 300 }), NOW).good).toBe('365 天')
  })

  it('never mutates the entry it previews', () => {
    const e = reviewEntry()
    const before = { ...e }
    previewIntervals(e, NOW)
    expect(e).toEqual(before)
  })
})
```

If the test file doesn't already import `ProgressEntry`, add `import type { ProgressEntry } from '../types'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/srs.test.ts`
Expected: FAIL — `previewIntervals` is not exported.

- [ ] **Step 3: Implement in `src/lib/srs.ts`** (append at end of file)

```ts
/** Calendar-day difference between two YYYY-MM-DD strings, parsed as local dates (same convention as addDays). */
function diffDays(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return Math.round((new Date(ty, tm - 1, td).getTime() - new Date(fy, fm - 1, fd).getTime()) / 86400_000)
}

/**
 * What each grade would do to this card's schedule, as printable labels,
 * for the review page to show under the four grade buttons — grading
 * stops being a feeling and becomes choosing a consequence.
 *
 * Runs the real scheduler per grade: hardcoded numbers would print
 * intervals gradeWord never produces, and a wrong preview is worse than
 * none. The fixed rng of 0.5 makes fuzz's factor exactly 1, so the
 * preview shows the unfuzzed interval while the actual write still
 * fuzzes ±5% — off by at most ±5% beyond 3 days, deterministic enough
 * to test.
 *
 * Every same-day outcome reads 稍后: learning steps and lapses requeue
 * within the session by queue position, not by clock (see
 * LEARNING_STEPS), so a minutes figure would be an invention.
 *
 * Labels stay in days all the way to 365 天 — converting to 月/年 would
 * round away exactly the magnitude this exists to show.
 */
export function previewIntervals(
  prev: ProgressEntry | undefined,
  now: Date,
  intervalModifier = 1,
): Record<Grade, string> {
  const today = todayStr(now)
  const out = {} as Record<Grade, string>
  for (const g of ['again', 'hard', 'good', 'easy'] as const) {
    // gradeWord copies before mutating, so prev itself is never touched.
    const next = gradeWord(prev, g, now, () => 0.5, intervalModifier)
    out[g] = next.due <= today ? '稍后' : `${diffDays(today, next.due)} 天`
  }
  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/srs.test.ts`
Expected: PASS, including the pre-existing suite.

- [ ] **Step 5: Commit**

```bash
git add src/lib/srs.ts src/lib/srs.test.ts
git commit -m "feat(srs): interval preview runs the real scheduler with fuzz pinned to 1"
```

---

### Task 2: Render the preview under the grade buttons

**Files:**
- Modify: `src/pages/Review.tsx`
- Modify: `src/pages/Review.css`

- [ ] **Step 1: Compute previews in Review.tsx**

Add to the import from `../lib/srs` (currently `{ todayStr }`): `previewIntervals`.

After the `const flipped = …` / `const finished = …` block, add:

```tsx
  // Only the scheduled review shows interval previews. Drill grades
  // deliberately don't reschedule (recordLapseDrill / recordConsolidation),
  // so printing an interval there would lie about what the button does —
  // the drill note above the card already explains the difference.
  const previews = useMemo(
    () =>
      mode === 'due' && curId !== undefined
        ? previewIntervals(curEntry, new Date(), progress.settings.intervalModifier)
        : null,
    [mode, curId, curEntry, progress.settings.intervalModifier],
  )
```

(`useMemo` is already imported. `intervalModifier` may be undefined — `previewIntervals` defaults it to 1 and `gradeWord` clamps, the same path the real grade takes via store.tsx.)

- [ ] **Step 2: Restructure the four grade buttons**

Replace the `.review-grades` block's four buttons:

```tsx
          <div className="review-grades">
            <Button variant="grade-again" onClick={() => handleGrade('again')}>
              <span className="review-grade__label">
                重来<span className="review-grade__key">1</span>
              </span>
              {previews !== null && <span className="num review-grade__interval">{previews.again}</span>}
            </Button>
            <Button variant="grade-hard" onClick={() => handleGrade('hard')}>
              <span className="review-grade__label">
                困难<span className="review-grade__key">2</span>
              </span>
              {previews !== null && <span className="num review-grade__interval">{previews.hard}</span>}
            </Button>
            <Button variant="grade-good" onClick={() => handleGrade('good')}>
              <span className="review-grade__label">
                良好<span className="review-grade__key">3</span>
              </span>
              {previews !== null && <span className="num review-grade__interval">{previews.good}</span>}
            </Button>
            <Button variant="grade-easy" onClick={() => handleGrade('easy')}>
              <span className="review-grade__label">
                简单<span className="review-grade__key">4</span>
              </span>
              {previews !== null && <span className="num review-grade__interval">{previews.easy}</span>}
            </Button>
          </div>
```

- [ ] **Step 3: Stack the button content in Review.css**

In the `.review-grades .btn` rule, add column stacking; add the two new classes after `.review-grade__key`:

```css
.review-grades .btn {
  padding-inline: var(--sp-2);
  flex-direction: column;
  gap: 2px;
}

/* Label + number key stay on one line inside the stacked button. */
.review-grade__label {
  display: inline-flex;
  align-items: baseline;
  gap: var(--sp-1);
}

/* The consequence line. Inherits the grade's tone color (and the hover
   inversion) instead of the faint gray of the key hint — it's information
   about the action, not chrome. In drill modes it's absent and the
   buttons render exactly as before. */
.review-grade__interval {
  font-size: var(--fs-eyebrow);
  font-weight: 400;
  letter-spacing: 0;
  color: inherit;
  opacity: 0.8;
}
```

Also: `.review-grade__key` currently uses `margin-inline-start: var(--sp-1)` — the new flex `gap` on `.review-grade__label` covers that spacing; remove the margin from `.review-grade__key` so it doesn't double up.

- [ ] **Step 4: Full gate**

Run: `npm test` then `npx oxlint` then `npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Review.tsx src/pages/Review.css
git commit -m "feat(review): grade buttons print their consequence — drills stay silent on purpose"
```

---

## Self-review checklist (run before finishing)

- Preview strings come only from `previewIntervals` (no hardcoded
  intervals anywhere in the render layer).
- Drill modes (`lapses` / `consolidate`) show no second line; the buttons
  there look exactly as before this change.
- Keyboard shortcuts 1–4 and the flip-then-grade flow untouched.
- 375px: four two-line buttons still fit one row (`padding-inline` stays
  `--sp-2`; label text is two CJK chars + one digit; interval line is at
  most "365 天").
- Hand-computed expectations in tests match srs.ts math (hard ×1.2,
  good ×ease, easy ×ease×1.3 after +0.15, min +1 day growth, cap 365,
  fuzz factor 1 at rng 0.5).
