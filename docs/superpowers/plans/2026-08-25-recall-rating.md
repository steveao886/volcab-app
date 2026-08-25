# 回想 Difficulty Rating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user mark a word 太简单 or 要多考 by hand, and have 回想 — and only 回想 — draw accordingly.

**Architecture:** One optional field on `ProgressEntry` carrying a three-valued level plus its own timestamp. `senseGroup.ts` turns it into a third multiplier beside the two automatic ones. `merge.ts` reconciles it on its own timestamp, never on `lastReviewedAt`. Two surfaces write it: one button on 回想's reveal, a three-chip row on the word detail page.

**Tech Stack:** React 19 + TypeScript + Vite, vitest, oxlint.

**Spec:** `docs/superpowers/specs/2026-08-25-recall-rating-design.md`

---

## File structure

| File | Responsibility |
|---|---|
| `src/types.ts` | `RecallRating` + the optional field on `ProgressEntry` |
| `src/lib/senseGroup.ts` | `ratingWeight`, multiplied into the candidate weight |
| `src/lib/senseGroup.test.ts` | the draw actually moves, and easy is never excluded |
| `src/lib/merge.ts` | `mergeRating`, in the dedicated per-word loop |
| `src/lib/merge.test.ts` | own-timestamp merge, `'none'` tombstone |
| `src/state/store.tsx` | `rateRecall` action |
| `src/state/store.test.tsx` | writes nothing the scheduler owns |
| `src/pages/QuizRecall.tsx` | the reveal button + clear-on-miss |
| `src/pages/WordDetail.tsx` | the three-chip row |
| `src/pages/WordDetail.css` | spacing for that row inside a `.stat` |

No change to `src/state/sync.ts` (`isProgressEntry` validates required fields only) and none to `scripts/validate-*.ts` (those gate content files; this is progress data).

---

### Task 1: The field

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add the interface above `RecallStat`**

```ts
/**
 * The user's own verdict on a word in 回想, set by hand.
 *
 * Read by `generateRecallSession` and by nothing else — not the scheduler,
 * not the other quiz modes. Production and recognition come apart (the
 * whole premise of `RecallStat` below), so a rating collected in the
 * Chinese→English direction is not spent in the other one.
 *
 * `'none'` is **"I cleared this"**, distinct from the field being absent,
 * which is "never rated". The runtime treats them identically — both weigh
 * 1 — and the distinction exists only for the merge: if clearing removed
 * the field, mergeProgress would have to choose between resurrecting a
 * rating the user just cleared on the other device (the mirror of what
 * unionDismissed prevents) and dropping one the moment either side had not
 * seen it. A tombstone carries a timestamp, so "later `at` wins" covers
 * setting, changing and clearing with one rule.
 */
export interface RecallRating {
  level: 'easy' | 'hard' | 'none'
  /** ISO timestamp of the rating. The merge key — deliberately not RecallStat.lastAt, which means "last 回想 *answer*" and would be a lie for a rating set from the word detail page. */
  at: string
}
```

- [ ] **Step 2: Add the optional field to `ProgressEntry`, right after `recall`**

```ts
  /**
   * The user's manual 回想 rating. See RecallRating.
   *
   * Optional like every added field: another device on an older build
   * pushes entries without it, and the correct reading of its absence is
   * "never rated", not a rejected merge.
   */
  recallRating?: RecallRating
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: PASS (nothing consumes the field yet).

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "types(recall): a manual rating, with its own timestamp and an explicit cleared state"
```

---

### Task 2: The weight

**Files:**
- Modify: `src/lib/senseGroup.ts` (add `ratingWeight` after `recallWeight`; multiply it into the `weight` closure in `generateRecallSession`)
- Test: `src/lib/senseGroup.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/senseGroup.test.ts`, reusing the `drawOrder`/`rngFrom` shape the `recall proficiency steers the draw` block already established:

```ts
describe('the manual rating steers the draw', () => {
  const word = (id: string): Word => ({
    id, headword: id, phonetic: `/${id}/`,
    meanings: [{ pos: 'adj.', en: `def of ${id}`, zh: `${id}义` }],
    examples: [`It felt ${id} today.`, `Another ${id} day.`],
    synonyms: [], antonyms: [], collocations: [], relatedForms: [],
    sourceNote: 't', addedAt: '2026-07-01',
  })
  const ids = ['alpha', 'bravo', 'carol', 'delta', 'echo', 'fox']
  const ws = ids.map(word)
  const byId = new Map(ws.map(w => [w.id, w]))
  const prog = (ratings: Record<string, RecallRating>): Progress => {
    const p = emptyProgress()
    for (const w of ws) {
      p.words[w.id] = {
        state: 'review', ease: 2.5, intervalDays: 5, due: '2026-08-10',
        stepIndex: 0, reps: 3, lapses: 0, lastReviewedAt: '2026-08-01T00:00:00Z',
        ...(ratings[w.id] ? { recallRating: ratings[w.id] } : {}),
      }
    }
    return p
  }
  const sentences = ids.map((id, i) => ({ id, i: 0, zh: `第${i}个句子在这里。`, target: `第${i}个` }))
  const rngFrom = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const drawOrder = (p: Progress, rounds = 200) => {
    const counts = new Map<string, number>()
    for (let s = 1; s <= rounds; s++) {
      const qs = generateRecallSession([], byId, p, '2026-08-10', new Set(), new Set(), 2, rngFrom(s), sentences)
      for (const q of qs) counts.set(q.orderIds[0], (counts.get(q.orderIds[0]) ?? 0) + 1)
    }
    return counts
  }
  const AT = '2026-08-20T00:00:00Z'

  it('要多考 outdraws an identical unrated word', () => {
    const counts = drawOrder(prog({ alpha: { level: 'hard', at: AT } }))
    expect(counts.get('alpha') ?? 0).toBeGreaterThan(counts.get('carol') ?? 0)
  })

  it('太简单 is pushed far down but never excluded', () => {
    // The one rule that has to survive every future "optimisation": this is
    // a weight, not a filter. weightedShuffle's own comment is the contract
    // — heavier items tend toward the front *without ever excluding the
    // light ones* — and at 0.05 the word is once per ~540 rounds, not gone.
    const rated = prog({ alpha: { level: 'easy', at: AT } })
    expect(drawOrder(rated).get('alpha') ?? 0).toBeLessThan(drawOrder(rated).get('carol') ?? 0)
    // Given enough draws it still has to appear: a filter would score 0 here
    // however many rounds it ran.
    const alone = emptyProgress()
    alone.words['alpha'] = {
      state: 'review', ease: 2.5, intervalDays: 5, due: '2026-08-10',
      stepIndex: 0, reps: 3, lapses: 0, lastReviewedAt: '2026-08-01T00:00:00Z',
      recallRating: { level: 'easy', at: AT },
    }
    const only = generateRecallSession([], byId, alone, '2026-08-10', new Set(), new Set(), 2, rngFrom(7), sentences)
    expect(only.map(q => q.orderIds[0])).toContain('alpha')
  })

  it("'none' and an absent rating draw the same — the tombstone is for the merge, not the runtime", () => {
    const cleared = drawOrder(prog({ alpha: { level: 'none', at: AT } }))
    const alpha = cleared.get('alpha') ?? 0
    const carol = cleared.get('carol') ?? 0
    expect(Math.abs(alpha - carol)).toBeLessThan(alpha)
  })
})
```

Add `RecallRating` to the type import at the top of the file:

```ts
import type { Progress, RecallRating, Word } from '../types'
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/senseGroup.test.ts`
Expected: FAIL — 要多考 does not outdraw anything yet, because nothing reads the field.

- [ ] **Step 3: Add `ratingWeight` after `recallWeight` in `src/lib/senseGroup.ts`**

```ts
/**
 * The user's own verdict, as a third multiplier beside the two automatic
 * ones.
 *
 * The automatic signals are both after the fact: `recallWeight` cannot call
 * a word easy until it has been answered right three times running, and
 * cannot call it hard until it has been missed. The user knows on sight,
 * and until this existed the app had no way to hear it.
 *
 * **The two ends are deliberately asymmetric.** recallWeight already tops
 * out at 2.5 on the hard end, so manual intent only has to push further; on
 * the easy end its floor is 0.5, and measured over the bundled content as
 * of 2026-08-25 — 412 sense groups + 1155 sentence renderings = 1567
 * candidates, 10 questions a round, 20000 rounds simulated through
 * weightedShuffle's own formula — that floor still puts a word in front of
 * the user every 48 rounds. 0.05 makes it every 540. That gap is why the
 * easy lever is an order of magnitude stronger than the hard one.
 *
 * 6 rather than something larger: at 6 a marked word arrives every 6 rounds
 * and fifteen marked words take 2.7 of a 10-question round — clearly
 * tilted, without turning 回想 into the fixed list the stubborn-word drill
 * already produced once.
 *
 * **A weight, never a filter.** 0.05 is rare, not absent — the sentence
 * that has to stay true across this whole app is weightedShuffle's own.
 */
const ratingWeight = (r: RecallRating | undefined): number => {
  if (r === undefined) return 1
  if (r.level === 'easy') return 0.05
  if (r.level === 'hard') return 6
  // 'none' is an explicitly cleared rating and weighs exactly what never
  // having been rated weighs. It exists for mergeRating, not for here.
  return 1
}
```

Import the type at the top of `senseGroup.ts`:

```ts
import type { Progress, RecallRating, RecallStat, Word } from '../types'
```

(keep whatever else that line already imports)

- [ ] **Step 4: Multiply it into the candidate weight**

In `generateRecallSession`, replace the `weight` closure:

```ts
  const weight = (c: RecallCandidate) =>
    Math.max(...c.ids.map(id => {
      const w = words.get(id)
      if (w === undefined) return 1
      const e = progress.words[id]
      // Three signals, one product: can I recognise it (the scheduler's
      // own estimate), can I produce it (the 回想 record), and what did the
      // user say. No cap on the product — the first pass below takes at
      // most one question per word, so even a very heavy word cannot take
      // more than 1 of the 10 slots.
      return difficultyWeight(w, progress, today)
        * recallWeight(e?.recall)
        * ratingWeight(e?.recallRating)
    }))
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/lib/senseGroup.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 6: Commit**

```bash
git add src/lib/senseGroup.ts src/lib/senseGroup.test.ts
git commit -m "feat(recall): the manual rating as a third multiplier — 0.05 and 6, measured"
```

---

### Task 3: The merge

**Files:**
- Modify: `src/lib/merge.ts`
- Test: `src/lib/merge.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("mergeProgress's recall")` block in `src/lib/merge.test.ts` (or in a new `describe("mergeProgress's recallRating")` immediately after it):

```ts
describe("mergeProgress's recallRating", () => {
  const rating = (level: 'easy' | 'hard' | 'none', at: string) => ({ level, at })

  it('merges on its own timestamp, not lastReviewedAt', () => {
    // The failure this prevents: the phone rated the word, the laptop
    // graded it in /review afterwards. The wholesale pick resolves by
    // lastReviewedAt, which only the scheduler stamps, so the laptop's
    // entry wins and the rating disappears silently and for good.
    const rated = withEntry(entry({ lastReviewedAt: '2026-08-01T00:00:00Z', recallRating: rating('hard', '2026-08-20T00:00:00Z') }))
    const graded = withEntry(entry({ lastReviewedAt: '2026-08-24T00:00:00Z' }))
    expect(mergeProgress(rated, graded).words.alpha.recallRating).toEqual(rating('hard', '2026-08-20T00:00:00Z'))
    expect(mergeProgress(graded, rated).words.alpha.recallRating).toEqual(rating('hard', '2026-08-20T00:00:00Z'))
  })

  it('the later rating wins', () => {
    const a = withEntry(entry({ recallRating: rating('easy', '2026-08-20T00:00:00Z') }))
    const b = withEntry(entry({ recallRating: rating('hard', '2026-08-22T00:00:00Z') }))
    expect(mergeProgress(a, b).words.alpha.recallRating).toEqual(rating('hard', '2026-08-22T00:00:00Z'))
  })

  it("a clear beats an older rating instead of being resurrected by it", () => {
    // This is the whole reason 'none' exists rather than deleting the key.
    // With absence meaning "cleared", the only merge rules available are
    // "the side with a value wins" — which undoes the clear on every sync —
    // and "absence wins", which loses a rating the other device has not
    // seen yet.
    const stale = withEntry(entry({ recallRating: rating('easy', '2026-08-20T00:00:00Z') }))
    const cleared = withEntry(entry({ recallRating: rating('none', '2026-08-23T00:00:00Z') }))
    expect(mergeProgress(stale, cleared).words.alpha.recallRating?.level).toBe('none')
    expect(mergeProgress(cleared, stale).words.alpha.recallRating?.level).toBe('none')
  })

  it('undefined on one side yields to the other, and on both stays absent', () => {
    const rated = withEntry(entry({ recallRating: rating('hard', '2026-08-20T00:00:00Z') }))
    const bare = withEntry(entry({}))
    expect(mergeProgress(bare, rated).words.alpha.recallRating).toEqual(rating('hard', '2026-08-20T00:00:00Z'))
    expect(mergeProgress(bare, bare).words.alpha).not.toHaveProperty('recallRating')
  })
})
```

Check the existing `entry(...)` / `withEntry(...)` helpers at the top of `merge.test.ts` accept an override object; if `entry` takes `Partial<ProgressEntry>` this compiles as written.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/merge.test.ts`
Expected: FAIL — the rating rides the wholesale pick, so the "merges on its own timestamp" case loses it.

- [ ] **Step 3: Add `mergeRating` below `mergeRecall` in `src/lib/merge.ts`**

```ts
/**
 * The user's manual 回想 rating for one word: later `at` wins, full stop.
 *
 * One rule covers setting, changing *and* clearing, because clearing writes
 * `'none'` rather than removing the field. Had it removed the field, this
 * would have had to pick between "the side holding a value wins" — which
 * resurrects a rating the user just cleared on the other device, the mirror
 * of what unionDismissed exists to prevent — and dropping a rating the
 * moment one side has not synced it yet.
 *
 * Unlike mergeRecall there is nothing to split by field: a rating is one
 * indivisible statement of intent, not a state plus a ledger.
 */
function mergeRating(a: RecallRating | undefined, b: RecallRating | undefined): RecallRating | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return a.at >= b.at ? a : b
}
```

Extend the type import on line 1:

```ts
import type { BestRecord, DailyStat, Progress, RecallRating, RecallStat } from '../types'
```

- [ ] **Step 4: Merge it in the dedicated loop**

Replace the `recall` loop in `mergeProgress` with:

```ts
  // **Neither of these can ride the wholesale pick above.** That pick
  // resolves an entry by `lastReviewedAt`, which only the scheduler stamps
  // — 回想 deliberately writes nothing the scheduler owns. So a phone that
  // practised 回想 and a laptop that graded the same word in /review would
  // resolve to the laptop's entry, and every rep of that practice, plus any
  // rating, would vanish on the next sync, silently and for good. Each is
  // merged on its own timestamp instead.
  for (const id of new Set([...Object.keys(local.words), ...Object.keys(remote.words)])) {
    const entry = words[id]
    if (entry === undefined) continue
    const recall = mergeRecall(local.words[id]?.recall, remote.words[id]?.recall)
    const recallRating = mergeRating(local.words[id]?.recallRating, remote.words[id]?.recallRating)
    // Spread conditionally rather than assigning undefined: absent on both
    // sides has to stay absent, not become an explicit `undefined` key that
    // JSON.stringify would then drop anyway but every test would see.
    words[id] = {
      ...entry,
      ...(recall === undefined ? {} : { recall }),
      ...(recallRating === undefined ? {} : { recallRating }),
    }
  }
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/lib/merge.test.ts`
Expected: PASS, including the pre-existing `recall` tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/merge.ts src/lib/merge.test.ts
git commit -m "fix(sync): the rating merges on its own timestamp — riding lastReviewedAt would drop it whenever the other device graded the word"
```

---

### Task 4: The store action

**Files:**
- Modify: `src/state/store.tsx` (the `AppActions` interface near `recordRecall`; the action itself after `recordRecall`; both lists at the context-value assembly)
- Test: `src/state/store.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append after the existing `recordRecall` tests in `src/state/store.test.tsx`:

```ts
  it('rateRecall writes the rating and nothing the scheduler owns', async () => {
    await bootLoggedIn()
    const before = app().progress.words['alpha']
    await step(() => { app().rateRecall('alpha', 'easy') })
    const after = app().progress.words['alpha']
    const { recallRating: _a, ...afterSched } = after
    const { recallRating: _b, ...beforeSched } = before
    expect(afterSched).toEqual(beforeSched)
    expect(after.recallRating?.level).toBe('easy')
    expect(after.recallRating?.at).toEqual(expect.any(String))
  })

  it('rateRecall overwrites, and clearing is a real value rather than a removal', async () => {
    await bootLoggedIn()
    await step(() => { app().rateRecall('alpha', 'hard') })
    expect(app().progress.words['alpha'].recallRating?.level).toBe('hard')
    await step(() => { app().rateRecall('alpha', 'none') })
    // Not deleted: 'none' is what lets a clear survive a merge against a
    // device that still holds the old rating.
    expect(app().progress.words['alpha'].recallRating?.level).toBe('none')
  })

  it('rateRecall skips a word deleted on another device', async () => {
    await bootLoggedIn()
    await step(() => { app().rateRecall('nowhere', 'easy') })
    expect(app().progress.words['nowhere']).toBeUndefined()
  })
```

Match the surrounding tests' actual boot/step helper names — the three existing `recordRecall` tests immediately above show the exact form in this file.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/state/store.test.tsx`
Expected: FAIL — `rateRecall` is not a function.

- [ ] **Step 3: Declare it on `AppActions`, right after `recordRecall`**

```ts
  /** The user's manual 回想 rating. Writes ProgressEntry.recallRating and nothing the scheduler owns; 'none' clears. */
  rateRecall(id: string, level: RecallRating['level']): void
```

Add `RecallRating` to the type import from `../types` at the top of `store.tsx`.

- [ ] **Step 4: Implement it after `recordRecall`**

```ts
  /**
   * The user's own verdict on a word in 回想 — written the moment it is
   * tapped, not batched into settlement like recordRecall.
   *
   * A rating is intent, not a round result: quitting a round halfway must
   * not discard it, and the word detail page, which is the only place all
   * three states are one tap apart, has no settlement to wait for at all.
   *
   * Touches nothing the scheduler owns, exactly as recordRecall does not —
   * that boundary is the whole reason the 回想 axis exists separately.
   */
  const rateRecall = useCallback((id: string, level: RecallRating['level']) => {
    const cur = stateRef.current.progress
    const prev = cur.words[id]
    // A word deleted on another device: skip rather than resurrect an entry
    // for it, the same call recordRecall and practiceGrade make.
    if (prev === undefined) return
    commitProgress({
      ...cur,
      words: { ...cur.words, [id]: { ...prev, recallRating: { level, at: new Date().toISOString() } } },
    })
    void flushProgress()
  }, [commitProgress, flushProgress])
```

- [ ] **Step 5: Add `rateRecall` to both lists at the context-value assembly**

Both the object literal and its dependency array (around `store.tsx:1074` / `:1078`) list every action by name; add `rateRecall` next to `recordRecall` in each.

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run src/state/store.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/state/store.tsx src/state/store.test.tsx
git commit -m "feat(recall): rateRecall writes on tap, not at settlement — a rating is intent, not a round result"
```

---

### Task 5: The button on the reveal

**Files:**
- Modify: `src/pages/QuizRecall.tsx`

- [ ] **Step 1: Add the label map beside `MISS_TAG`**

```ts
/**
 * The two directions the user can push a word. Printed in full on the
 * button — the selected state changes the whole label rather than only the
 * colour, because state must never be carried by colour alone.
 */
const RATING_LABEL: Record<'easy' | 'hard', { set: string; unset: string }> = {
  easy: { unset: '太简单', set: '已标记为太简单 · 取消' },
  hard: { unset: '要多考', set: '已标记为要多考 · 取消' },
}
```

- [ ] **Step 2: Read the rating and pick which button to show, inside `RecallQuestionView`**

Change its `useApp()` line to pull the action, and derive the two values after `const [picked, setPicked] = ...`:

```ts
  const { progress, rateRecall } = useApp()
```

and, after the `stage`/`correct`/`miss` state declarations:

```ts
  const answerId = question.orderIds[0]
  const rated = progress.words[answerId]?.recallRating?.level
  /**
   * One button, not two.
   *
   * An existing rating always shows itself, so a mark can never become
   * invisible and therefore unchangeable — which matters because a 太简单
   * word is drawn once per ~540 rounds and will not come back on its own to
   * offer you the chance. Only an unrated word gets the button its own
   * answer suggests, and it sits here rather than on the results page for
   * the same reason 巩固 does: the moment you know a word is too easy is
   * the moment you just answered it without thinking.
   */
  const ratingShown: 'easy' | 'hard' =
    rated === 'easy' || rated === 'hard' ? rated : (correct ? 'easy' : 'hard')
```

- [ ] **Step 3: Render it in the `revealed` branch, between 巩固 and 下一题**

```tsx
          <Button
            variant="secondary"
            block
            aria-pressed={rated === ratingShown}
            onClick={() => rateRecall(answerId, rated === ratingShown ? 'none' : ratingShown)}
          >
            {rated === ratingShown ? RATING_LABEL[ratingShown].set : RATING_LABEL[ratingShown].unset}
          </Button>
```

- [ ] **Step 4: Clear an `'easy'` rating on a miss, in the parent's `handleAnswered`**

Pull the action into the page's `useApp()` destructure (it already takes `progress, recordQuiz, recordRecall, consolidateWord`), then add to `handleAnswered` immediately after `setProduced(...)`:

```ts
    // A miss refutes 太简单, so the mark clears itself — here, in the tap
    // that produced the miss, rather than batched into recordRecall at
    // settlement. Batching is tidier and produces a visibly wrong screen:
    // the reveal would still show 太简单 selected and flip it silently when
    // 下一题 is pressed.
    //
    // 要多考 is never cleared this way. The asymmetry is the point: 太简单
    // is a claim of fact and a miss refutes it, while 要多考 is a wish and
    // three correct answers are not grounds for the app to overrule it.
    if (!correct && progress.words[q.orderIds[0]]?.recallRating?.level === 'easy') {
      rateRecall(q.orderIds[0], 'none')
    }
```

and extend that `useCallback`'s dependency array to `[progress, rateRecall]`.

- [ ] **Step 5: Typecheck and run the suite**

Run: `npm run build`
Expected: PASS. `noUnusedLocals` is on, so an unused import fails here.

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Verify in the browser**

`preview_start` with the `volcab-dev` config, open `/quiz?mode=recall` at 375px, answer one question right and one wrong, confirm the right button appears in each case, that tapping it flips the label, and that the layout does not overflow.

- [ ] **Step 7: Commit**

```bash
git add src/pages/QuizRecall.tsx
git commit -m "feat(recall): rate the word on the reveal — one button, and a miss retracts 太简单 on the spot"
```

---

### Task 6: The word detail control

**Files:**
- Modify: `src/pages/WordDetail.tsx`, `src/pages/WordDetail.css`

- [ ] **Step 1: Add the label list near the top of `WordDetail.tsx`**

```ts
/** The three states, in the order they read as a scale. */
const RECALL_RATINGS: [level: 'easy' | 'none' | 'hard', label: string][] = [
  ['easy', '太简单'],
  ['none', '默认'],
  ['hard', '要多考'],
]
```

- [ ] **Step 2: Render the row inside `.worddetail-stats`, after the 回想说出 tile**

```tsx
            {/* The user's own verdict, and the only place all three states
                are one tap apart. It is also the only place a 太简单 word
                can be found again: at 0.05 it is drawn once per ~540 rounds
                and will not come back on its own to offer the chance.

                Shown whenever the word has a progress entry, unlike the
                回想说出 tile above, which needs reps > 0 — that one reports
                a measurement and has nothing to say before the first
                answer, while a rating is an opinion the user can hold about
                a word 回想 has not asked yet. A word with no entry at all
                has never been studied, so 回想 cannot reach it and
                rateRecall would no-op; no control is shown rather than a
                dead one. */}
            {entry !== undefined && (
              <div className="stat worddetail-stat--wide">
                <div className="worddetail-chiprow worddetail-rating" role="group" aria-label="回想出题难度">
                  {RECALL_RATINGS.map(([level, label]) => (
                    <Chip
                      key={level}
                      label={label}
                      selected={(entry.recallRating?.level ?? 'none') === level}
                      onClick={() => rateRecall(word.id, level)}
                    />
                  ))}
                </div>
                <p className="stat__label">回想出题</p>
              </div>
            )}
```

Pull `rateRecall` from the page's `useApp()` destructure, and import `Chip` from `../components/Chip` if the file does not already.

- [ ] **Step 3: Add the spacing rule to `WordDetail.css`**

```css
/* The rating row sits where a .stat's value normally does, so it needs the
   same gap under it that .stat__value has. --sp-3 on the row itself is
   inherited from .worddetail-chiprow and is load-bearing: tappable chips
   expand their hit area 6px each way. */
.worddetail-rating {
  margin-block-end: var(--sp-2);
}
```

- [ ] **Step 4: Typecheck and run the suite**

Run: `npm run build`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Verify in the browser**

Open a word detail page at 375px. Confirm the three chips fit on one line without overflow, that the selected one is the ink slab, and that tapping each moves the selection.

- [ ] **Step 6: Commit**

```bash
git add src/pages/WordDetail.tsx src/pages/WordDetail.css
git commit -m "feat(recall): the three-state rating on the word page — the only way back to a 太简单 word"
```

---

### Task 7: Whole-repo gates

- [ ] **Step 1: Lint**

Run: `npx oxlint`
Expected: no errors.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Full suite**

Run: `npm test`
Expected: PASS, no skipped files.

- [ ] **Step 4: Update `CLAUDE.md`'s SRS section**

The section states the one door practice has into the scheduler. Add a sentence recording that the manual rating is not another one:

```markdown
The manual 回想 rating (`ProgressEntry.recallRating`, 太简单 / 要多考) is
**not** a second door: it is read only by `generateRecallSession`, as a
multiplier on the draw, and reaches nothing in `srs.ts`. See
`docs/superpowers/specs/2026-08-25-recall-rating-design.md`.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: the manual recall rating is not a second door into the scheduler"
```
