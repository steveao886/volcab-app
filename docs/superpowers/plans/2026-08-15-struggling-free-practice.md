# Unlimited Struggling-Word Practice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/practice?pick=struggling` — an unlimited, hardest-first walk over the stubborn-word pool — entered from the lapse drill's finish screens, writing nothing that could distort stats, lapses, or tomorrow's drill queue.

**Architecture:** Extract the drill queue's pool into `strugglingPracticePool` (queue.ts) so the daily drill and the unlimited walk share one definition. A new `nextStrugglingBatch` (practice.ts) deals the pool in order, shuffled within each batch. `recordPractice` gains a `settle` flag so a correct answer in this mode writes nothing (a miss still stamps `missedAt`). Practice.tsx grows a third pool mode; Review.tsx's lapse finish screens get the entry button.

**Tech Stack:** React 19 + TypeScript, vitest. Spec: `docs/superpowers/specs/2026-08-15-struggling-free-practice-design.md`.

**Conventions that bind every task:** injected `rng` (never bare `Math.random` in lib code), UI strings in Chinese, comments in English citing the why, `npx vitest run <file>` for single files, commit after each task.

---

### Task 1: Extract `strugglingPracticePool` from `buildLapseQueue`

**Files:**
- Modify: `src/lib/queue.ts:183-239` (split `buildLapseQueue` into pool + filter/cap)
- Test: `src/lib/queue.test.ts` (new describe block; existing `buildLapseQueue` suite must pass unchanged)

- [ ] **Step 1: Write the failing tests**

In `src/lib/queue.test.ts`, extend the `./queue` import (top of file) to:

```ts
import {
  buildConsolidateQueue, buildLapseQueue, buildQueue,
  CONSOLIDATE_DELAY_HOURS, CONSOLIDATE_MAX_INTERVAL_DAYS, LAPSE_SESSION_SIZE,
  MATURE_INTERVAL_DAYS, rankStrugglingWords, strugglingPracticePool,
} from './queue'
```

Append after the `buildLapseQueue` describe block (reusing the file's existing `word`, `strugglingEntry`, `emptyProgress` helpers):

```ts
describe('strugglingPracticePool: the drill queue before the daily narrowing', () => {
  const TODAY = '2026-07-24'

  it('recent misses lead by recency, then the ease ranking, deduplicated', () => {
    const p = emptyProgress()
    p.words['struggler'] = strugglingEntry(3, { ease: 1.4 })
    p.words['both'] = strugglingEntry(2, { ease: 1.6, missedAt: TODAY })
    p.words['missed'] = { state: 'review', ease: INITIAL_EASE, intervalDays: 20, due: '2026-08-13', stepIndex: 0, reps: 4, lapses: 0, lastReviewedAt: '2026-07-20T00:00:00Z', missedAt: '2026-07-23' }
    const ws = [word('struggler'), word('both'), word('missed')]
    // 'both' (missed today) before 'missed' (yesterday); 'struggler' enters
    // via the ranking; 'both' appears exactly once despite qualifying twice.
    expect(strugglingPracticePool(ws, p, TODAY).map(w => w.id)).toEqual(['both', 'missed', 'struggler'])
  })

  it('is uncapped — the daily session size bounds the drill, not the pool', () => {
    const ws = Array.from({ length: LAPSE_SESSION_SIZE + 7 }, (_, i) => word(`w${i}`))
    const p = emptyProgress()
    ws.forEach((w, i) => { p.words[w.id] = strugglingEntry(i) })
    expect(strugglingPracticePool(ws, p, TODAY)).toHaveLength(LAPSE_SESSION_SIZE + 7)
  })

  it('keeps words reviewed today — the unlimited walk may repeat them; the drill must not', () => {
    const p = emptyProgress()
    p.words['drilledToday'] = strugglingEntry(1, { lastReviewedAt: '2026-07-24T09:00:00Z' })
    expect(strugglingPracticePool([word('drilledToday')], p, TODAY).map(w => w.id)).toEqual(['drilledToday'])
    expect(buildLapseQueue([word('drilledToday')], p, TODAY)).toEqual([])
  })

  it('a miss outside the recency window with healthy ease is not in the pool at all', () => {
    const p = emptyProgress()
    p.words['a'] = { state: 'review', ease: INITIAL_EASE, intervalDays: 20, due: '2026-08-13', stepIndex: 0, reps: 4, lapses: 0, lastReviewedAt: '2026-07-01T00:00:00Z', missedAt: '2026-07-16' }
    expect(strugglingPracticePool([word('a')], p, TODAY)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/queue.test.ts`
Expected: FAIL — `strugglingPracticePool` is not exported.

- [ ] **Step 3: Implement the extraction**

In `src/lib/queue.ts`, replace the entire `buildLapseQueue` block (the comment starting `/** * The drill session:` through the end of the function, lines 183–239) with:

```ts
/**
 * Every word currently worth extra practice, most urgent first: **what you
 * just got wrong, then what you keep getting wrong.**
 *
 * The two halves answer different questions and only the second one is the
 * ranking above. `missedAt` words are a fresh observation from a quiz, the
 * sprint or 猜词; the ease ranking is an estimate accumulated over months.
 * Recent misses lead because they are the more actionable of the two, and
 * because this pool is now the only place a practice miss goes at all —
 * the surfaces that record one deliberately no longer touch `due` (see
 * ProgressEntry.missedAt).
 *
 * **The miss half is added here and not to rankStrugglingWords**, which
 * feeds the stats leaderboard as well. That list is defined by the
 * scheduler's own signals, ease and interval, and consolidateWord already
 * refused to force entries into it for exactly this reason: a definition
 * the card and the queue share stops meaning anything once either can
 * inject rows.
 *
 * Uncapped and blind to what happened today: this is the whole stubborn
 * universe, in drill order. The daily drill below narrows it; the
 * unlimited walk (`/practice?pick=struggling`) consumes it as is — see
 * the 2026-08-15 struggling-free-practice spec.
 */
export function strugglingPracticePool(words: Word[], progress: Progress, today: string): Word[] {
  const cutoff = addDays(today, -MISS_RECENCY_DAYS)
  const missed = words
    .filter(w => {
      const e = progress.words[w.id]
      return e && e.state !== 'new' && e.missedAt !== undefined && e.missedAt >= cutoff
    })
    // Most recent miss first; dates are YYYY-MM-DD, so string order is
    // chronological. Ties break the same way the ranking above does.
    .sort((a, b) => {
      const ma = progress.words[a.id].missedAt ?? '', mb = progress.words[b.id].missedAt ?? ''
      if (ma !== mb) return mb < ma ? -1 : 1
      const d = score(b) - score(a)
      return d !== 0 ? d : a.id.localeCompare(b.id)
    })

  const seen = new Set(missed.map(w => w.id))
  return [...missed, ...rankStrugglingWords(words, progress).filter(w => !seen.has(w.id))]
}

/**
 * The daily drill session: the pool above, minus anything already dealt
 * with today, capped to one sitting.
 *
 * The session ignores due dates by design, so without the reviewed-today
 * filter the same handful of words came back every single time the page
 * was opened, in an order that was fully deterministic down to the
 * tiebreakers. A pass through the list empties it for the day and the
 * entry point on the Today page disappears, which is the feedback the
 * mode never gave.
 *
 * Deriving from strugglingPracticePool rather than duplicating it is
 * load-bearing: the drill and the unlimited walk must never disagree
 * about what "stubborn" means.
 */
export function buildLapseQueue(
  words: Word[],
  progress: Progress,
  today: string,
  limit = LAPSE_SESSION_SIZE,
): string[] {
  return strugglingPracticePool(words, progress, today)
    // lastReviewedAt is an ISO instant; the day it belongs to is the
    // user's local day, which is what `today` is. Comparing the raw UTC
    // prefix would drop a word a few hours early or late depending on
    // the offset.
    .filter(w => todayStr(new Date(progress.words[w.id].lastReviewedAt)) !== today)
    .slice(0, limit)
    .map(w => w.id)
}
```

- [ ] **Step 4: Run the whole queue suite**

Run: `npx vitest run src/lib/queue.test.ts`
Expected: PASS, including every pre-existing `buildLapseQueue` test — that unchanged suite is the proof the derivation preserved behavior.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queue.ts src/lib/queue.test.ts
git commit -m "refactor(queue): extract strugglingPracticePool so the drill and the unlimited walk share one definition"
```

---

### Task 2: `nextStrugglingBatch` — ordered walk, shuffled within the batch

**Files:**
- Modify: `src/lib/practice.ts` (new export after `samplePractice`)
- Test: `src/lib/practice.test.ts` (new describe block; reuses `pool`/`mulberry32` helpers)

- [ ] **Step 1: Write the failing tests**

In `src/lib/practice.test.ts`, extend the `./practice` import to include `nextStrugglingBatch`:

```ts
import { buildMixedPractice, mixedPracticePool, nextStrugglingBatch, PRACTICE_DRAW_SIZE, samplePractice } from './practice'
```

Append a new describe block:

```ts
describe('nextStrugglingBatch', () => {
  it('batch composition is the head of the pool, whatever the seed', () => {
    const first = (seed: number) => new Set(nextStrugglingBatch(pool(50), 20, { rng: mulberry32(seed) }).map(w => w.id))
    const expected = new Set(pool(50).slice(0, 20).map(w => w.id))
    expect(first(1)).toEqual(expected)
    expect(first(2)).toEqual(expected)
  })

  it('shuffles within the batch: a different seed reorders, never recomposes', () => {
    const ids = (seed: number) => nextStrugglingBatch(pool(50), 20, { rng: mulberry32(seed) }).map(w => w.id)
    expect(ids(1)).not.toEqual(ids(2))
    expect(new Set(ids(1))).toEqual(new Set(ids(2)))
  })

  it('exclusion walks deeper into the pool instead of resampling the head', () => {
    const all = pool(50)
    const excluded = new Set(all.slice(0, 20).map(w => w.id))
    const next = new Set(nextStrugglingBatch(all, 20, { rng: mulberry32(3), exclude: excluded }).map(w => w.id))
    expect(next).toEqual(new Set(all.slice(20, 40).map(w => w.id)))
  })

  it('a pool walked to the end returns the remainder, then empty', () => {
    const all = pool(25)
    const firstTwo = new Set(all.slice(0, 20).map(w => w.id))
    expect(nextStrugglingBatch(all, 20, { rng: mulberry32(4), exclude: firstTwo })).toHaveLength(5)
    const everything = new Set(all.map(w => w.id))
    expect(nextStrugglingBatch(all, 20, { rng: mulberry32(5), exclude: everything })).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/practice.test.ts`
Expected: FAIL — `nextStrugglingBatch` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/practice.ts`, insert after `samplePractice` (line 47):

```ts
/**
 * One batch of the unlimited struggling-word walk (`pick=struggling`).
 *
 * Deliberately NOT samplePractice: this mode's premise, printed on the
 * button that opens it, is hardest-first — so the ordering is a promise,
 * not the hidden bias that keeps samplePractice uniform. Composition is
 * the next `size` unseen words in pool order, which makes batch 1 the most
 * urgent twenty and 再来一批 a step deeper down the ranking; the shuffle is
 * only *within* the batch, so the cards can't be recited by position.
 *
 * Same exclusion contract as samplePractice: empty means the walk is done.
 */
export function nextStrugglingBatch(
  pool: Word[],
  size: number = PRACTICE_DRAW_SIZE,
  opts: { rng?: () => number; exclude?: ReadonlySet<string> } = {},
): Word[] {
  if (size <= 0) return []
  const { rng = Math.random, exclude } = opts
  const eligible = exclude === undefined ? pool : pool.filter(w => !exclude.has(w.id))
  return shuffle(eligible.slice(0, size), rng)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/practice.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/practice.ts src/lib/practice.test.ts
git commit -m "feat(practice): nextStrugglingBatch deals the stubborn pool in order, shuffled only within the batch"
```

---

### Task 3: `recordPractice` gains a `settle` flag

**Files:**
- Modify: `src/state/store.tsx:79` (AppActions signature) and `src/state/store.tsx:735-747` (implementation)
- Test: `src/state/store.test.tsx` (two tests inside the existing `recordPractice` describe)

- [ ] **Step 1: Write the failing tests**

In `src/state/store.test.tsx`, append inside `describe('recordPractice: free practice writes less than any other surface', ...)` (before its closing `})`), using the file's existing `bootAsAlice`/`app`/`step`/`today` helpers:

```ts
  it('settle: false — a correct answer leaves an earlier miss standing, so extra practice cannot eat tomorrow\'s drill', async () => {
    await bootAsAlice()
    await step(() => { app().grade('alpha', 'easy') })
    await step(() => { app().recordPractice('alpha', false) })
    const before = app().progress.words['alpha']
    expect(before.missedAt).toBe(today)

    await step(() => { app().recordPractice('alpha', true, { settle: false }) })

    // Object identity, not merely "missedAt survives": nothing may be
    // committed at all — the same checkable guarantee the settling path
    // makes for a clean pass.
    expect(app().progress.words['alpha']).toBe(before)
  })

  it('settle: false — a miss still stamps missedAt and touches nothing else; the signal is genuine whichever surface observes it', async () => {
    await bootAsAlice()
    await step(() => { app().grade('alpha', 'easy') })
    const before = app().progress.words['alpha']

    await step(() => { app().recordPractice('alpha', false, { settle: false }) })

    const after = app().progress.words['alpha']
    expect(after.missedAt).toBe(today)
    expect(after.due).toBe(before.due)
    expect(after.ease).toBe(before.ease)
    expect(after.intervalDays).toBe(before.intervalDays)
    expect(after.lapses).toBe(before.lapses)
    expect(after.lastReviewedAt).toBe(before.lastReviewedAt)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/state/store.test.tsx`
Expected: FAIL — the first new test fails (the current implementation clears `missedAt`; the extra argument is ignored by JS but TypeScript in vitest will also flag the arity — either failure mode is fine, both mean "not implemented").

- [ ] **Step 3: Update the AppActions signature**

In `src/state/store.tsx`, the interface member (line 79). Replace:

```ts
  recordPractice(wordId: string, correct: boolean): void
```

with:

```ts
  recordPractice(wordId: string, correct: boolean, opts?: { settle?: boolean }): void
```

and extend the doc comment above it (after the dailyStats paragraph) with:

```ts
   * `settle: false` (the unlimited struggling walk) additionally keeps a
   * correct answer from clearing `missedAt` — see the implementation for
   * why that surface must not settle misses.
```

- [ ] **Step 4: Update the implementation**

In `src/state/store.tsx`, replace the `recordPractice` callback (lines 735–747):

```ts
  const recordPractice = useCallback((wordId: string, correct: boolean, opts: { settle?: boolean } = {}) => {
    const { settle = true } = opts
    const cur = stateRef.current.progress
    const prev = cur.words[wordId]
    if (!prev || prev.state === 'new') return
    // settle: false is the unlimited struggling walk (pick=struggling): a
    // correct answer minutes after a miss is short-term memory, which
    // proves nothing about retention — clearing missedAt on it would let
    // one afternoon of re-practice systematically empty tomorrow's drill
    // queue (the 2026-08-15 spec's central hazard). `prev` itself, not a
    // copy, so the identity guard below keeps "writes nothing" checkable.
    const entry = correct ? (settle ? clearMissed(prev) : prev) : { ...prev, missedAt: todayStr(new Date()) }
    // Object identity, exactly as clearMissed promises: a correct answer
    // over a word that was never missed has nothing to record, and bailing
    // here is what keeps "a clean pass writes nothing" true rather than
    // merely nearly true.
    if (entry === prev) return
    commitProgress({ ...cur, words: { ...cur.words, [wordId]: entry } })
    schedulePush()
  }, [commitProgress, schedulePush])
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/state/store.test.tsx`
Expected: PASS — the new tests and every pre-existing `recordPractice` test (the default path is unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/state/store.tsx src/state/store.test.tsx
git commit -m "feat(store): recordPractice settle flag - the struggling walk must not clear misses it did not earn"
```

---

### Task 4: `pick=struggling` mode on Practice.tsx

**Files:**
- Modify: `src/pages/Practice.tsx` (mode parsing, pool, draw, writes, copy, restart)

No new unit tests: all new logic lives in lib functions tested in Tasks 1–3; the page stays a thin render layer per repo policy.

- [ ] **Step 1: Imports and mode parsing**

In `src/pages/Practice.tsx` line 9, add `nextStrugglingBatch`:

```ts
import { buildMixedPractice, mixedPracticePool, nextStrugglingBatch, PRACTICE_DRAW_SIZE, samplePractice } from '../lib/practice'
```

and after it a new import line (alphabetical placement beside the other lib imports):

```ts
import { strugglingPracticePool } from '../lib/queue'
```

Replace the `mixed` state (lines 55–58):

```ts
  // `pick=mixed` is the Today-page row: half struggling, half steady, no
  // library filter involved. Anything else — including a missing value —
  // is the library-slice mode, read side lenient as ever.
  const [mixed] = useState(() => searchParams.get('pick') === 'mixed')
```

with:

```ts
  // `pick=mixed` is the Today-page row: half struggling, half steady.
  // `pick=struggling` is the unlimited walk down the stubborn pool, entered
  // from the lapse drill's finish screens (2026-08-15 spec). Anything else
  // — including a missing value — is the library-slice mode, read side
  // lenient as ever.
  const [pick] = useState(() => searchParams.get('pick'))
  const mixed = pick === 'mixed'
  const struggling = pick === 'struggling'
```

- [ ] **Step 2: backTo, pool, draw, answer**

`backTo` (lines 65–69) — both pool modes come from pages that link back to 今日:

```ts
  const backTo = useMemo(() => {
    if (mixed || struggling) return '/'
    const qs = filterToParams(filter)
    return qs === '' ? '/library' : `/library?${qs}`
  }, [mixed, struggling, filter])
```

`pool` (lines 79–82) — note the memo's comment above it still applies; the
struggling pool recomputing after a miss is harmless because the changed
word is already in `drawn`:

```ts
  const pool = useMemo(
    () =>
      struggling
        ? strugglingPracticePool(words, progress, today)
        : mixed
          ? mixedPracticePool(words, progress)
          : filterWords(words, progress, filter),
    [struggling, mixed, words, progress, today, filter],
  )
```

`draw` (lines 86–92):

```ts
  const draw = useCallback(
    (exclude?: ReadonlySet<string>) =>
      struggling
        ? nextStrugglingBatch(pool, PRACTICE_DRAW_SIZE, { exclude })
        : mixed
          ? buildMixedPractice(words, progress, today, PRACTICE_DRAW_SIZE, { exclude })
          : samplePractice(pool, PRACTICE_DRAW_SIZE, { exclude }),
    [struggling, mixed, words, progress, today, pool],
  )
```

In `answer` (line 147), pass the flag:

```ts
      recordPractice(cur.id, correct, { settle: !struggling })
```

- [ ] **Step 3: Restart for the exhausted walk**

After the `redraw` callback (line 160), add:

```ts
  // 从头再练: the "unlimited" in unlimited practice. Resets the walk and the
  // recap — a word missed in two walks must not appear twice in one list.
  const restart = useCallback(() => {
    setSeen(new Set())
    setDeck(draw(new Set()))
    setIdx(0)
    setFlipped(false)
    setMissed([])
  }, [draw])
```

- [ ] **Step 4: Finished-screen copy and buttons**

In the `finished` block, replace the `<Page>` title and copy (lines 200–221):

```tsx
      <Page eyebrow="Practice" title={struggling ? '顽固词加练' : '自由练习'} back={backTo}>
        <div className="review-done">
          <p className="review-done__label">{neverStarted ? '没有可练的词' : '这一批练完了'}</p>
          <p className="muted">
            {neverStarted
              ? struggling
                ? '眼下没有顽固词 —— 这是好事。'
                : mixed
                  ? '还没有已掌握的词可以练,先去复习几轮吧。'
                  : '这组筛选条件下没有词条,回词库换个条件试试。'
              : hasMore
                ? struggling
                  ? '想接着练就继续下一批,越往后越接近记牢 —— 这里不记进度。'
                  : '想接着练就再抽一批,不想练随时可以走 —— 这里不记进度。'
                : struggling
                  ? '顽固词都过了一遍。还想练可以从头再来,这里不设上限。'
                  : mixed
                    ? '能练的词都过了一遍。'
                    : '这组筛选条件下的词都过了一遍。'}
          </p>
          {hasMore && (
            <Button variant="primary" size="lg" onClick={redraw}>
              再来一批
            </Button>
          )}
          {struggling && !hasMore && !neverStarted && (
            <Button variant="primary" size="lg" onClick={restart}>
              从头再练
            </Button>
          )}
          <Link to={backTo} className="btn btn--secondary btn--lg">
            {mixed || struggling ? '返回今日' : '返回词库'}
          </Link>
        </div>
```

- [ ] **Step 5: In-session title and drill note**

In the main return, the `<Page>` opening (line 254) becomes:

```tsx
    <Page eyebrow="Practice" title={struggling ? '顽固词加练' : '自由练习'} back={backTo}>
```

Replace the drill note (lines 273–276):

```tsx
      <p className="faint review-drill-note">
        {struggling
          ? '专攻顽固词:刚错过的和最难的排最前。不计成绩、不影响排期,答对也不会提前出队 —— 真正的检验在明天的正式一轮。'
          : <>
              {mixed ? '一半已掌握的词随机抽,一半是最近老忘的。' : '随便练:'}
              答错的词会进顽固词队列,但不影响复习计划,也不计入今日复习。
            </>}
      </p>
```

- [ ] **Step 6: Run the suite and the build**

Run: `npx vitest run` then `npm run build`
Expected: all tests PASS; build succeeds (watch for `noUnusedLocals` on the import lines).

- [ ] **Step 7: Commit**

```bash
git add src/pages/Practice.tsx
git commit -m "feat(practice): pick=struggling - the unlimited walk down the stubborn pool"
```

---

### Task 5: Entry button on the lapse drill's finish screens

**Files:**
- Modify: `src/pages/Review.tsx:11` (import), `~312` (pool check), `~320-364` (finished branch)

- [ ] **Step 1: Import and availability check**

Line 11 becomes:

```ts
import { buildConsolidateQueue, buildLapseQueue, buildQueue, CONSOLIDATE_DELAY_HOURS, rankStrugglingWords, strugglingPracticePool } from '../lib/queue'
```

After the `hasStrugglingWords` memo (lines 312–315), add:

```ts
  // The extra-practice pool can be non-empty while today's drill queue is
  // empty — the drill filters out words reviewed today, the pool does not —
  // so the 继续加练 button gets its own check rather than reusing the
  // queue's emptiness.
  const hasExtraPractice = useMemo(
    () => (lapseMode ? strugglingPracticePool(words, progress, today).length > 0 : false),
    [lapseMode, words, progress, today],
  )
```

- [ ] **Step 2: The button, and the copy it contradicts**

In the finished branch, the cleared-for-today sentence (line 352) currently reads `'顽固词每天练一遍就够了,明天再来。'` — with an unlimited entry below it, that sentence would be false. Replace it with:

```ts
                    ? '计入成绩的一轮每天练一遍就够了。'
```

Then insert the entry between the `<p className="muted">` block and the 返回今日 link (line 359), so the primary action stays first:

```tsx
          <Link to="/" className="btn btn--primary btn--lg">
            返回今日
          </Link>
          {lapseMode && hasExtraPractice && (
            <>
              <Link to="/practice?pick=struggling" className="btn btn--secondary btn--lg">
                继续加练
              </Link>
              <p className="faint">不计成绩、不影响排期,从最难的词开始。</p>
            </>
          )}
```

(The qualifier line is product copy — the write contract printed on the control that invokes it, same rule as shortcuts on buttons.)

- [ ] **Step 3: Run suite, lint, build**

Run: `npx vitest run` then `npx oxlint` then `npm run build`
Expected: PASS / no new lint errors / build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Review.tsx
git commit -m "feat(review): extra-practice entry on the lapse finish screens, contract printed on the control"
```

---

### Task 6: Browser verification

**Files:** none (verification only)

- [ ] **Step 1: Start the preview** — `preview_start` with the `volcab-dev` config (never a shell command). Use dev demo mode to get data.

- [ ] **Step 2: Walk the flow** — open `/#/review?mode=lapses`, finish (or observe the already-done screen); confirm 继续加练 + qualifier appear above 返回今日 only in lapse mode; click through to `/#/practice?pick=struggling`; confirm the title 顽固词加练, the drill note, and that answering advances; exhaust or spot-check 再来一批; confirm the finish screen offers 从头再练 when the walk ends.

- [ ] **Step 3: Check the console/logs** — `read_console_messages` for errors; fix anything found and re-verify.

- [ ] **Step 4: Screenshot proof** — screenshot the lapse finish screen with the button, and the struggling practice page, at 375px width.
