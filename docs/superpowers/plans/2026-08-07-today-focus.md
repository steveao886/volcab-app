# Today Page Focus Hero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Today page around one adaptive "do this now" hero, an auto-derived day-plan list, and a one-line stat footer.

**Architecture:** All derivation lives in a new pure module `src/pages/todayPlan.ts` (tested); `Today.tsx` becomes a thin render layer. Plan states come from the same queue functions the review page uses, so the two can never disagree.

**Tech Stack:** React 19 + TypeScript, vitest, plain CSS. Read `CLAUDE.md` and `docs/superpowers/specs/2026-08-07-today-focus-design.md` first.

**Repo rules that bite here:** `noUnusedLocals` fails the build on any unused import. UI strings are Chinese; comments/code English. UI gets no component tests. Run `npm run build` (tsc -b + vite), not `tsc` alone.

---

### Task 1: `todayPlan.ts` — pure plan derivation

**Files:**
- Create: `src/pages/todayPlan.ts`
- Test: `src/pages/todayPlan.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/pages/todayPlan.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildDayPlan, nextAction } from './todayPlan'
import type { PlanItem } from './todayPlan'
import { emptyProgress, emptyStat } from '../types'
import type { Progress, ProgressEntry, Word } from '../types'

const word = (id: string): Word => ({
  id, headword: id, phonetic: '/x/', meanings: [{ pos: 'n.', en: 'x', zh: 'x' }],
  examples: [], synonyms: [], antonyms: [], collocations: [], relatedForms: [],
  sourceNote: 'manual', addedAt: '2026-08-01',
})

const entry = (over: Partial<ProgressEntry>): ProgressEntry => ({
  state: 'review', ease: 2.5, intervalDays: 5, due: '2026-09-01', stepIndex: 0,
  reps: 3, lapses: 0, lastReviewedAt: '2026-08-01T08:00:00.000Z', ...over,
})

const TODAY = '2026-08-07'
// 21:00 local — safely past the 3-hour consolidation window for anything learned in the morning
const NOW = new Date(2026, 7, 7, 21, 0, 0)
const NO_MARKS = { lapseDrilledOn: null, consolidatedOn: null }

const find = (plan: PlanItem[], key: string) => plan.find(p => p.key === key)

describe('buildDayPlan', () => {
  it('due row: todo with count while words are due, done at zero', () => {
    const words = [word('a'), word('b')]
    const p: Progress = { ...emptyProgress(), words: {
      a: entry({ due: TODAY }),
      b: entry({ due: '2026-09-01' }),
    } }
    p.settings.newPerDay = 0
    const plan = buildDayPlan(words, p, NOW, TODAY, NO_MARKS)
    expect(find(plan, 'due')).toMatchObject({ state: 'todo', count: 1, to: '/review' })

    p.words.a = entry({ due: '2026-09-01' })
    expect(find(buildDayPlan(words, p, NOW, TODAY, NO_MARKS), 'due')).toMatchObject({ state: 'done', count: 0 })
  })

  it('fresh row: counts budgeted new words and hints at what was already learned', () => {
    const words = [word('a'), word('b'), word('c')]
    const p = emptyProgress()
    p.settings.newPerDay = 2
    p.dailyStats[TODAY] = { ...emptyStat(), newLearned: 1 }
    const row = find(buildDayPlan(words, p, NOW, TODAY, NO_MARKS), 'fresh')
    // budget 2 - learned 1 = 1 slot left
    expect(row).toMatchObject({ state: 'todo', count: 1, hint: '已学 1' })
  })

  it('consolidate row: todo when a word learned this morning has faded past the window', () => {
    const words = [word('a')]
    const p = emptyProgress()
    // learned at 09:00 local today, interval within the fragile band
    p.words.a = entry({ state: 'learning', intervalDays: 0, due: TODAY,
      lastReviewedAt: new Date(2026, 7, 7, 9, 0, 0).toISOString() })
    p.settings.newPerDay = 0
    const row = find(buildDayPlan(words, p, NOW, TODAY, NO_MARKS), 'consolidate')
    expect(row).toMatchObject({ state: 'todo', count: 1, to: '/review?mode=consolidate' })
  })

  it('consolidate row: pending while today\'s words are still inside the 3-hour window', () => {
    const words = [word('a')]
    const p = emptyProgress()
    p.settings.newPerDay = 0
    // learned 30 minutes before NOW
    p.words.a = entry({ state: 'learning', intervalDays: 0, due: TODAY,
      lastReviewedAt: new Date(2026, 7, 7, 20, 30, 0).toISOString() })
    const row = find(buildDayPlan(words, p, NOW, TODAY, NO_MARKS), 'consolidate')
    expect(row?.state).toBe('pending')
  })

  it('consolidate row: done when today\'s marker is set, hidden when nothing was learned today', () => {
    const words = [word('a')]
    const p = emptyProgress()
    p.settings.newPerDay = 0
    p.words.a = entry({ state: 'learning', intervalDays: 0, due: TODAY,
      lastReviewedAt: new Date(2026, 7, 7, 9, 0, 0).toISOString() })
    const done = buildDayPlan(words, p, NOW, TODAY, { ...NO_MARKS, consolidatedOn: TODAY })
    expect(find(done, 'consolidate')?.state).toBe('done')

    const idle = emptyProgress()
    idle.settings.newPerDay = 0
    expect(find(buildDayPlan([], idle, NOW, TODAY, NO_MARKS), 'consolidate')).toBeUndefined()
  })

  it('lapses row: todo with queue size, done when drilled today, hidden with no struggling words', () => {
    const words = [word('a')]
    const p = emptyProgress()
    p.settings.newPerDay = 0
    // ease below initial and immature → struggling; last reviewed yesterday → drillable
    p.words.a = entry({ ease: 2.1, intervalDays: 3, lastReviewedAt: '2026-08-06T08:00:00.000Z' })
    expect(find(buildDayPlan(words, p, NOW, TODAY, NO_MARKS), 'lapses'))
      .toMatchObject({ state: 'todo', count: 1 })
    expect(find(buildDayPlan(words, p, NOW, TODAY, { ...NO_MARKS, lapseDrilledOn: TODAY }), 'lapses')?.state)
      .toBe('done')

    const healthy = emptyProgress()
    healthy.settings.newPerDay = 0
    healthy.words.a = entry({})
    expect(find(buildDayPlan(words, healthy, NOW, TODAY, NO_MARKS), 'lapses')).toBeUndefined()
  })

  it('lapses row: done (not hidden) when every struggling word was already reviewed today', () => {
    const words = [word('a')]
    const p = emptyProgress()
    p.settings.newPerDay = 0
    p.words.a = entry({ ease: 2.1, intervalDays: 3,
      lastReviewedAt: new Date(2026, 7, 7, 9, 0, 0).toISOString() })
    expect(find(buildDayPlan(words, p, NOW, TODAY, NO_MARKS), 'lapses')?.state).toBe('done')
  })

  it('quiz row: always present, done once any quiz was taken today', () => {
    const p = emptyProgress()
    p.settings.newPerDay = 0
    expect(find(buildDayPlan([], p, NOW, TODAY, NO_MARKS), 'quiz'))
      .toMatchObject({ state: 'todo', hint: '可选', to: '/quiz' })
    p.dailyStats[TODAY] = { ...emptyStat(), quizTaken: 1 }
    expect(find(buildDayPlan([], p, NOW, TODAY, NO_MARKS), 'quiz')?.state).toBe('done')
  })
})

describe('nextAction', () => {
  const row = (key: PlanItem['key'], state: PlanItem['state'], count?: number): PlanItem =>
    ({ key, label: 'x', state, count, to: '/x' })

  it('review first: combines due and fresh counts', () => {
    const hero = nextAction([row('due', 'todo', 3), row('fresh', 'todo', 2), row('quiz', 'todo')])
    expect(hero).toMatchObject({ kind: 'review', count: 5, to: '/review' })
  })

  it('falls through review → consolidate → lapses', () => {
    expect(nextAction([row('due', 'done', 0), row('fresh', 'done', 0),
      row('consolidate', 'todo', 4), row('lapses', 'todo', 2), row('quiz', 'todo')]).kind)
      .toBe('consolidate')
    expect(nextAction([row('due', 'done', 0), row('fresh', 'done', 0),
      row('lapses', 'todo', 2), row('quiz', 'todo')]).kind)
      .toBe('lapses')
  })

  it('a pending consolidation is not an action; quiz never becomes the hero', () => {
    expect(nextAction([row('due', 'done', 0), row('fresh', 'done', 0),
      row('consolidate', 'pending'), row('quiz', 'todo')]).kind)
      .toBe('complete')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pages/todayPlan.test.ts`
Expected: FAIL — module `./todayPlan` not found.

- [ ] **Step 3: Implement `src/pages/todayPlan.ts`**

```ts
import {
  buildConsolidateQueue, buildLapseQueue, buildQueue,
  CONSOLIDATE_DELAY_HOURS, CONSOLIDATE_MAX_INTERVAL_DAYS, rankStrugglingWords,
} from '../lib/queue'
import { todayStr } from '../lib/srs'
import type { Progress, Word } from '../types'

export type PlanKey = 'due' | 'fresh' | 'consolidate' | 'lapses' | 'quiz'
export type PlanState = 'todo' | 'done' | 'pending'

export interface PlanItem {
  key: PlanKey
  label: string
  /** Remaining count. Absent on rows where a number would be noise (快速测试). */
  count?: number
  state: PlanState
  to: string
  hint?: string
}

/** The two local done-markers, read from storage by the caller — passed in so this module stays pure and testable. */
export interface LocalMarks { lapseDrilledOn: string | null; consolidatedOn: string | null }

/**
 * The Today page's day plan. Every state is derived from the same queue
 * functions the review page runs — if a row and the page it links to ever
 * printed different numbers, one of them would be lying — plus the two
 * local drill markers and dailyStats[today]. Nothing here is toggled by
 * hand: a checkbox the user could flip records nothing and goes stale the
 * moment sync moves the queue.
 */
export function buildDayPlan(
  words: Word[], progress: Progress, now: Date, today: string, marks: LocalMarks,
): PlanItem[] {
  const q = buildQueue(words, progress, today)
  const stat = progress.dailyStats[today]
  const items: PlanItem[] = []

  items.push({
    key: 'due', label: '复习到期', count: q.due.length,
    state: q.due.length === 0 ? 'done' : 'todo', to: '/review',
  })
  items.push({
    key: 'fresh', label: '学习新词', count: q.fresh.length,
    state: q.fresh.length === 0 ? 'done' : 'todo', to: '/review',
    // fresh.length only says what's left; after the session, "done" with no
    // number would erase the morning's work — newLearned supplies it.
    hint: (stat?.newLearned ?? 0) > 0 ? `已学 ${stat.newLearned}` : undefined,
  })

  if (marks.consolidatedOn === today) {
    items.push({ key: 'consolidate', label: '巩固今天的新词', state: 'done', to: '/review?mode=consolidate' })
  } else {
    const ready = buildConsolidateQueue(words, progress, now, today)
    if (ready.length > 0) {
      items.push({
        key: 'consolidate', label: '巩固今天的新词', count: ready.length,
        state: 'todo', to: '/review?mode=consolidate',
      })
    } else if (hasConsolidationComing(words, progress, now, today)) {
      // Without this state the row simply doesn't exist until three hours
      // after learning, which reads as "the feature is gone".
      items.push({
        key: 'consolidate', label: '巩固今天的新词', state: 'pending',
        to: '/review?mode=consolidate', hint: `学完 ${CONSOLIDATE_DELAY_HOURS} 小时后出现`,
      })
    }
  }

  if (marks.lapseDrilledOn === today) {
    items.push({ key: 'lapses', label: '专攻顽固词', state: 'done', to: '/review?mode=lapses' })
  } else if (rankStrugglingWords(words, progress).length > 0) {
    const lapse = buildLapseQueue(words, progress, today)
    // Queue empty while struggling words exist means they were all already
    // reviewed today — that's "done for today", not "no stubborn words".
    if (lapse.length > 0) {
      items.push({
        key: 'lapses', label: '专攻顽固词', count: lapse.length,
        state: 'todo', to: '/review?mode=lapses',
      })
    } else {
      items.push({ key: 'lapses', label: '专攻顽固词', state: 'done', to: '/review?mode=lapses' })
    }
  }

  items.push({
    key: 'quiz', label: '快速测试一轮', state: (stat?.quizTaken ?? 0) > 0 ? 'done' : 'todo',
    to: '/quiz', hint: '可选',
  })
  return items
}

/**
 * Words learned today still inside the 3-hour fade window. Mirrors
 * buildConsolidateQueue's filter with the time test inverted; if the two
 * drift, the pending row would promise a pass that never opens (or hide
 * one that will).
 */
function hasConsolidationComing(words: Word[], progress: Progress, now: Date, today: string): boolean {
  const readyBefore = now.getTime() - CONSOLIDATE_DELAY_HOURS * 3600_000
  return words.some(w => {
    const e = progress.words[w.id]
    if (!e || e.state === 'new') return false
    if (e.intervalDays > CONSOLIDATE_MAX_INTERVAL_DAYS) return false
    const last = new Date(e.lastReviewedAt)
    return todayStr(last) === today && last.getTime() > readyBefore
  })
}

export type HeroAction =
  | { kind: 'complete' }
  | { kind: 'review' | 'consolidate' | 'lapses'; count: number; unit: string; meta: string; to: string; label: string }

/**
 * The hero card's one action, in priority order review → consolidate →
 * lapses. The quiz row never becomes the hero: the plan labels it 可选,
 * and promoting an optional task to "现在该做" would contradict the label.
 */
export function nextAction(plan: PlanItem[]): HeroAction {
  const get = (k: PlanKey) => plan.find(p => p.key === k)
  const due = get('due'), fresh = get('fresh')
  const dueN = due?.state === 'todo' ? due.count ?? 0 : 0
  const freshN = fresh?.state === 'todo' ? fresh.count ?? 0 : 0
  if (dueN + freshN > 0) {
    return {
      kind: 'review', count: dueN + freshN, unit: '张卡',
      meta: `到期 ${dueN} · 新词 ${freshN}`, to: '/review', label: '开始复习',
    }
  }
  const c = get('consolidate')
  if (c?.state === 'todo') {
    return {
      kind: 'consolidate', count: c.count ?? 0, unit: '个词',
      meta: '今天学的词,趁遗忘前再取一次', to: '/review?mode=consolidate', label: '开始巩固',
    }
  }
  const l = get('lapses')
  if (l?.state === 'todo') {
    return {
      kind: 'lapses', count: l.count ?? 0, unit: '个词',
      meta: '最近最不牢的一批', to: '/review?mode=lapses', label: '专攻顽固词',
    }
  }
  return { kind: 'complete' }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pages/todayPlan.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/pages/todayPlan.ts src/pages/todayPlan.test.ts
git commit -m "feat(today): derive the day plan from the queues the review page already runs"
```

---

### Task 2: Rewrite `Today.tsx` as the thin render layer

**Files:**
- Modify: `src/pages/Today.tsx` (full rewrite)

- [ ] **Step 1: Replace the component**

Replace the entire contents of `src/pages/Today.tsx` with:

```tsx
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Page } from '../components/Page'
import { SyncStatus } from '../components/SyncStatus'
import { todayStr } from '../lib/srs'
import { storage } from '../lib/storage'
import { useApp } from '../state/store'
import { accuracySeries } from './statsDerive'
import { buildDayPlan, nextAction } from './todayPlan'
import type { PlanItem } from './todayPlan'
import { computeStreak, reviewProgress } from './todayStats'
import './Today.css'

const RECENT_DAYS = 7

/**
 * Sketch 001 winner A (see the 2026-08-07 today-focus spec): one adaptive
 * "do this now" hero, an auto-derived day plan, stats compressed to one
 * footer line. The 7-day bar chart is gone — it existed as the entry
 * point to /stats before stats had a tab slot; the footer keeps the link.
 */
export function Today() {
  const { words, progress, syncStatus, syncError, syncNow } = useApp()
  const today = todayStr(new Date())

  // Same memo precedent as before the rebuild: useApp()'s context value is
  // a new object on any provider re-render, and these derivations iterate
  // the whole library — they shouldn't recompute when nothing changed.
  const { plan, hero, streak, count, total } = useMemo(() => {
    const plan = buildDayPlan(words, progress, new Date(), today, {
      lapseDrilledOn: storage.get<string>('lapseDrilledOn'),
      consolidatedOn: storage.get<string>('consolidatedOn'),
    })
    const rp = reviewProgress(words, progress)
    return {
      plan,
      hero: nextAction(plan),
      streak: computeStreak(progress.dailyStats, today),
      count: rp.count,
      total: rp.total,
    }
  }, [words, progress, today])

  // Depends only on [progress, today] — doesn't recompute with library size.
  const weekAccuracy = useMemo(() => {
    const acc = accuracySeries(progress, today, RECENT_DAYS)
      .map(d => d.accuracy)
      .filter((a): a is number => a !== null)
    return acc.length === 0 ? null : acc.reduce((s, a) => s + a, 0) / acc.length
  }, [progress, today])

  return (
    <Page
      eyebrow="Today"
      title="今日"
      actions={<SyncStatus status={syncStatus} onRetry={() => void syncNow()} />}
    >
      {/* The badge only has room for "sync failed"; the sentence the user
          actually needs (§8: export a backup before doing anything else)
          must be spelled out on the screen they open most often. */}
      {syncStatus === 'error' && syncError !== null && (
        <SyncStatus variant="note" status={syncStatus} message={syncError} onRetry={() => void syncNow()} />
      )}

      <section className="card today-hero">
        <p className="today-hero__eyebrow" lang="en">现在该做</p>
        {hero.kind === 'complete' ? (
          <>
            <p className="today-hero__done">今日完成 🎉</p>
            <p className="today-hero__meta muted">复习和巩固都清完了。想加练的话,下面的快速测试随时可以来一轮。</p>
          </>
        ) : (
          <>
            <p className="num today-hero__count">
              {hero.count}
              <span className="today-hero__unit">{hero.unit}</span>
            </p>
            <p className="today-hero__meta muted">{hero.meta}</p>
            <Link to={hero.to} className="btn btn--primary btn--lg btn--block">
              {hero.label}
            </Link>
          </>
        )}
      </section>

      <section className="card today-plan">
        <p className="today-plan__title">今日安排</p>
        <ul className="today-plan__list">
          {plan.map(item => (
            <PlanRow key={item.key} item={item} />
          ))}
        </ul>
      </section>

      <Link to="/stats" className="card card--interactive today-footer">
        <span>
          连续 <span className="num today-footer__accent">{streak}</span> 天
        </span>
        <span>
          总进度 <span className="num">{count}/{total}</span>
        </span>
        <span>
          近 {RECENT_DAYS} 天正确率{' '}
          <span className="num">{weekAccuracy === null ? '暂无' : `${Math.round(weekAccuracy * 100)}%`}</span>
        </span>
      </Link>
    </Page>
  )
}

/** One plan row. Only todo rows navigate; done/pending rows are inert — a link to a page that will say "nothing to do" is a dead end dressed as an action. */
function PlanRow({ item }: { item: PlanItem }) {
  const inner = (
    <>
      {/* State is carried by the glyph + strikethrough, never color alone. */}
      <span className="today-plan__box" role="img" aria-label={item.state === 'done' ? '已完成' : '待完成'}>
        {item.state === 'done' ? '✓' : ''}
      </span>
      <span className="today-plan__name">{item.label}</span>
      {item.hint !== undefined && <span className="today-plan__hint">{item.hint}</span>}
      {item.count !== undefined && item.count > 0 && (
        <span className="num today-plan__count">{item.count}</span>
      )}
    </>
  )
  if (item.state === 'todo') {
    return (
      <li>
        <Link className="today-plan__row today-plan__row--todo" to={item.to}>
          {inner}
        </Link>
      </li>
    )
  }
  return (
    <li>
      <div className={`today-plan__row today-plan__row--${item.state}`}>{inner}</div>
    </li>
  )
}
```

Note: `storage.get<string>('lapseDrilledOn')` — check `src/lib/storage.ts` for the exact return type. If it returns `T | null` the code above is correct as-is; if it returns `T | undefined`, change `LocalMarks` in Task 1 to use `string | undefined` (and `?? null` here) so the types line up. Do NOT cast.

- [ ] **Step 2: Verify the build catches nothing**

Run: `npm run build`
Expected: success. If `noUnusedLocals` complains about removed imports (`Button`, `Card`, `buildQueue`, `buildLapseQueue`, `buildConsolidateQueue`, `dailySeries`), delete the stale imports.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Today.tsx
git commit -m "feat(today): one hero action instead of three equal cards"
```

---

### Task 3: Rewrite `Today.css`

**Files:**
- Modify: `src/pages/Today.css` (full rewrite)

- [ ] **Step 1: Replace the stylesheet**

```css
/* Today (home) page-specific styles — sketch 001 winner A. Three blocks:
   hero (the one action), day plan (auto-derived states), footer stat line.
   The sync badge in the header is the shared SyncStatus (components.css). */

/* --- Hero: the one "do this now" card ----------------------------------- */

.today-hero {
  display: grid;
  gap: var(--sp-3);
}

/* Same visual role as the page eyebrow — one of vermilion's permitted uses. */
.today-hero__eyebrow {
  font-size: var(--fs-eyebrow);
  font-weight: 700;
  letter-spacing: var(--tracking-eyebrow);
  color: var(--accent);
}

.today-hero__count {
  font-size: 3.5rem; /* one-off display size; the type scale tops out at --fs-word-xl, which is a headword size, not a stat size */
  font-weight: 600;
  line-height: 1;
}

.today-hero__unit {
  margin-left: var(--sp-2);
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  font-weight: 600;
  letter-spacing: 0;
  color: var(--text-muted);
}

.today-hero__meta {
  font-size: var(--fs-sm);
}

.today-hero__done {
  font-size: var(--fs-xl);
  font-weight: 700;
}

/* --- Day plan ------------------------------------------------------------- */

.today-plan {
  padding-block: var(--sp-2);
}

.today-plan__title {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--text-muted);
  padding-block: var(--sp-2);
}

.today-plan__list {
  display: grid;
}

.today-plan__row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: var(--tap);
  padding-block: var(--sp-2);
  border-top: 1px solid var(--rule);
  color: inherit;
  text-decoration: none;
}

.today-plan__row--todo:hover {
  background: var(--surface-sunken);
}

.today-plan__box {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex: none;
  border: 1.5px solid var(--rule-control);
  border-radius: var(--r-sm);
  font-size: 14px;
  font-weight: 700;
  color: transparent;
}

.today-plan__row--done .today-plan__box {
  background: var(--success);
  border-color: var(--success);
  color: var(--on-tone);
}

.today-plan__row--pending .today-plan__box {
  border-style: dashed;
}

.today-plan__name {
  flex: 1;
  font-weight: 600;
}

.today-plan__row--done .today-plan__name {
  color: var(--text-faint);
  text-decoration: line-through;
}

.today-plan__row--pending .today-plan__name {
  color: var(--text-faint);
}

/* Count as a vermilion annotation, consistent with the old lapse count. */
.today-plan__count {
  color: var(--accent);
  font-weight: 700;
}

.today-plan__row--done .today-plan__count {
  color: var(--text-faint);
}

.today-plan__hint {
  font-size: var(--fs-xs);
  color: var(--text-faint);
}

/* --- Footer stat line: the /stats entry point ----------------------------- */

.today-footer {
  display: flex;
  justify-content: space-between;
  gap: var(--sp-3);
  flex-wrap: wrap; /* three phrases must never overflow 375px */
  font-size: var(--fs-sm);
  color: var(--text-muted);
}

.today-footer .num {
  color: var(--text);
  font-weight: 600;
}

.today-footer .num.today-footer__accent {
  color: var(--accent);
}
```

- [ ] **Step 2: Full gate**

Run: `npm test` then `npx oxlint` then `npm run build`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Today.css
git commit -m "feat(today): plan-list and footer styles, bar chart styles retired"
```

---

## Self-review checklist (run before finishing)

- Every spec section maps to a task (hero priority → nextAction; pending
  consolidation → hasConsolidationComing; footer keeps /stats entry).
- `storage.get` return type verified against `src/lib/storage.ts`, not
  assumed.
- No unused imports left in Today.tsx (`noUnusedLocals` fails the build).
- All UI strings Chinese; all comments English.
- 375px: footer wraps; plan rows use min-height 44px tap targets.
