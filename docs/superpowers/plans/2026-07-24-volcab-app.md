# Volcab 记单词 PWA 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建免费托管在 GitHub Pages 的记单词 PWA:SM-2 间隔重复、快速测试、词库搜索、添加新词;进度经私有仓库 `volcab-data` 跨设备同步;初始词库从 `Volcab.enex` 提取并由 AI 生成词条。

**Architecture:** 纯前端 SPA(Vite + React + TS + HashRouter),无服务器。GitHub fine-grained PAT 即认证,所有数据读写走 GitHub Contents API。核心逻辑(SRS/合并/出题/解析)为纯函数模块,TDD 全覆盖;UI 层用 frontend-design skill 设计,手动验收。

**Tech Stack:** Vite 6, React 18, TypeScript, react-router-dom (HashRouter), vite-plugin-pwa, Vitest, tsx(脚本), gh CLI(部署)。

**Spec:** `docs/superpowers/specs/2026-07-24-volcab-app-design.md`(数据格式、算法参数、页面功能以 spec 为准)

**约定:**
- 本地仓库 `C:\Users\gaosi\repos\volcab` 即 app 仓库,GitHub 上建为公开仓库 `volcab-app`;默认分支 master。
- `Volcab.enex` 是个人笔记,**永不 git add**(写入 .gitignore)。
- UI 任务不做组件级 TDD(逻辑已全部在 lib 层测试),以行为契约 + 手动验收代替,这是计划的有意决定。

---

## 文件结构

```
volcab/
├── .gitignore                  # node_modules, dist, Volcab.enex, scripts/out
├── .github/workflows/deploy.yml
├── index.html
├── vite.config.ts              # vite + vitest + pwa 配置
├── package.json / tsconfig.json
├── scripts/
│   ├── parse-enex.ts           # ENEX → scripts/out/candidates.json
│   └── validate-words.ts       # words.json schema 校验
├── data/                       # 词库构建产物(之后推到 volcab-data 私有仓库)
│   ├── wordlist.json           # 最终词表 [{id, headword, sourceNote}]
│   └── words.json              # 完整词库
└── src/
    ├── main.tsx                # 入口 + SW 注册
    ├── App.tsx                 # HashRouter + 路由 + 底部导航
    ├── types.ts                # 全部共享类型
    ├── lib/
    │   ├── srs.ts              # SM-2 调度(纯函数)
    │   ├── queue.ts            # 每日队列构建(纯函数)
    │   ├── merge.ts            # 进度冲突合并(纯函数)
    │   ├── quiz.ts             # 测验出题(纯函数)
    │   ├── github.ts           # GitHub Contents API 客户端
    │   ├── storage.ts          # localStorage 封装
    │   └── tts.ts              # Web Speech 发音
    ├── state/store.tsx         # 全局状态 + 同步引擎(React Context)
    ├── pages/                  # Login/Today/Review/Quiz/Library/WordDetail/AddWord/Settings
    ├── components/             # frontend-design 期间产出的通用组件
    └── styles/                 # 设计系统 CSS
```

各 lib 模块单一职责、纯函数优先,测试文件同目录 `*.test.ts`。

---

## Phase 0 — 脚手架

### Task 1: Vite 项目脚手架

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `.gitignore`

- [ ] **Step 1: 脚手架并安装依赖**

```bash
cd C:/Users/gaosi/repos/volcab
npm create vite@latest . -- --template react-ts
npm i react-router-dom
npm i -D vitest happy-dom vite-plugin-pwa tsx @types/node
```

(vite 模板会提示目录非空——选择 Ignore files and continue;若模板覆盖了 docs/ 以外文件属正常。)

- [ ] **Step 2: 写 .gitignore**

```
node_modules
dist
dev-dist
Volcab.enex
scripts/out
*.local
```

- [ ] **Step 3: 替换 vite.config.ts**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/volcab-app/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Volcab 单词本',
        short_name: 'Volcab',
        description: '个人记单词 App',
        display: 'standalone',
        start_url: '/volcab-app/',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  test: { environment: 'happy-dom' },
})
```

- [ ] **Step 4: package.json scripts 确认为**

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "parse-enex": "tsx scripts/parse-enex.ts",
    "validate-words": "tsx scripts/validate-words.ts"
  }
}
```

- [ ] **Step 5: 验证**

Run: `npm run dev` → 打开 http://localhost:5173/volcab-app/ 能看到 Vite 默认页;`npm test` → 0 个测试通过(无失败)。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: Vite + React + TS 脚手架"
```

---

## Phase 1 — 核心逻辑(TDD)

### Task 2: 共享类型 types.ts

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: 写入完整类型定义**

```ts
export interface Meaning { pos: string; en: string; zh: string }

export interface Word {
  id: string          // 词元小写,唯一
  headword: string
  phonetic: string    // 美式,形如 /ˈæbrəɡeɪt/
  meanings: Meaning[]
  examples: string[]  // 2-3 句现代生活/工作场景例句
  synonyms: string[]
  antonyms: string[]
  collocations: string[]
  sourceNote: string  // 来源笔记标题,手动添加为 "manual"
  addedAt: string     // YYYY-MM-DD
}

export interface WordsFile { version: 1; words: Word[] }

export type WordState = 'new' | 'learning' | 'review'
export type Grade = 'again' | 'hard' | 'good' | 'easy'

export interface ProgressEntry {
  state: WordState
  ease: number
  intervalDays: number
  due: string            // YYYY-MM-DD
  stepIndex: number      // learning 步长下标;review 阶段置 0
  reps: number
  lapses: number
  lastReviewedAt: string // ISO 时间戳,冲突合并的依据
}

export interface DailyStat { reviewed: number; newLearned: number; correct: number; quizTaken: number }

export interface Progress {
  version: 1
  settings: { newPerDay: number }
  words: Record<string, ProgressEntry>
  dailyStats: Record<string, DailyStat>
}

export const emptyProgress = (): Progress => ({
  version: 1,
  settings: { newPerDay: 10 },
  words: {},
  dailyStats: {},
})

export const emptyStat = (): DailyStat => ({ reviewed: 0, newLearned: 0, correct: 0, quizTaken: 0 })
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts && git commit -m "feat: 共享类型定义"
```

### Task 3: SM-2 调度器 srs.ts

**Files:**
- Create: `src/lib/srs.ts`
- Test: `src/lib/srs.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { addDays, gradeWord, todayStr } from './srs'
import type { ProgressEntry } from '../types'

const now = new Date(2026, 6, 24, 10, 0, 0) // 2026-07-24 本地时间
const noFuzz = () => 0.5 // fuzz 因子 = 1.0

const reviewEntry = (over: Partial<ProgressEntry> = {}): ProgressEntry => ({
  state: 'review', ease: 2.5, intervalDays: 10, due: '2026-07-24',
  stepIndex: 0, reps: 3, lapses: 0, lastReviewedAt: '2026-07-14T00:00:00Z', ...over,
})

describe('todayStr/addDays', () => {
  it('格式化本地日期', () => expect(todayStr(now)).toBe('2026-07-24'))
  it('跨月加天数', () => expect(addDays('2026-07-30', 3)).toBe('2026-08-02'))
})

describe('新词学习阶段', () => {
  it('新词打良好 → 进入下一步长,今天重现', () => {
    const e = gradeWord(undefined, 'good', now, noFuzz)
    expect(e.state).toBe('learning')
    expect(e.stepIndex).toBe(1)
    expect(e.due).toBe('2026-07-24')
  })
  it('走完步长毕业 → review,间隔 1 天', () => {
    const s1 = gradeWord(undefined, 'good', now, noFuzz)
    const s2 = gradeWord(s1, 'good', now, noFuzz)
    expect(s2.state).toBe('review')
    expect(s2.intervalDays).toBe(1)
    expect(s2.due).toBe('2026-07-25')
  })
  it('新词打简单 → 直接毕业,间隔 4 天', () => {
    const e = gradeWord(undefined, 'easy', now, noFuzz)
    expect(e.state).toBe('review')
    expect(e.intervalDays).toBe(4)
  })
  it('学习中打重来 → 回到第 0 步', () => {
    const s1 = gradeWord(undefined, 'good', now, noFuzz)
    const e = gradeWord(s1, 'again', now, noFuzz)
    expect(e.stepIndex).toBe(0)
    expect(e.state).toBe('learning')
  })
})

describe('复习阶段', () => {
  it('良好 → 间隔 × ease', () => {
    const e = gradeWord(reviewEntry(), 'good', now, noFuzz)
    expect(e.intervalDays).toBe(25)
    expect(e.due).toBe(addDays('2026-07-24', 25))
  })
  it('困难 → 间隔 ×1.2,ease −0.15', () => {
    const e = gradeWord(reviewEntry(), 'hard', now, noFuzz)
    expect(e.intervalDays).toBe(12)
    expect(e.ease).toBeCloseTo(2.35)
  })
  it('简单 → 间隔 × ease×1.3,ease +0.15', () => {
    const e = gradeWord(reviewEntry(), 'easy', now, noFuzz)
    expect(e.ease).toBeCloseTo(2.65)
    expect(e.intervalDays).toBe(Math.round(10 * 2.65 * 1.3))
  })
  it('重来 → lapse+1,ease −0.2,回学习阶段今天到期', () => {
    const e = gradeWord(reviewEntry(), 'again', now, noFuzz)
    expect(e.lapses).toBe(1)
    expect(e.ease).toBeCloseTo(2.3)
    expect(e.state).toBe('learning')
    expect(e.due).toBe('2026-07-24')
  })
  it('ease 不低于 1.3', () => {
    const e = gradeWord(reviewEntry({ ease: 1.3 }), 'hard', now, noFuzz)
    expect(e.ease).toBe(1.3)
  })
  it('间隔封顶 365 天', () => {
    const e = gradeWord(reviewEntry({ intervalDays: 300, ease: 2.5 }), 'good', now, noFuzz)
    expect(e.intervalDays).toBe(365)
  })
  it('间隔至少前进 1 天', () => {
    const e = gradeWord(reviewEntry({ intervalDays: 1, ease: 1.3 }), 'hard', now, noFuzz)
    expect(e.intervalDays).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/lib/srs.test.ts`
Expected: FAIL,`Cannot find module './srs'`

- [ ] **Step 3: 实现 srs.ts**

```ts
import type { Grade, ProgressEntry } from '../types'

export const LEARNING_STEPS = 2      // 学习步数:当次会话内 1 分钟、10 分钟重现
export const MIN_EASE = 1.3
export const MAX_INTERVAL_DAYS = 365
const GRADUATE_DAYS = 1
const EASY_GRADUATE_DAYS = 4

export function todayStr(now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return todayStr(new Date(y, m - 1, d + days))
}

const freshEntry = (now: Date): ProgressEntry => ({
  state: 'learning', ease: 2.5, intervalDays: 0, due: todayStr(now),
  stepIndex: 0, reps: 0, lapses: 0, lastReviewedAt: now.toISOString(),
})

// ±5% 随机模糊,3 天以内不模糊
function fuzz(days: number, rng: () => number): number {
  if (days < 3) return Math.min(days, MAX_INTERVAL_DAYS)
  const factor = 1 + (rng() * 2 - 1) * 0.05
  return Math.min(MAX_INTERVAL_DAYS, Math.max(1, Math.round(days * factor)))
}

export function gradeWord(
  prev: ProgressEntry | undefined,
  grade: Grade,
  now: Date,
  rng: () => number = Math.random,
): ProgressEntry {
  const e = prev && prev.state !== 'new' ? { ...prev } : freshEntry(now)
  e.reps += 1
  e.lastReviewedAt = now.toISOString()
  const today = todayStr(now)

  if (e.state === 'learning') {
    if (grade === 'again') { e.stepIndex = 0; e.due = today }
    else if (grade === 'hard') { e.due = today }
    else if (grade === 'easy') graduate(e, EASY_GRADUATE_DAYS, today, rng)
    else if (e.stepIndex + 1 < LEARNING_STEPS) { e.stepIndex += 1; e.due = today }
    else graduate(e, GRADUATE_DAYS, today, rng)
    return e
  }

  // review 阶段
  if (grade === 'again') {
    e.lapses += 1
    e.ease = Math.max(MIN_EASE, e.ease - 0.2)
    e.state = 'learning'
    e.stepIndex = 0
    e.intervalDays = 0
    e.due = today
    return e
  }
  let next: number
  if (grade === 'hard') {
    e.ease = Math.max(MIN_EASE, e.ease - 0.15)
    next = e.intervalDays * 1.2
  } else if (grade === 'good') {
    next = e.intervalDays * e.ease
  } else {
    e.ease += 0.15
    next = e.intervalDays * e.ease * 1.3
  }
  e.intervalDays = fuzz(Math.max(e.intervalDays + 1, Math.round(next)), rng)
  e.due = addDays(today, e.intervalDays)
  return e
}

function graduate(e: ProgressEntry, days: number, today: string, rng: () => number) {
  e.state = 'review'
  e.stepIndex = 0
  e.intervalDays = fuzz(days, rng)
  e.due = addDays(today, e.intervalDays)
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/lib/srs.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/srs.ts src/lib/srs.test.ts && git commit -m "feat: SM-2 间隔重复调度器"
```

### Task 4: 每日队列 queue.ts

**Files:**
- Create: `src/lib/queue.ts`
- Test: `src/lib/queue.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { buildQueue } from './queue'
import { emptyProgress } from '../types'
import type { Progress, Word } from '../types'

const word = (id: string): Word => ({
  id, headword: id, phonetic: '/x/', meanings: [{ pos: 'n.', en: 'x', zh: 'x' }],
  examples: ['a', 'b'], synonyms: [], antonyms: [], collocations: [], sourceNote: 't', addedAt: '2026-07-01',
})
const words = ['alpha', 'bravo', 'carol', 'delta', 'echo'].map(word)

const prog = (): Progress => {
  const p = emptyProgress()
  p.settings.newPerDay = 2
  p.words['alpha'] = { state: 'review', ease: 2.5, intervalDays: 5, due: '2026-07-20', stepIndex: 0, reps: 2, lapses: 0, lastReviewedAt: '2026-07-15T00:00:00Z' }
  p.words['bravo'] = { state: 'learning', ease: 2.5, intervalDays: 0, due: '2026-07-24', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-24T00:00:00Z' }
  p.words['carol'] = { state: 'review', ease: 2.5, intervalDays: 30, due: '2026-08-10', stepIndex: 0, reps: 5, lapses: 0, lastReviewedAt: '2026-07-10T00:00:00Z' }
  return p
}

describe('buildQueue', () => {
  it('到期词进 due:learning 优先,再按 due 日期排序;未到期不进', () => {
    const q = buildQueue(words, prog(), '2026-07-24')
    expect(q.due).toEqual(['bravo', 'alpha'])
  })
  it('新词按词库顺序取,数量 = newPerDay − 今日已学', () => {
    const q = buildQueue(words, prog(), '2026-07-24')
    expect(q.fresh).toEqual(['delta', 'echo'])
    const p2 = prog()
    p2.dailyStats['2026-07-24'] = { reviewed: 0, newLearned: 1, correct: 0, quizTaken: 0 }
    expect(buildQueue(words, p2, '2026-07-24').fresh).toEqual(['delta'])
  })
  it('新词额度用完则为空', () => {
    const p = prog()
    p.dailyStats['2026-07-24'] = { reviewed: 0, newLearned: 2, correct: 0, quizTaken: 0 }
    expect(buildQueue(words, p, '2026-07-24').fresh).toEqual([])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/lib/queue.test.ts` → FAIL(模块不存在)

- [ ] **Step 3: 实现 queue.ts**

```ts
import type { Progress, Word } from '../types'

export interface DailyQueue { due: string[]; fresh: string[] }

export function buildQueue(words: Word[], progress: Progress, today: string): DailyQueue {
  const due = words
    .filter(w => {
      const e = progress.words[w.id]
      return e && e.state !== 'new' && e.due <= today
    })
    .map(w => w.id)
    .sort((a, b) => {
      const ea = progress.words[a], eb = progress.words[b]
      if (ea.state !== eb.state) return ea.state === 'learning' ? -1 : 1
      if (ea.due !== eb.due) return ea.due < eb.due ? -1 : 1
      return a.localeCompare(b)
    })

  const learnedToday = progress.dailyStats[today]?.newLearned ?? 0
  const budget = Math.max(0, progress.settings.newPerDay - learnedToday)
  const fresh = words
    .filter(w => !progress.words[w.id] || progress.words[w.id].state === 'new')
    .slice(0, budget)
    .map(w => w.id)

  return { due, fresh }
}
```

- [ ] **Step 4: 运行确认通过** → `npx vitest run src/lib/queue.test.ts` 全 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/queue.ts src/lib/queue.test.ts && git commit -m "feat: 每日复习队列构建"
```

### Task 5: 进度合并 merge.ts

**Files:**
- Create: `src/lib/merge.ts`
- Test: `src/lib/merge.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { mergeProgress } from './merge'
import { emptyProgress } from '../types'
import type { ProgressEntry } from '../types'

const entry = (lastReviewedAt: string, reps: number): ProgressEntry => ({
  state: 'review', ease: 2.5, intervalDays: 3, due: '2026-07-30',
  stepIndex: 0, reps, lapses: 0, lastReviewedAt,
})

describe('mergeProgress', () => {
  it('每个词取 lastReviewedAt 较新的记录', () => {
    const local = emptyProgress(), remote = emptyProgress()
    local.words['a'] = entry('2026-07-24T10:00:00Z', 5)
    remote.words['a'] = entry('2026-07-23T10:00:00Z', 4)
    remote.words['b'] = entry('2026-07-24T09:00:00Z', 2)
    const m = mergeProgress(local, remote)
    expect(m.words['a'].reps).toBe(5)
    expect(m.words['b'].reps).toBe(2)
  })
  it('dailyStats 按日按字段取最大值', () => {
    const local = emptyProgress(), remote = emptyProgress()
    local.dailyStats['2026-07-24'] = { reviewed: 10, newLearned: 3, correct: 8, quizTaken: 0 }
    remote.dailyStats['2026-07-24'] = { reviewed: 6, newLearned: 5, correct: 5, quizTaken: 1 }
    remote.dailyStats['2026-07-23'] = { reviewed: 20, newLearned: 10, correct: 18, quizTaken: 2 }
    const m = mergeProgress(local, remote)
    expect(m.dailyStats['2026-07-24']).toEqual({ reviewed: 10, newLearned: 5, correct: 8, quizTaken: 1 })
    expect(m.dailyStats['2026-07-23'].reviewed).toBe(20)
  })
  it('settings 以本地为准', () => {
    const local = emptyProgress(), remote = emptyProgress()
    local.settings.newPerDay = 20
    expect(mergeProgress(local, remote).settings.newPerDay).toBe(20)
  })
})
```

- [ ] **Step 2: 运行确认失败** → `npx vitest run src/lib/merge.test.ts` FAIL

- [ ] **Step 3: 实现 merge.ts**

```ts
import type { Progress } from '../types'

export function mergeProgress(local: Progress, remote: Progress): Progress {
  const words: Progress['words'] = { ...remote.words }
  for (const [id, le] of Object.entries(local.words)) {
    const re = words[id]
    if (!re || le.lastReviewedAt >= re.lastReviewedAt) words[id] = le
  }

  const dailyStats: Progress['dailyStats'] = {}
  const days = new Set([...Object.keys(local.dailyStats), ...Object.keys(remote.dailyStats)])
  for (const day of days) {
    const a = local.dailyStats[day], b = remote.dailyStats[day]
    if (!a || !b) { dailyStats[day] = a ?? b; continue }
    dailyStats[day] = {
      reviewed: Math.max(a.reviewed, b.reviewed),
      newLearned: Math.max(a.newLearned, b.newLearned),
      correct: Math.max(a.correct, b.correct),
      quizTaken: Math.max(a.quizTaken, b.quizTaken),
    }
  }

  return { version: 1, settings: local.settings, words, dailyStats }
}
```

- [ ] **Step 4: 运行确认通过** → 全 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/merge.ts src/lib/merge.test.ts && git commit -m "feat: 双设备进度冲突合并"
```

### Task 6: 测验出题 quiz.ts

**Files:**
- Create: `src/lib/quiz.ts`
- Test: `src/lib/quiz.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { generateQuiz } from './quiz'
import { emptyProgress } from '../types'
import type { Progress, Word } from '../types'

const word = (id: string, zh: string): Word => ({
  id, headword: id, phonetic: `/${id}/`, meanings: [{ pos: 'v.', en: `def of ${id}`, zh }],
  examples: ['a', 'b'], synonyms: [], antonyms: [], collocations: [], sourceNote: 't', addedAt: '2026-07-01',
})
const words = [word('alpha', '甲'), word('bravo', '乙'), word('carol', '丙'), word('delta', '丁'), word('echo', '戊'), word('fox', '己')]

const studied = (): Progress => {
  const p = emptyProgress()
  for (const w of words) {
    p.words[w.id] = { state: 'review', ease: 2.5, intervalDays: 3, due: '2026-08-01', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-20T00:00:00Z' }
  }
  return p
}
const seq = () => { let i = 0; return () => ((i = (i + 7) % 13), i / 13) }

describe('generateQuiz', () => {
  it('生成指定数量,题型轮换,不重复选词', () => {
    const qs = generateQuiz(words, studied(), 6, seq())
    expect(qs).toHaveLength(6)
    expect(new Set(qs.map(q => q.wordId)).size).toBe(6)
    expect(new Set(qs.map(q => q.type)).size).toBe(3)
  })
  it('选择题 4 个选项且含正确答案,选项不重复', () => {
    const qs = generateQuiz(words, studied(), 6, seq())
    for (const q of qs.filter(q => q.type !== 'spelling')) {
      expect(q.options).toHaveLength(4)
      expect(new Set(q.options).size).toBe(4)
      expect(q.options).toContain(q.answer)
    }
  })
  it('拼写题无选项,答案为词头', () => {
    const qs = generateQuiz(words, studied(), 6, seq())
    const sp = qs.find(q => q.type === 'spelling')!
    expect(sp.options).toEqual([])
    expect(sp.answer).toBe(sp.wordId)
  })
  it('已学词不足 4 个时回退用全词库', () => {
    const qs = generateQuiz(words, emptyProgress(), 4, seq())
    expect(qs).toHaveLength(4)
  })
  it('词库不足 4 个时返回空', () => {
    expect(generateQuiz(words.slice(0, 3), emptyProgress(), 5, seq())).toEqual([])
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 实现 quiz.ts**

```ts
import type { Progress, Word } from '../types'

export type QuizType = 'word2meaning' | 'meaning2word' | 'spelling'

export interface QuizQuestion {
  type: QuizType
  wordId: string
  prompt: string
  options: string[]   // spelling 题为 []
  answer: string
}

const meaningLabel = (w: Word) => {
  const m = w.meanings[0]
  return `${m.pos} ${m.zh}`
}

export function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function generateQuiz(
  words: Word[],
  progress: Progress,
  count: number,
  rng: () => number = Math.random,
): QuizQuestion[] {
  const learned = words.filter(w => progress.words[w.id] && progress.words[w.id].state !== 'new')
  const pool = learned.length >= 4 ? learned : words
  if (pool.length < 4) return []

  const picked = shuffle(pool, rng).slice(0, Math.min(count, pool.length))
  const types: QuizType[] = ['word2meaning', 'meaning2word', 'spelling']

  return picked.map((w, i) => {
    const type = types[i % types.length]
    const distractors = shuffle(pool.filter(x => x.id !== w.id), rng).slice(0, 3)
    if (type === 'word2meaning') {
      return {
        type, wordId: w.id, prompt: w.headword,
        options: shuffle([w, ...distractors].map(meaningLabel), rng),
        answer: meaningLabel(w),
      }
    }
    if (type === 'meaning2word') {
      return {
        type, wordId: w.id, prompt: meaningLabel(w),
        options: shuffle([w, ...distractors].map(x => x.headword), rng),
        answer: w.headword,
      }
    }
    return {
      type, wordId: w.id,
      prompt: `${meaningLabel(w)}  ${w.phonetic}`,
      options: [], answer: w.headword,
    }
  })
}
```

- [ ] **Step 4: 运行确认通过** → 全 PASS(若"选项不重复"因中文释义撞车而偶发失败,说明干扰项取样需按释义去重:把 `distractors` 改为先 `filter(x => meaningLabel(x) !== meaningLabel(w))` 再去重取 3 个;测试数据中释义互不相同,正常应直接通过)

- [ ] **Step 5: Commit**

```bash
git add src/lib/quiz.ts src/lib/quiz.test.ts && git commit -m "feat: 快速测验出题器"
```

### Task 7: GitHub API 客户端 github.ts

**Files:**
- Create: `src/lib/github.ts`
- Test: `src/lib/github.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fromBase64, GitHubClient, toBase64 } from './github'

afterEach(() => vi.unstubAllGlobals())

const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status })

describe('base64 中文安全', () => {
  it('roundtrip', () => {
    const s = '废除;废止 /ˈæbrəɡeɪt/ — "quotes"'
    expect(fromBase64(toBase64(s))).toBe(s)
  })
  it('容忍 GitHub 返回的换行分段', () => {
    const b64 = toBase64('hello world')
    const chunked = b64.slice(0, 4) + '\n' + b64.slice(4)
    expect(fromBase64(chunked)).toBe('hello world')
  })
})

describe('GitHubClient', () => {
  const client = new GitHubClient('tok', 'me', 'volcab-data')

  it('getFile: 404 → null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(404, {})))
    expect(await client.getFile('progress.json')).toBeNull()
  })
  it('getFile: 解码 content 并返回 sha', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(200, { content: toBase64('{"a":1}'), sha: 'abc' })))
    expect(await client.getFile('progress.json')).toEqual({ content: '{"a":1}', sha: 'abc' })
  })
  it('putFile: 409/422 → conflict', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(409, {})))
    expect(await client.putFile('p.json', '{}', 'msg', 'oldsha')).toBe('conflict')
  })
  it('putFile: 成功返回新 sha', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(200, { content: { sha: 'new' } })))
    expect(await client.putFile('p.json', '{}', 'msg')).toEqual({ sha: 'new' })
  })
  it('whoAmI: 401 抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(401, {})))
    await expect(GitHubClient.whoAmI('bad')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 实现 github.ts**

```ts
const API = 'https://api.github.com'

export interface RemoteFile { content: string; sha: string }

export class GitHubClient {
  constructor(
    private token: string,
    private owner: string,
    private repo: string,
  ) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
  }

  /** 返回 token 对应的 GitHub 用户名;无效抛错 */
  static async whoAmI(token: string): Promise<string> {
    const res = await fetch(`${API}/user`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) throw new Error(`Token 无效或已过期 (HTTP ${res.status})`)
    return (await res.json()).login as string
  }

  /** 确认 token 能访问数据仓库 */
  async validate(): Promise<void> {
    const res = await fetch(`${API}/repos/${this.owner}/${this.repo}`, { headers: this.headers() })
    if (res.status === 404) throw new Error(`找不到 ${this.owner}/${this.repo}——请确认 token 已勾选该仓库的访问权限`)
    if (!res.ok) throw new Error(`无法访问数据仓库 (HTTP ${res.status})`)
  }

  async getFile(path: string): Promise<RemoteFile | null> {
    const res = await fetch(`${API}/repos/${this.owner}/${this.repo}/contents/${path}`, {
      headers: this.headers(),
      cache: 'no-store',
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`读取 ${path} 失败 (HTTP ${res.status})`)
    const data = await res.json()
    return { content: fromBase64(data.content), sha: data.sha }
  }

  /** sha 不匹配(他端已推送)返回 'conflict',调用方负责合并重试 */
  async putFile(path: string, content: string, message: string, sha?: string): Promise<{ sha: string } | 'conflict'> {
    const res = await fetch(`${API}/repos/${this.owner}/${this.repo}/contents/${path}`, {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: toBase64(content), ...(sha ? { sha } : {}) }),
    })
    if (res.status === 409 || res.status === 422) return 'conflict'
    if (!res.ok) throw new Error(`写入 ${path} 失败 (HTTP ${res.status})`)
    return { sha: (await res.json()).content.sha as string }
  }
}

export function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''))
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))
}
```

- [ ] **Step 4: 运行确认通过** → 全 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/github.ts src/lib/github.test.ts && git commit -m "feat: GitHub Contents API 客户端"
```

### Task 8: storage.ts 与 tts.ts

**Files:**
- Create: `src/lib/storage.ts`, `src/lib/tts.ts`
- Test: `src/lib/storage.test.ts`

- [ ] **Step 1: 写失败测试(storage)**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { storage } from './storage'

beforeEach(() => localStorage.clear())

describe('storage', () => {
  it('set/get JSON roundtrip', () => {
    storage.set('progress', { version: 1 })
    expect(storage.get('progress')).toEqual({ version: 1 })
  })
  it('不存在返回 null', () => expect(storage.get('token')).toBeNull())
  it('损坏的 JSON 返回 null 而不抛错', () => {
    localStorage.setItem('volcab.progress', '{oops')
    expect(storage.get('progress')).toBeNull()
  })
  it('clearAll 清空全部本键', () => {
    storage.set('token', 't'); storage.set('owner', 'o')
    storage.clearAll()
    expect(storage.get('token')).toBeNull()
    expect(storage.get('owner')).toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 实现 storage.ts 与 tts.ts**

```ts
// src/lib/storage.ts
const KEYS = {
  token: 'volcab.token',
  owner: 'volcab.owner',
  words: 'volcab.words',
  wordsSha: 'volcab.wordsSha',
  progress: 'volcab.progress',
  progressSha: 'volcab.progressSha',
  dirty: 'volcab.dirty',
} as const

export type StorageKey = keyof typeof KEYS

export const storage = {
  get<T>(key: StorageKey): T | null {
    const raw = localStorage.getItem(KEYS[key])
    if (raw == null) return null
    try { return JSON.parse(raw) as T } catch { return null }
  },
  set(key: StorageKey, value: unknown): void {
    localStorage.setItem(KEYS[key], JSON.stringify(value))
  },
  remove(key: StorageKey): void {
    localStorage.removeItem(KEYS[key])
  },
  clearAll(): void {
    for (const k of Object.values(KEYS)) localStorage.removeItem(k)
  },
}
```

```ts
// src/lib/tts.ts
export function speak(text: string): void {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'en-US'
  u.rate = 0.9
  const voice = window.speechSynthesis.getVoices().find(v => v.lang.startsWith('en'))
  if (voice) u.voice = voice
  window.speechSynthesis.speak(u)
}
```

- [ ] **Step 4: 运行确认通过** → `npm test` 全绿

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage.ts src/lib/storage.test.ts src/lib/tts.ts && git commit -m "feat: 本地存储与 TTS 发音"
```

---

## Phase 2 — 初始词库构建

### Task 9: ENEX 解析脚本

**Files:**
- Create: `scripts/parse-enex.ts`
- Test: `scripts/parse-enex.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { parseEnex } from './parse-enex'

const sample = `<?xml version="1.0"?>
<en-export>
  <note>
    <title>12-15</title>
    <content><![CDATA[<en-note><div>Her <b>austere</b> (strict) demeanor was <b>unobtrusive</b>. She worked <b>surreptitiously </b>to win.</div><div>&nbsp;&amp; more</div></en-note>]]></content>
  </note>
  <note>
    <title>101-103</title>
    <content><![CDATA[<en-note><div>A journey of endurance and zenith.</div></en-note>]]></content>
  </note>
</en-export>`

describe('parseEnex', () => {
  it('提取每篇笔记的标题、粗体词、纯文本', () => {
    const notes = parseEnex(sample)
    expect(notes).toHaveLength(2)
    expect(notes[0].title).toBe('12-15')
    expect(notes[0].boldTerms).toEqual(['austere', 'unobtrusive', 'surreptitiously'])
    expect(notes[0].text).toContain('austere (strict) demeanor')
    expect(notes[0].text).toContain('& more')
    expect(notes[0].text).not.toContain('<')
    expect(notes[1].boldTerms).toEqual([])
  })
})
```

- [ ] **Step 2: 运行确认失败** → `npx vitest run scripts/parse-enex.test.ts` FAIL

- [ ] **Step 3: 实现 parse-enex.ts**

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

export interface NoteOut { title: string; boldTerms: string[]; text: string }

export function parseEnex(xml: string): NoteOut[] {
  const notes: NoteOut[] = []
  for (const m of xml.matchAll(/<note>([\s\S]*?)<\/note>/g)) {
    const block = m[1]
    const title = block.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''
    const cdata = block.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] ?? ''
    const boldTerms = [...cdata.matchAll(/<b>([\s\S]*?)<\/b>/g)]
      .map(b => clean(b[1]))
      .filter(t => t.length > 0)
    notes.push({ title, boldTerms, text: clean(cdata) })
  }
  return notes
}

function clean(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

// CLI 入口:npm run parse-enex
if (process.argv[1]?.replace(/\\/g, '/').endsWith('parse-enex.ts')) {
  const xml = readFileSync('Volcab.enex', 'utf8')
  const notes = parseEnex(xml)
  mkdirSync('scripts/out', { recursive: true })
  writeFileSync('scripts/out/candidates.json', JSON.stringify(notes, null, 2))
  console.log(`解析 ${notes.length} 篇笔记,粗体词共 ${notes.reduce((n, x) => n + x.boldTerms.length, 0)} 个`)
}
```

- [ ] **Step 4: 运行确认通过**,然后跑真实数据

Run: `npx vitest run scripts/parse-enex.test.ts` → PASS
Run: `npm run parse-enex` → 输出 `解析 26 篇笔记,粗体词共 N 个`,生成 `scripts/out/candidates.json`

- [ ] **Step 5: Commit**

```bash
git add scripts/parse-enex.ts scripts/parse-enex.test.ts && git commit -m "feat: ENEX 解析脚本"
```

### Task 10: 定稿词表 wordlist.json(AI 判断步骤)

**Files:**
- Create: `data/wordlist.json`

此任务由执行 agent 通读 `scripts/out/candidates.json` 完成,不是纯脚本。规则:

- [ ] **Step 1: 收集候选词**
  - 全部 `boldTerms`;
  - 各笔记 `text` 中带括号释义的词(如 `veneer (thin layer)`、`vindicated (prove to be innocent)`——这些在部分笔记里是斜体不是粗体);
  - 无任何标记的笔记(如 101-103、104-106)以及有标记笔记的正文里,agent 判断的 CEFR C1+ 难词(如 zenith, siesta, foible, reticent, indelible, depredation)。

- [ ] **Step 2: 清洗规则(逐条应用)**
  1. 多词短语:核心难词入词条(`dovetailing her skills with` → `dovetail`),短语本身写入该词条 collocations 备用;无核心难词的整段短语(如 `in the face of uncertainty`)丢弃。
  2. 还原词元:`abrogated` → `abrogate`,`surreptitiously` → `surreptitious`(副词/名词若为更常用形式则保留该形式)。
  3. 丢弃常见词(CEFR B2 及以下,如 `dishonesty`, `newfound power` 中的 newfound 保留与否由 agent 判断难度)。
  4. 跨笔记去重:首次出现的笔记作为 `sourceNote`。
  5. id = 词元小写;含空格的短语词条 id 用连字符(如 `ad-hoc`)。

- [ ] **Step 3: 产出文件**

`data/wordlist.json` 格式:

```json
{ "version": 1, "entries": [ { "id": "abrogate", "headword": "abrogate", "sourceNote": "12-15" } ] }
```

预期规模 500–800 条;若明显低于 400,回头检查是否漏了无标记笔记的难词。

- [ ] **Step 4: 抽查**:随机抽 3 篇笔记,人工比对笔记原文,确认粗体词无遗漏、词元还原正确。

- [ ] **Step 5: Commit**

```bash
git add data/wordlist.json && git commit -m "data: 从 Evernote 笔记定稿初始词表"
```

### Task 11: 词库校验脚本

**Files:**
- Create: `scripts/validate-words.ts`

- [ ] **Step 1: 实现校验脚本**(脚本本身即测试工具,不另写单测)

```ts
import { readFileSync } from 'node:fs'

const file = process.argv[2] ?? 'data/words.json'
const data = JSON.parse(readFileSync(file, 'utf8'))
const errors: string[] = []

if (data.version !== 1) errors.push('version 必须为 1')
if (!Array.isArray(data.words)) { console.error('words 必须是数组'); process.exit(1) }

const seen = new Set<string>()
for (const w of data.words) {
  const ctx = w.id ?? '(缺 id)'
  if (!w.id || w.id !== String(w.id).toLowerCase().trim()) errors.push(`${ctx}: id 必须为小写且无空白`)
  if (seen.has(w.id)) errors.push(`${ctx}: id 重复`)
  seen.add(w.id)
  if (!w.headword) errors.push(`${ctx}: 缺 headword`)
  if (!/^\/.+\/$/.test(w.phonetic ?? '')) errors.push(`${ctx}: phonetic 需形如 /.../`)
  if (!Array.isArray(w.meanings) || w.meanings.length === 0) errors.push(`${ctx}: meanings 为空`)
  for (const m of w.meanings ?? []) {
    if (!m.pos || !m.en || !m.zh) errors.push(`${ctx}: meaning 缺 pos/en/zh`)
  }
  if (!Array.isArray(w.examples) || w.examples.length < 2) errors.push(`${ctx}: examples 至少 2 句`)
  for (const k of ['synonyms', 'antonyms', 'collocations'] as const) {
    if (!Array.isArray(w[k])) errors.push(`${ctx}: ${k} 必须是数组`)
  }
  if (!w.sourceNote) errors.push(`${ctx}: 缺 sourceNote`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(w.addedAt ?? '')) errors.push(`${ctx}: addedAt 需为 YYYY-MM-DD`)
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1) }
console.log(`OK: ${data.words.length} 个词条通过校验`)
```

- [ ] **Step 2: 用坏数据验证脚本会报错**

Run: `echo {"version":1,"words":[{"id":"BAD"}]} > scripts/out/bad.json; npm run validate-words scripts/out/bad.json`
Expected: 列出多条错误,exit 1

- [ ] **Step 3: Commit**

```bash
git add scripts/validate-words.ts && git commit -m "feat: words.json schema 校验脚本"
```

### Task 12: AI 批量生成词库 words.json

**Files:**
- Create: `data/words.json`

由执行 agent 分批完成(每批 25 词,按 wordlist.json 顺序),可用并行 subagent 加速。

- [ ] **Step 1: 每批按以下提示词要求生成词条 JSON**

> 为下列英文单词各生成一个 JSON 词条,字段:id(给定)、headword(给定)、phonetic(美式 IPA,/.../ 格式)、meanings(该词**常用义项全覆盖**,每项 {pos, en, zh},en 为简明英文释义,zh 为准确中文释义)、examples(2–3 句,**现代生活/工作场景**:职场会议、项目 deadline、通勤、健身、社交媒体、旅行、租房、点外卖等;句子自然地道,体现词的典型用法;多义词的例句覆盖主要义项)、synonyms(3–5 个)、antonyms(0–3 个,没有就空数组)、collocations(2–4 个常见搭配)、sourceNote(给定)、addedAt("2026-07-24")。只输出 JSON 数组。

- [ ] **Step 2: 合并所有批次** → `data/words.json`:`{ "version": 1, "words": [ ...全部词条 ] }`

- [ ] **Step 3: 校验**

Run: `npm run validate-words`
Expected: `OK: N 个词条通过校验`(N 与 wordlist 条数一致);失败则修复对应词条重跑。

- [ ] **Step 4: 抽查质量**:随机抽 10 词人工核对——音标正确、中文释义准确、例句自然且是现代场景、同义词合理。发现系统性问题(如例句书面化)则修正提示词重生成该批。

- [ ] **Step 5: Commit**

```bash
git add data/words.json && git commit -m "data: AI 生成完整词库"
```

---

## Phase 3 — UI(frontend-design skill)

### Task 13: 设计系统与 App 骨架

**Files:**
- Create: `src/styles/`(design tokens + 全局样式)、`src/components/`(通用组件)
- Modify: `src/App.tsx`, `index.html`

- [ ] **Step 1: 调用 frontend-design skill**,为"个人单词记忆 PWA"确立视觉方向:移动端优先(375px 起)、支持深浅色、有辨识度不模板化;确定字体(需良好显示 IPA 音标 + 中文)、色板、间距、卡片/按钮体系。产出 `src/styles/` 设计系统。
- [ ] **Step 2: App.tsx 骨架**:HashRouter;路由 `/login /(today) /review /quiz /library /word/:id /add /settings`;底部 Tab 导航(今日/词库/测试/设置,移动端固定底部,桌面端可侧边);未登录(store.phase === 'login')一律重定向 `/login`。
- [ ] **Step 3: 验证**:`npm run dev` 手机宽度查看导航与空页面路由切换正常。
- [ ] **Step 4: Commit** `git add -A && git commit -m "feat: 设计系统与应用骨架"`

### Task 14: 全局状态与同步引擎 store.tsx

**Files:**
- Create: `src/state/store.tsx`
- Test: 逻辑已在 lib 层覆盖;store 只做编排,不写组件测试

- [ ] **Step 1: 实现 AppProvider + useApp()**,完整接口:

```tsx
interface AppState {
  phase: 'boot' | 'login' | 'ready'
  owner: string | null
  words: Word[]
  progress: Progress
  syncStatus: 'synced' | 'pending' | 'offline' | 'error'
  loginError: string | null
}

interface AppActions {
  login(token: string): Promise<void>
  logout(): void
  grade(wordId: string, g: Grade): void
  recordQuiz(correct: number, total: number, wrongIds: string[]): void
  saveWord(word: Word): Promise<void>       // 新增或编辑词条
  updateSettings(s: Progress['settings']): void
  syncNow(): Promise<void>
  exportAll(): string                        // 导出 {words, progress} JSON 字符串
}
```

实现要点(编排规则,全部复用已测试的 lib 函数):

1. **boot**:storage 有 token+owner → 用缓存 words/progress 立即进 `ready`,后台拉远端(`getFile` 两文件,words 直接覆盖本地缓存;progress 用 `mergeProgress(本地, 远端)` 合并后若本地有 dirty 标记则推送);无 token → `login`。
2. **login(token)**:`GitHubClient.whoAmI` → `validate()` → 拉 `words.json`(必须存在,否则报错提示先初始化数据仓库)与 `progress.json`(404 则用 `emptyProgress()` 创建并推送)→ 存 storage → `ready`。错误信息写入 `loginError`。
3. **grade**:`gradeWord` 更新词条;dailyStats 当日 `reviewed+1`,若 prev 无记录(新词首次)`newLearned+1`,grade ≠ 'again' 时 `correct+1`;写 storage + 置 dirty + 防抖 30s 推送。
4. **recordQuiz**:当日 `quizTaken+1`;wrongIds 中已有进度的词 `due` 提前为今天(不改 ease/interval,`lastReviewedAt` 更新为现在);置 dirty 推送。
5. **推送**:`putFile('progress.json', json, 'sync progress', sha)`;返回 `'conflict'` → `getFile` → `mergeProgress(本地, 远端)` → 再 `putFile`(仅重试一次,再失败置 `syncStatus: 'error'`)。成功后更新 sha、清 dirty、`syncStatus: 'synced'`。
6. **saveWord**:更新 `words` 数组(按 id upsert)→ 立即 `putFile('words.json', ...)`(words 变更不防抖);conflict 处理同上但 words 以"重新拉取后重放本次 upsert"解决。
7. 监听 `online/offline` 事件与 `visibilitychange`(hidden 时若 dirty 立即推送);离线时 `syncStatus: 'offline'`,恢复后自动推送。

- [ ] **Step 2: 验证**:dev 模式下用真实 token 手动走通 login → 改一次进度 → 刷新页面进度还在 → GitHub 网页上能看到 `volcab-data` 的 commit。(此步依赖 Task 24 数据仓库已建;若先做本任务,用临时测试仓库。)
- [ ] **Step 3: Commit** `git add src/state/store.tsx && git commit -m "feat: 全局状态与同步引擎"`

### Task 15–21: 各页面(每页一个任务,均为:实现 → dev 手动验证 → commit)

每页行为契约如下;视觉实现遵循 Task 13 设计系统,由 frontend-design skill 指导。

- [ ] **Task 15 Login** (`src/pages/Login.tsx`):token 输入框(password 型)+ "登录"按钮 + 折叠的图文指引(生成 fine-grained PAT 的 6 步:github.com/settings/personal-access-tokens → Generate new token → 名称 volcab → 只勾选 volcab-data 仓库 → Permissions: Contents Read and write → 生成并复制)。提交时调 `login()`,显示 loading 与 `loginError`。成功跳转 `/`。
- [ ] **Task 16 Today** (`src/pages/Today.tsx`):用 `buildQueue` 显示今日到期数/新词数;streak(由 dailyStats 从今天往前数连续 reviewed>0 的天数,今天没复习不断签,从昨天起算);总进度(review 状态词数 / 总词数);主按钮"开始复习"(due+fresh 为空时显示"今日完成 🎉")、副按钮"快速测试";syncStatus 角标(pending/offline/error 时可点击触发 `syncNow`)。
- [ ] **Task 17 Review** (`src/pages/Review.tsx`):会话队列 = `buildQueue().due` + `.fresh`(fresh 词首次展示带"新词"徽标并直接亮出释义面);卡片正面 headword + 发音按钮(`speak`);点击/空格翻面显示音标、全部 meanings、examples、synonyms/antonyms、collocations;四个打分按钮(重来/困难/良好/简单)调 `grade()`;打分后 learning 状态且 due 仍为今天的词插回队列尾部(实现 1min/10min 步长的会话内重现);顶部进度 x/y;队列清空显示完成页(今日 reviewed 数)+ 返回。
- [ ] **Task 18 Quiz** (`src/pages/Quiz.tsx`):`generateQuiz(words, progress, 10)`;选择题点选后即时判对错(正确绿/错误红并标出正确项),拼写题输入框 + 提交(不区分大小写,trim);下一题;结束页显示得分、错词列表(可点进详情),调 `recordQuiz`;词库不足 4 词时提示不可测。
- [ ] **Task 19 Library + WordDetail** (`src/pages/Library.tsx`, `src/pages/WordDetail.tsx`):搜索框(词头前缀/子串、en/zh 释义子串,大小写不敏感,即输即搜);筛选 chips(全部/未学/学习中/已掌握 + 按 sourceNote);列表行:headword、首义项 zh、状态点;点击进 `/word/:id`。详情页:完整词条 + 发音 + 学习状态(state/due/reps/lapses)+ "编辑"(表单改 meanings/examples/synonyms/antonyms/collocations,保存调 `saveWord`)。
- [ ] **Task 20 AddWord** (`src/pages/AddWord.tsx`):输入单词 → "查询"调 `https://api.dictionaryapi.dev/api/v2/entries/en/<word>`(取 phonetic 与前 3 个 meanings 的 partOfSpeech/definition 预填,zh 留空待填)→ 可编辑全部字段(zh 必填才能保存)→ `saveWord`(id 取小写,sourceNote: "manual",addedAt 今天;id 已存在则提示改为编辑)。API 404/失败 → 提示并进入全手动表单。
- [ ] **Task 21 Settings** (`src/pages/Settings.tsx`):每日新词数(数字输入,1–50,调 `updateSettings`);账号信息(owner + token 后 4 位)、"退出登录"(确认后 `logout`);"导出备份"(`exportAll` 下载 volcab-backup-YYYY-MM-DD.json);App 版本号。

### Task 22: PWA 收尾

**Files:**
- Create: `public/icon-192.png`, `public/icon-512.png`(frontend-design 风格的简单字母/卡片图标,可用 SVG 转 PNG)
- Modify: `src/main.tsx`(vite-plugin-pwa 的 `registerSW` 自动注入即可,确认 registerType: 'autoUpdate' 生效)

- [ ] **Step 1: 生成图标两枚**,`index.html` 补 `<meta name="theme-color">`、`apple-touch-icon`、`viewport-fit=cover`。
- [ ] **Step 2: 验证**:`npm run build && npm run preview` → Chrome DevTools Application 面板:Manifest 无错误、SW activated;断网刷新页面仍能打开并进入复习(用缓存数据)。
- [ ] **Step 3: Commit** `git add -A && git commit -m "feat: PWA 图标与离线支持"`

---

## Phase 4 — 部署与数据仓库

### Task 23: GitHub Pages 部署

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: 写 workflow**

```yaml
name: deploy
on:
  push:
    branches: [master]
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: 创建远端仓库并推送**

```bash
gh auth status               # 确认已登录;未登录先 gh auth login
gh repo create volcab-app --public --source . --push
```

- [ ] **Step 3: 启用 Pages(source = GitHub Actions)**

```bash
gh api repos/{owner}/volcab-app/pages -X POST -f build_type=workflow
```

(若返回已存在则忽略;也可网页 Settings → Pages → Source: GitHub Actions。)

- [ ] **Step 4: 验证**:`gh run watch` 等 workflow 绿;打开 `https://<owner>.github.io/volcab-app/` 看到登录页。

- [ ] **Step 5: Commit**(workflow 文件已随 push 提交)

### Task 24: 数据仓库 volcab-data

- [ ] **Step 1: 创建私有仓库并推入初始数据**

```bash
gh repo create volcab-data --private
cd $(mktemp -d)
git init && git checkout -b main
cp C:/Users/gaosi/repos/volcab/data/words.json .
echo '{"version":1,"settings":{"newPerDay":10},"words":{},"dailyStats":{}}' > progress.json
git add -A && git commit -m "init: 词库与空进度"
git remote add origin https://github.com/<owner>/volcab-data.git
git push -u origin main
```

- [ ] **Step 2: 用户操作(指引用户完成)**:按 Login 页指引生成 fine-grained PAT(仅 volcab-data,Contents Read/Write),保存好。

### Task 25: 端到端验收

- [ ] 桌面 Chrome:登录 → 今日页数字正确 → 复习 10 词(含新词学习步长重现)→ 快速测试一轮 → 搜索一个词 → 编辑一个词条 → 添加一个新词 → 设置改每日新词数 → 导出备份 → GitHub 上确认 progress.json/words.json 有对应 commit。
- [ ] 手机浏览器:打开 Pages 地址 → 登录 → 添加到主屏幕 → 从主屏幕全屏打开 → 复习数词 → 回桌面端刷新,确认进度已同步(含双端都复习过的冲突合并场景:手机复习 A 词、桌面复习 B 词,两端最终一致)。
- [ ] 离线:手机飞行模式打开 App → 能复习 → 恢复网络 → 自动推送,GitHub 出现 commit。
- [ ] 全部通过后:`git tag v1.0.0 && git push --tags`

---

## Self-Review 记录

- Spec 覆盖:§2 架构(T1/13/23)、§3 数据模型(T2/10/12)、§4 算法(T3/4)、§5 功能八页(T15–21)、§6 同步(T5/7/14)、§7 词库管线(T9–12)、§8 错误处理(T7/14/15/20)、§9 测试(各 TDD 任务+T25)、§10 部署(T23/24)。无缺口。
- 类型一致性:`gradeWord(prev, grade, now, rng)`、`buildQueue(words, progress, today)`、`mergeProgress(local, remote)`、`generateQuiz(words, progress, count, rng)`、`GitHubClient(token, owner, repo)` 在 store 编排(T14)中的引用与定义一致;`Progress.settings.newPerDay` 全文一致。
- 占位符:UI 任务(T13–21)以行为契约代替逐行 JSX 属计划有意决定(视觉由 frontend-design skill 生成);其余任务均含完整代码。



