# Quiz Hub Mode Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/quiz` into a hub of seven mode cards showing per-mode accuracy / best score / last-practiced, with a data-driven 推荐 badge; sessions live at `/quiz?mode=X` and back-navigate to the hub.

**Architecture:** Pure derivation (`modeOverview`, `recommendMode`, `agoLabel`) goes into `src/pages/statsDerive.ts` with tests. `Quiz.tsx` splits into a tiny router (`Quiz`), a new `QuizHub`, and `QuizSessionPage` (the old body minus the chip switcher). Splitting is a rules-of-hooks requirement: one component alternating between hub and session markup would change its hook count between renders.

**Tech Stack:** React 19 + TypeScript, react-router (HashRouter), vitest. Read `CLAUDE.md` and `docs/superpowers/specs/2026-08-07-quiz-hub-cards-design.md` first.

**Repo rules that bite here:** `noUnusedLocals` — removing the chip row means removing the `Chip` import from Quiz.tsx (but `Chip` stays used by other files; don't touch the component). UI strings Chinese, comments English. UI gets no component tests. `recordQuiz` and all session components are frozen — do not modify them.

---

### Task 1: `modeOverview` / `recommendMode` / `agoLabel` in statsDerive

**Files:**
- Modify: `src/pages/statsDerive.ts` (append after `modeAccuracy`)
- Test: `src/pages/statsDerive.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/pages/statsDerive.test.ts` (reuse the file's existing imports/fixtures where they exist; otherwise add):

```ts
import { agoLabel, modeOverview, recommendMode } from './statsDerive'
import { emptyProgress, emptyStat } from '../types'
import type { Progress } from '../types'

/** Progress whose dailyStats carry only quizModes tallies. */
const progWithModes = (
  days: Record<string, Record<string, { asked: number; correct: number }>>,
): Progress => {
  const p = emptyProgress()
  for (const [date, quizModes] of Object.entries(days)) {
    p.dailyStats[date] = { ...emptyStat(), quizModes }
  }
  return p
}

describe('modeOverview', () => {
  it('returns all seven modes in fixed key order, played or not', () => {
    const rows = modeOverview(emptyProgress())
    expect(rows.map(r => r.mode)).toEqual(['mixed', 'recall', 'contrast', 'audio', 'sprint', 'passage', 'guess'])
    expect(rows[0]).toMatchObject({ asked: 0, correct: 0, rate: null, lastPlayed: null })
  })

  it('aggregates across days and keeps the most recent date as lastPlayed', () => {
    const rows = modeOverview(progWithModes({
      '2026-08-01': { audio: { asked: 10, correct: 6 } },
      '2026-08-05': { audio: { asked: 10, correct: 7 } },
    }))
    const audio = rows.find(r => r.mode === 'audio')
    expect(audio).toMatchObject({ asked: 20, correct: 13, lastPlayed: '2026-08-05' })
    expect(audio?.rate).toBeCloseTo(0.65)
  })

  it('rate stays null below the accuracy floor', () => {
    const rows = modeOverview(progWithModes({ '2026-08-01': { recall: { asked: 9, correct: 9 } } }))
    expect(rows.find(r => r.mode === 'recall')).toMatchObject({ asked: 9, rate: null })
  })

  it('ignores unknown metric keys from newer builds', () => {
    const rows = modeOverview(progWithModes({ '2026-08-01': { newfangled: { asked: 50, correct: 50 } } }))
    expect(rows.every(r => r.asked === 0)).toBe(true)
  })
})

describe('recommendMode', () => {
  it('picks the lowest printable accuracy', () => {
    const rows = modeOverview(progWithModes({
      '2026-08-01': { mixed: { asked: 20, correct: 18 }, audio: { asked: 20, correct: 12 } },
    }))
    expect(recommendMode(rows)).toBe('audio')
  })

  it('needs evidence: null when no mode clears the floor', () => {
    const rows = modeOverview(progWithModes({ '2026-08-01': { audio: { asked: 5, correct: 0 } } }))
    expect(recommendMode(rows)).toBeNull()
  })

  it('ties keep the earlier fixed-order mode so the badge cannot flicker', () => {
    const rows = modeOverview(progWithModes({
      '2026-08-01': { recall: { asked: 10, correct: 6 }, audio: { asked: 10, correct: 6 } },
    }))
    expect(recommendMode(rows)).toBe('recall')
  })
})

describe('agoLabel', () => {
  it('names the near days and counts the rest', () => {
    expect(agoLabel(null, '2026-08-07')).toBe('未练过')
    expect(agoLabel('2026-08-07', '2026-08-07')).toBe('今天')
    expect(agoLabel('2026-08-06', '2026-08-07')).toBe('昨天')
    expect(agoLabel('2026-08-02', '2026-08-07')).toBe('5 天前')
  })
})
```

Note: if the test file already imports `emptyProgress`/`emptyStat` or has its own progress fixture, reuse those instead of duplicating.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pages/statsDerive.test.ts`
Expected: FAIL — `modeOverview` is not exported.

- [ ] **Step 3: Implement in `src/pages/statsDerive.ts`** (append after `modeAccuracy`)

```ts
export interface ModeOverviewRow {
  mode: QuizMetricKey
  label: string
  asked: number
  correct: number
  /** 0–1, or null until `asked` clears MODE_ACCURACY_MIN — below the floor one miss swings the figure 20 points, which reads as a skill change and isn't one. */
  rate: number | null
  /** YYYY-MM-DD this mode was last played; null if never. */
  lastPlayed: string | null
}

/**
 * One row per mode, all seven, fixed key order. Unlike modeAccuracy —
 * which serves a stats list where an unplayed mode is noise — the quiz
 * hub renders every mode as a card, and "never played" is a state the
 * card must show, not a reason to vanish.
 */
export function modeOverview(progress: Progress): ModeOverviewRow[] {
  const tally = new Map<QuizMetricKey, { asked: number; correct: number; last: string }>()
  for (const [date, day] of Object.entries(progress.dailyStats)) {
    for (const [mode, v] of Object.entries(day.quizModes ?? {})) {
      if (!(QUIZ_METRIC_KEYS as readonly string[]).includes(mode)) continue
      const key = mode as QuizMetricKey
      const prev = tally.get(key)
      tally.set(key, {
        asked: (prev?.asked ?? 0) + v.asked,
        correct: (prev?.correct ?? 0) + v.correct,
        last: prev === undefined || date > prev.last ? date : prev.last,
      })
    }
  }
  return QUIZ_METRIC_KEYS.map(mode => {
    const t = tally.get(mode)
    return {
      mode,
      label: QUIZ_METRIC_LABELS[mode],
      asked: t?.asked ?? 0,
      correct: t?.correct ?? 0,
      rate: t !== undefined && t.asked >= MODE_ACCURACY_MIN ? t.correct / t.asked : null,
      lastPlayed: t?.last ?? null,
    }
  })
}

/**
 * The mode most worth practising: lowest printable accuracy. Null when no
 * mode clears MODE_ACCURACY_MIN — a recommendation with no evidence
 * behind it would just be a random badge. Strict less-than keeps the
 * earlier fixed-order mode on a tie, so the badge cannot flicker between
 * renders.
 */
export function recommendMode(rows: ModeOverviewRow[]): QuizMetricKey | null {
  let best: ModeOverviewRow | null = null
  for (const r of rows) {
    if (r.rate === null) continue
    if (best === null || r.rate < best.rate) best = r
  }
  return best === null ? null : best.mode
}

/** Relative age for "last practised": 今天 / 昨天 / N 天前 / 未练过. */
export function agoLabel(date: string | null, today: string): string {
  if (date === null) return '未练过'
  if (date === today) return '今天'
  const days = Math.round((parseLocal(today).getTime() - parseLocal(date).getTime()) / 86400_000)
  if (days === 1) return '昨天'
  return `${days} 天前`
}
```

(`parseLocal`, `QUIZ_METRIC_KEYS`, `QUIZ_METRIC_LABELS`, `MODE_ACCURACY_MIN` already exist in this file's scope.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pages/statsDerive.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/statsDerive.ts src/pages/statsDerive.test.ts
git commit -m "feat(quiz): mode overview covers all seven surfaces, unplayed included"
```

---

### Task 2: Split Quiz.tsx into router + hub + session page

**Files:**
- Modify: `src/pages/Quiz.tsx`

- [ ] **Step 1: Extend MODES with card descriptions**

Replace the `MODES` const and its doc comment:

```tsx
/**
 * The seven practice surfaces. `?mode=` drives which one renders,
 * consistent with `/review?mode=lapses`; `/quiz` with no (or an unknown)
 * mode renders the hub.
 *
 * **This reverses the old "defaults to mixed, zero extra clicks" rule.**
 * That comment was written at four modes; at seven, the chip row had
 * stopped carrying information — no descriptions, no per-mode stats,
 * nothing marking a neglected mode. Sketch 002 (winner B) trades exactly
 * one tap for making the seven modes comparable at a glance; the mixed
 * card spans full width at the top so the every-day default stays the
 * largest, first target.
 */
const MODES = [
  { key: 'mixed', label: '综合', desc: '中英互认 + 例句填空,日常主力' },
  { key: 'recall', label: '回想', desc: '只看中文,回想英文词' },
  { key: 'contrast', label: '辨析', desc: '易混词对二选一' },
  { key: 'audio', label: '听音', desc: '听发音,选词义' },
  { key: 'sprint', label: '极速', desc: '60 秒,能答多少答多少' },
  { key: 'passage', label: '短文', desc: '整段文章挖空填词' },
  { key: 'guess', label: '猜词', desc: '按释义逐步猜出单词' },
] as const
```

- [ ] **Step 2: Replace the `Quiz` component with router + hub + session page**

Replace the existing `Quiz()` (keep `QuizSession` and everything above it) with:

```tsx
/**
 * Router: the mode param decides hub or session. Two separate components
 * rather than one branching render — hub and session own different hook
 * sets (the session loads passages/sense-groups), and a single component
 * switching between them would change its hook count between renders.
 */
export function Quiz() {
  const [params] = useSearchParams()
  const raw = params.get('mode')
  return isMode(raw) ? <QuizSessionPage mode={raw} /> : <QuizHub />
}

/** Card line: sprint and guess chase a personal best, the rest show accuracy once it clears the floor. */
function statLabel(key: QuizMetricKey, row: ModeOverviewRow | undefined, progress: Progress): string {
  if (key === 'sprint' && progress.bestSprint !== undefined) return `最高 ${progress.bestSprint.score} 题`
  if (key === 'guess' && progress.bestGuess !== undefined) return `最佳 ${progress.bestGuess.score} 词`
  if (row === undefined || row.asked === 0) return '—'
  if (row.rate === null) return `练过 ${row.asked} 题`
  return `${Math.round(row.rate * 100)}%`
}

function QuizHub() {
  const { progress } = useApp()
  const today = todayStr(new Date())
  const rows = useMemo(() => modeOverview(progress), [progress])
  const rec = useMemo(() => recommendMode(rows), [rows])
  const byKey = useMemo(() => new Map(rows.map(r => [r.mode, r])), [rows])

  return (
    <Page eyebrow="Quiz" title="测试" back="/">
      <div className="quiz-hub">
        {MODES.map(m => {
          const row = byKey.get(m.key)
          return (
            <Link
              key={m.key}
              to={`/quiz?mode=${m.key}`}
              className={`card card--interactive quiz-mode-card${m.key === 'mixed' ? ' quiz-mode-card--wide' : ''}`}
            >
              {rec === m.key && <span className="quiz-mode-card__badge">推荐</span>}
              <p className="quiz-mode-card__name">{m.label}</p>
              <p className="quiz-mode-card__desc">{m.desc}</p>
              <p className="quiz-mode-card__meta">
                <span className={`num quiz-mode-card__stat${rec === m.key ? ' quiz-mode-card__stat--low' : ''}`}>
                  {statLabel(m.key, row, progress)}
                </span>
                <span className="quiz-mode-card__ago">{agoLabel(row?.lastPlayed ?? null, today)}</span>
              </p>
            </Link>
          )
        })}
      </div>
    </Page>
  )
}

function QuizSessionPage({ mode }: { mode: QuizMode }) {
  const { words } = useApp()
  const [session, setSession] = useState(0)

  // ... (passages/groups loading effects, restart callback — moved verbatim
  //      from the old Quiz body; the switchMode function is deleted)

  return (
    <Page eyebrow="Quiz" title={MODE_LABEL[mode]} back="/quiz">
      {/* mode is folded into the key: ... (keep the existing comment) */}
      {/* ... the existing sprint/guess/recall/passage/QuizSession branches, verbatim */}
    </Page>
  )
}
```

Concretely, `QuizSessionPage` is the old `Quiz` body with these deltas:
1. `mode` arrives as a prop; delete `const raw = params.get('mode')`, the `isMode` fallback, `useSearchParams`, `setParams`, and the whole `switchMode` function (including its replace-vs-push comment — the concern is gone because sessions no longer switch modes in place; note that in the commit message).
2. Delete the `<div className="quiz-modes">…</div>` chip row and the `Chip` import.
3. `Page` gets `title={MODE_LABEL[mode]}` and `back="/quiz"` — a session's back returns to the hub, and the hub's back returns to Today. Add near MODES:
   ```tsx
   const MODE_LABEL: Record<QuizMode, string> = Object.fromEntries(MODES.map(m => [m.key, m.label])) as Record<QuizMode, string>
   ```
4. New imports at top of file: `useMemo` (add to the existing react import), `modeOverview`, `recommendMode`, `agoLabel` and type `ModeOverviewRow` from `./statsDerive`, `todayStr` from `../lib/srs`, `QuizMetricKey` type from `../lib/quiz`, `Progress` type from `../types`. Remove now-unused imports (`Chip`; `Card` only if nothing else in the file uses it — QuizSession still uses `Card`, so it stays).
5. `EMPTY_HINT`, `QuizSession`, and all session components stay untouched.

- [ ] **Step 3: Full gate**

Run: `npm test` then `npm run build`
Expected: pass. Fix any `noUnusedLocals` leftovers (the removed `Chip` import is the likely one).

- [ ] **Step 4: Commit**

```bash
git add src/pages/Quiz.tsx
git commit -m "feat(quiz): /quiz becomes a hub — chips stopped carrying information at seven modes"
```

---

### Task 3: Hub styles

**Files:**
- Modify: `src/pages/Quiz.css`

- [ ] **Step 1: Replace the `.quiz-modes` block with hub styles**

Delete the `.quiz-modes` / `.quiz-modes::-webkit-scrollbar` rules (the chip row is gone) and add in their place:

```css
/* --- Mode hub: one card per practice surface (sketch 002 winner B) --------
   2-col grid at 375px; the mixed card spans full width so the every-day
   default stays the largest, first target. Cards are <Link>s. */

.quiz-hub {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-3);
}

.quiz-mode-card {
  position: relative;
  display: grid;
  gap: var(--sp-1);
  align-content: start;
  text-decoration: none;
  color: inherit;
}

.quiz-mode-card--wide {
  grid-column: 1 / -1;
}

.quiz-mode-card__name {
  font-size: var(--fs-base);
  font-weight: 700;
}

.quiz-mode-card__desc {
  font-size: var(--fs-xs);
  line-height: var(--lh-snug);
  color: var(--text-faint);
}

.quiz-mode-card__meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
  padding-top: var(--sp-2);
  border-top: 1px solid var(--rule);
  font-size: var(--fs-xs);
  color: var(--text-muted);
}

.quiz-mode-card__stat {
  font-weight: 700;
}

/* The weak spot gets vermilion — annotation, one of its permitted uses. */
.quiz-mode-card__stat--low {
  color: var(--accent);
}

/* 推荐 badge: hangs off the card's top edge. Solid vermilion is otherwise
   reserved for destructive actions; this is the annotation exception the
   tokens header carves out for marks/eyebrows — it annotates the card, it
   isn't a button. Text tag + color, never color alone. */
.quiz-mode-card__badge {
  position: absolute;
  top: -1px;
  right: var(--sp-3);
  padding: 2px 8px 3px;
  border-radius: 0 0 var(--r-sm) var(--r-sm);
  background: var(--accent);
  color: var(--on-tone);
  font-size: var(--fs-eyebrow);
  font-weight: 700;
  letter-spacing: var(--tracking-eyebrow);
}
```

- [ ] **Step 2: Full gate**

Run: `npm test` then `npx oxlint` then `npm run build`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Quiz.css
git commit -m "feat(quiz): mode-card grid styles, chip-row styles retired"
```

---

## Self-review checklist (run before finishing)

- `/quiz` → hub; `/quiz?mode=guess` (old `/guess` redirect target) still
  opens 猜词 directly — verify `isMode` still gates exactly the seven keys.
- Hub/session split holds rules of hooks (two components, not one
  branching render).
- Session back goes to `/quiz`, hub back goes to `/`.
- The rewritten MODES comment records the reversal of the old
  zero-extra-clicks rule (comments cite reasons; the old reasoning must
  not silently vanish).
- `recordQuiz`, QuizSession, Sprint/Recall/Passage/Guess untouched.
- No unused imports (`noUnusedLocals`).
- 375px: 2-col cards fit; badge doesn't overflow the card edge.
