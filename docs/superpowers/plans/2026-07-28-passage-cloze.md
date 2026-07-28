# 短文选词填空 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `/quiz` 加第五个模式「短文」——一篇 80~120 词的短文挖 3~7 个空,下方给候选词,填完整篇再交卷,交卷后逐句中英对照。

**Architecture:** 全部出题逻辑落在纯函数 `src/lib/passage.ts`(解析标记 → 选空 → 配候选词 → 选篇打分),渲染层 `src/pages/QuizPassage.tsx` 只负责把算好的结果画出来。语料 `src/data/passages.json` 随 App 发布,用 `import()` 拆成独立 chunk。判分复用现有 `recordQuiz(score, total, wrongIds)`,`store.tsx` 与 `srs.ts` 一行不改。

**Tech Stack:** React 19 + TypeScript + Vite + vitest(happy-dom)。无新依赖。

**设计文档:** `docs/superpowers/specs/2026-07-28-passage-cloze-design.md`

---

## File Structure

| 文件 | 职责 |
|---|---|
| `src/lib/passage.ts`(新) | 标记解析、选空、候选词、选篇打分。**全部纯函数**,不碰 DOM 不碰 localStorage |
| `src/lib/passage.test.ts`(新) | 上面的测试 |
| `src/lib/headword.ts`(改) | 新增 `isInflectionOf` —— 严格词尾判定,给校验脚本用 |
| `src/lib/headword.test.ts`(改) | `isInflectionOf` 的测试 |
| `src/data/passages.json`(新) | 语料。随 App 发布的只读内容 |
| `src/lib/storage.ts`(改) | 加 `recentPassages` 键 |
| `src/pages/QuizPassage.tsx`(新) | 短文模式的整个会话:做题态 + 交卷态 |
| `src/pages/Quiz.tsx`(改) | `MODES` 加一项,分支到 `PassageSession` |
| `src/pages/Quiz.css`(改) | `.quiz-passage-*` 样式 |
| `scripts/validate-passages.ts`(新) | 写入端闸门 |
| `package.json`(改) | 加 `validate-passages` 脚本 |

**为什么不复用 `QuizQuestionView`:** 短文是交卷制(可改答案、一次判全篇),与现有「点了就锁死、一题一判」是两套交互。`QuizSprint.tsx` 因为同样的理由也没复用它——那个先例就在旁边。

---

## Task 1: 标记解析

**Files:**
- Create: `src/lib/passage.ts`
- Create: `src/lib/passage.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/passage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parsePassage, parseSentence } from './passage'
import type { Passage } from './passage'

/**
 * 短文出题的纯逻辑。UI 不写组件测试(照仓库约定,见 store.test.tsx 顶部),
 * 所以值得测的分支必须全部落在这个文件里。
 */

const passage = (over: Partial<Passage> = {}): Passage => ({
  id: 'p1',
  title: '测试短文',
  en: ['The board was {{contentious}} about it.'],
  zh: ['董事会对此争议不小。'],
  ...over,
})

describe('parseSentence', () => {
  it('简写标记:词头即句中形式', () => {
    expect(parseSentence('a {{refute}} b')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'word', wordId: 'refute', surface: 'refute' },
      { kind: 'text', text: ' b' },
    ])
  })

  it('带竖线的标记:句中形式与词头不同', () => {
    expect(parseSentence('they {{refute|refuted}} it')).toEqual([
      { kind: 'text', text: 'they ' },
      { kind: 'word', wordId: 'refute', surface: 'refuted' },
      { kind: 'text', text: ' it' },
    ])
  })

  it('一句里多个标记', () => {
    const tokens = parseSentence('{{a}} and {{b|bs}}')
    expect(tokens?.filter(t => t.kind === 'word')).toHaveLength(2)
  })

  it('没有标记时整句一个 text 片段', () => {
    expect(parseSentence('plain text')).toEqual([{ kind: 'text', text: 'plain text' }])
  })

  it('畸形标记返回 null —— 宁可整篇跳过,不出一道挖错空的题', () => {
    expect(parseSentence('a {{b} c')).toBeNull()       // 括号没配对
    expect(parseSentence('a {{b|c|d}} e')).toBeNull()  // 两根竖线
    expect(parseSentence('a {{}} b')).toBeNull()       // 空 id
    expect(parseSentence('a {{b|}} c')).toBeNull()     // 空形式
  })
})

describe('parsePassage', () => {
  it('逐句解析,句数与 zh 一致时返回二维 token', () => {
    const r = parsePassage(passage({ en: ['{{a}} x.', 'y {{b}}.'], zh: ['甲', '乙'] }))
    expect(r).toHaveLength(2)
  })

  it('中译句数对不上返回 null —— 读取端对坏数据宽容,跳过这一篇', () => {
    expect(parsePassage(passage({ en: ['a', 'b'], zh: ['甲'] }))).toBeNull()
  })

  it('空短文返回 null', () => {
    expect(parsePassage(passage({ en: [], zh: [] }))).toBeNull()
  })

  it('任何一句畸形,整篇返回 null', () => {
    expect(parsePassage(passage({ en: ['ok {{a}}', 'bad {{b}'], zh: ['甲', '乙'] }))).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx vitest run src/lib/passage.test.ts
```

预期:FAIL,`Failed to resolve import "./passage"`。

- [ ] **Step 3: 写实现**

创建 `src/lib/passage.ts`:

```ts
/**
 * 短文选词填空的出题逻辑。全部纯函数 —— 渲染层只负责把这里算出来的结果画出来。
 *
 * 设计见 docs/superpowers/specs/2026-07-28-passage-cloze-design.md
 */

export interface Passage {
  id: string
  title: string
  /** 逐句英文。目标词用 {{wordId|句中形式}} 标记,形式与词头相同时简写 {{concoct}} */
  en: string[]
  /** 逐句中译,与 en 一一对应 */
  zh: string[]
}

export interface PassagesFile { version: 1; passages: Passage[] }

export type Token =
  | { kind: 'text'; text: string }
  | { kind: 'word'; wordId: string; surface: string }

/**
 * `{{wordId}}` 或 `{{wordId|句中形式}}`。
 *
 * id 与形式都不允许含 `{}|`,所以 `{{a|b|c}}` 这种写坏的标记**匹配不上**,
 * 会原样留在文本片段里 —— 下面那条残留花括号检查再把整句判死。
 */
const MARKER = /\{\{([^{}|]+)(?:\|([^{}|]+))?\}\}/g

/**
 * 解析一句。畸形标记返回 null。
 *
 * **宁可整篇跳过也不将就**:标记写坏的后果不是少一个空,是挖错空或者把
 * `{{refute` 这种半截字符串印在题面上。与 words.json 那条「写入端严格、
 * 读取端宽容」是同一条规矩 —— 校验脚本是闸门,这里是不白屏的兜底。
 */
export function parseSentence(s: string): Token[] | null {
  const out: Token[] = []
  let last = 0
  for (const m of s.matchAll(MARKER)) {
    const wordId = m[1].trim()
    const surface = (m[2] ?? m[1]).trim()
    if (wordId === '' || surface === '') return null
    if (m.index > last) out.push({ kind: 'text', text: s.slice(last, m.index) })
    out.push({ kind: 'word', wordId, surface })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ kind: 'text', text: s.slice(last) })
  if (out.some(t => t.kind === 'text' && /[{}]/.test(t.text))) return null
  return out
}

/** 逐句解析整篇。任何一句畸形、或中英句数对不上,整篇返回 null。 */
export function parsePassage(p: Passage): Token[][] | null {
  if (p.en.length === 0 || p.en.length !== p.zh.length) return null
  const out: Token[][] = []
  for (const s of p.en) {
    const tokens = parseSentence(s)
    if (tokens === null) return null
    out.push(tokens)
  }
  return out
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run src/lib/passage.test.ts
```

预期:PASS,9 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add src/lib/passage.ts src/lib/passage.test.ts
git commit -m "feat(passage): 短文标记解析"
```

---

## Task 2: `isInflectionOf` —— 给校验脚本的严格词形判定

**Files:**
- Modify: `src/lib/headword.ts`
- Modify: `src/lib/headword.test.ts`

- [ ] **Step 1: 写失败的测试**

在 `src/lib/headword.test.ts` 末尾追加:

```ts
describe('isInflectionOf', () => {
  it('原形本身算', () => {
    expect(isInflectionOf('refute', 'refute')).toBe(true)
  })

  it('常见屈折变形算', () => {
    expect(isInflectionOf('refuted', 'refute')).toBe(true)
    expect(isInflectionOf('ratified', 'ratify')).toBe(true)
    expect(isInflectionOf('inundated', 'inundate')).toBe(true)
    expect(isInflectionOf('thwarting', 'thwart')).toBe(true)
  })

  it('大小写不敏感', () => {
    expect(isInflectionOf('Refuted', 'refute')).toBe(true)
  })

  /**
   * 这条是这个函数存在的全部理由。headwordPattern 在原形缺席时会退回
   * 松散词干 `stem + [a-z]*`,拿它做校验会把 reference 判成 refute 的变形 ——
   * 定位一整句话时那条松散规则是必要的退路,校验单个词时它是漏洞。
   */
  it('形近但无关的词不算', () => {
    expect(isInflectionOf('reference', 'refute')).toBe(false)
    expect(isInflectionOf('mirth', 'mire')).toBe(false)
    expect(isInflectionOf('officials', 'officiate')).toBe(false)
  })

  it('多余的前后缀不算', () => {
    expect(isInflectionOf('unrefuted', 'refute')).toBe(false)
    expect(isInflectionOf('refutation', 'refute')).toBe(false)
  })

  it('空串不算', () => {
    expect(isInflectionOf('', 'refute')).toBe(false)
    expect(isInflectionOf('refute', '')).toBe(false)
  })
})
```

同时把文件顶部的 import 改成包含 `isInflectionOf`:

```ts
import { escapeRe, headwordPattern, isInflectionOf, splitByHeadword } from './headword'
```

（若原 import 行的成员不同,只需在其中加入 `isInflectionOf`,不要删掉已有成员。）

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx vitest run src/lib/headword.test.ts
```

预期:FAIL,`isInflectionOf is not a function`。

- [ ] **Step 3: 写实现**

在 `src/lib/headword.ts` 里,把 `tightPattern` 上方的 `SUFFIX` 常量保持原样,并在 `headwordPattern` 之后追加:

```ts
/**
 * `surface` 是不是 `headword` 的一个屈折变形。
 *
 * **只用紧规则,不走 headwordPattern 的松散退路。** 那条退路(`stem + [a-z]*`)
 * 是为了在一整句话里定位得到词头而存在的,校验单个词时它会把 `reference` 判成
 * `refute` 的变形、把 `mirth` 判成 `mire` 的变形。校验时候选只有一个词,没有
 * 「定位不到就漏题」的压力,该用严格的词尾枚举。
 *
 * 只给写入端的校验脚本用(scripts/validate-passages.ts)。
 */
export function isInflectionOf(surface: string, headword: string): boolean {
  const s = surface.trim().toLowerCase()
  const h = headword.trim().toLowerCase()
  if (s === '' || h === '') return false
  if (s === h) return true
  const base = /[ey]$/.test(h) ? h.slice(0, -1) : h
  return new RegExp(`^${escapeRe(base)}${SUFFIX}$`, 'i').test(s)
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run src/lib/headword.test.ts
```

预期:PASS,新增 6 个用例全绿,原有用例不受影响。

- [ ] **Step 5: 提交**

```bash
git add src/lib/headword.ts src/lib/headword.test.ts
git commit -m "feat(headword): 加 isInflectionOf,校验短文标记的句中形式"
```

---

## Task 3: 选空

**Files:**
- Modify: `src/lib/passage.ts`
- Modify: `src/lib/passage.test.ts`

- [ ] **Step 1: 写失败的测试**

在 `src/lib/passage.test.ts` 里,先在顶部 import 补上新符号,并加一组测试替身:

```ts
import { MAX_BLANKS, parsePassage, parseSentence, selectBlanks } from './passage'
import { emptyProgress } from '../types'
import type { Progress, Word } from '../types'
```

在 `const passage = ...` 之后追加:

```ts
/** 造一个够用的词条。测试只关心 id / headword / meanings[0].pos。 */
const word = (id: string, pos = 'v.'): Word => ({
  id, headword: id, phonetic: '', 
  meanings: [{ pos, en: '', zh: id }],
  examples: [], synonyms: [], antonyms: [], collocations: [], relatedForms: [],
  sourceNote: 'test', addedAt: '2026-01-01',
})

/** state=review、到期日可控的进度。ids 里的词算学过。 */
const progressWith = (entries: Record<string, string>): Progress => {
  const p = emptyProgress()
  for (const [id, due] of Object.entries(entries)) {
    p.words[id] = {
      state: 'review', ease: 2.5, intervalDays: 5, due,
      stepIndex: 0, reps: 3, lapses: 0, lastReviewedAt: '2026-01-01T00:00:00.000Z',
    }
  }
  return p
}

const byId = (ws: Word[]) => new Map(ws.map(w => [w.id, w]))

const TODAY = '2026-07-28'
```

再追加测试:

```ts
describe('selectBlanks', () => {
  it('只挖学过的词,没学过的原样留在正文里当阅读材料', () => {
    const sentences = parsePassage(passage({
      en: ['{{a}} {{b}} {{c}}'], zh: ['甲'],
    }))!
    const words = [word('a'), word('b'), word('c')]
    const progress = progressWith({ a: TODAY, b: TODAY })  // c 没学过
    const blanks = selectBlanks(sentences, byId(words), progress, TODAY)
    expect(blanks.map(b => b.wordId)).toEqual(['a', 'b'])
  })

  it('词库里查不到的词不挖 —— 仓库副本与线上词库会分叉', () => {
    const sentences = parsePassage(passage({ en: ['{{a}} {{ghost}}'], zh: ['甲'] }))!
    const progress = progressWith({ a: TODAY, ghost: TODAY })
    const blanks = selectBlanks(sentences, byId([word('a')]), progress, TODAY)
    expect(blanks.map(b => b.wordId)).toEqual(['a'])
  })

  it('同一个词一篇里最多一个空,否则候选词区会出现两个一模一样的词', () => {
    const sentences = parsePassage(passage({ en: ['{{a}} then {{a|as}}'], zh: ['甲'] }))!
    const blanks = selectBlanks(sentences, byId([word('a')]), progressWith({ a: TODAY }), TODAY)
    expect(blanks).toHaveLength(1)
    expect(blanks[0].surface).toBe('a')
  })

  it('带上句中形式与位置', () => {
    const sentences = parsePassage(passage({
      en: ['x {{refute|refuted}} y', 'z {{a}}'], zh: ['甲', '乙'],
    }))!
    const words = [word('refute'), word('a')]
    const blanks = selectBlanks(sentences, byId(words), progressWith({ refute: TODAY, a: TODAY }), TODAY)
    expect(blanks[0]).toMatchObject({ si: 0, ti: 1, wordId: 'refute', surface: 'refuted' })
    expect(blanks[1]).toMatchObject({ si: 1, wordId: 'a' })
  })

  it('超过上限时到期的优先,但仍按正文顺序返回', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    const sentences = parsePassage(passage({
      en: [ids.map(i => `{{${i}}}`).join(' ')], zh: ['甲'],
    }))!
    const words = ids.map(i => word(i))
    // 前两个未到期,其余到期 —— 9 个候选砍到 7 个,应该砍掉前两个
    const progress = progressWith(Object.fromEntries(
      ids.map((i, n) => [i, n < 2 ? '2099-01-01' : TODAY]),
    ))
    const blanks = selectBlanks(sentences, byId(words), progress, TODAY)
    expect(blanks).toHaveLength(MAX_BLANKS)
    expect(blanks.map(b => b.wordId)).toEqual(['c', 'd', 'e', 'f', 'g', 'h', 'i'])
  })
})
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx vitest run src/lib/passage.test.ts
```

预期:FAIL,`selectBlanks is not exported`。

- [ ] **Step 3: 写实现**

在 `src/lib/passage.ts` 末尾追加(并在文件顶部加 import):

```ts
import type { Progress, Word } from '../types'
```

```ts
/** 一篇里至少要凑够 3 个空。两个空互为线索的推理不成立,退化成两道单句挖空。 */
export const MIN_BLANKS = 3
/** 一屏最多 7 个空,再多就做不完。 */
export const MAX_BLANKS = 7

export interface Blank {
  /** 第几句 */
  si: number
  /** 该句里第几个 token */
  ti: number
  wordId: string
  /** 句中形式,判对后填进去的就是它 */
  surface: string
}

/**
 * 选出要挖的空。
 *
 * **只挖学过的词**(`state !== 'new'`),没学过的、以及在词库里查不到的原样印出来。
 * 这条沿用辨析模式那条教训(见 quiz.ts 的 generateContrastQuiz):不拿没见过的词
 * 考你。但与辨析不同的是,没见过的词可以留在上下文里 —— 它不是题,是读物。
 */
export function selectBlanks(
  sentences: Token[][],
  words: Map<string, Word>,
  progress: Progress,
  today: string,
): Blank[] {
  const seen = new Set<string>()
  const eligible: Blank[] = []

  sentences.forEach((tokens, si) => {
    tokens.forEach((t, ti) => {
      if (t.kind !== 'word') return
      // 同一个词一篇里最多一个空 —— 否则候选词区会出现两个一模一样的词,
      // 而「用掉就划掉」的规则立刻自相矛盾。
      if (seen.has(t.wordId)) return
      if (!words.has(t.wordId)) return
      const e = progress.words[t.wordId]
      if (e === undefined || e.state === 'new') return
      seen.add(t.wordId)
      eligible.push({ si, ti, wordId: t.wordId, surface: t.surface })
    })
  })

  if (eligible.length <= MAX_BLANKS) return eligible

  // 到期的先占坑,再按正文顺序还原 —— 渲染必须按出现顺序,砍的是「挖谁」不是「怎么排」
  const isDue = (b: Blank) => progress.words[b.wordId].due <= today
  const picked = new Set([...eligible.filter(isDue), ...eligible.filter(b => !isDue(b))].slice(0, MAX_BLANKS))
  return eligible.filter(b => picked.has(b))
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run src/lib/passage.test.ts
```

预期:PASS,共 14 个用例。

- [ ] **Step 5: 提交**

```bash
git add src/lib/passage.ts src/lib/passage.test.ts
git commit -m "feat(passage): 选空 —— 只挖学过的词,到期优先"
```

---

## Task 4: 候选词

**Files:**
- Modify: `src/lib/passage.ts`
- Modify: `src/lib/passage.test.ts`

- [ ] **Step 1: 写失败的测试**

顶部 import 补上 `pickDistractors`,并加:

```ts
import { buildContrastPairs } from './contrast'
```

追加测试:

```ts
describe('pickDistractors', () => {
  const rng = () => 0.5

  it('优先取与某个答案易混的已学词', () => {
    const answer = { ...word('alpha'), synonyms: ['shared'] }
    const confusable = { ...word('bravo'), synonyms: ['shared'] }
    const unrelated = word('charlie')
    const words = [answer, confusable, unrelated]
    const progress = progressWith({ alpha: TODAY, bravo: TODAY, charlie: TODAY })
    const out = pickDistractors(
      new Set(['alpha']), words, progress, buildContrastPairs(words), 1, rng,
    )
    expect(out.map(w => w.id)).toEqual(['bravo'])
  })

  it('易混词不够时退回词性相同的已学词', () => {
    const words = [word('alpha', 'adj.'), word('bravo', 'adj.'), word('charlie', 'n.')]
    const progress = progressWith({ alpha: TODAY, bravo: TODAY, charlie: TODAY })
    const out = pickDistractors(new Set(['alpha']), words, progress, [], 1, rng)
    expect(out.map(w => w.id)).toEqual(['bravo'])
  })

  it('绝不选中答案自己', () => {
    const words = [word('alpha'), word('bravo')]
    const progress = progressWith({ alpha: TODAY, bravo: TODAY })
    const out = pickDistractors(new Set(['alpha', 'bravo']), words, progress, [], 2, rng)
    expect(out).toHaveLength(0)
  })

  it('没学过的词不当干扰项', () => {
    const words = [word('alpha'), word('bravo')]
    const out = pickDistractors(new Set(['alpha']), words, progressWith({ alpha: TODAY }), [], 2, rng)
    expect(out).toHaveLength(0)
  })

  it('凑不满就少给 —— 少一个干扰词只是简单些,重复选项是缺陷', () => {
    const words = [word('alpha'), word('bravo')]
    const progress = progressWith({ alpha: TODAY, bravo: TODAY })
    const out = pickDistractors(new Set(['alpha']), words, progress, [], 5, rng)
    expect(out.map(w => w.id)).toEqual(['bravo'])
  })
})
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx vitest run src/lib/passage.test.ts -t pickDistractors
```

预期:FAIL,`pickDistractors is not exported`。

- [ ] **Step 3: 写实现**

顶部 import 补上(**只导入这里真正用到的** —— `noUnusedLocals` 是开着的,多导一个 `buildContrastPairs` 会直接编译失败,它到 Task 6 才用得上):

```ts
import type { ContrastPair } from './contrast'
import { shuffle } from './quiz'
```

末尾追加:

```ts
/** 候选词比空多几个。真题的选词填空一律给多,逼你排除。 */
export const DISTRACTOR_COUNT = 2

/**
 * 挑干扰词。三级降级,凑不满就少给 —— 少一个干扰词只是这篇稍微简单些,
 * 而拿一个与答案重复的选项出来是缺陷(与 quiz.ts 里 sharedSynonyms 要防的
 * 是同一类问题)。
 *
 * 1. `buildContrastPairs` 里与某个答案易混的已学词 —— 现成的易混词图
 * 2. 与某个答案主义项词性相同的已学词(词性不同的词在句子里根本不会打架)
 * 3. 任意已学词
 */
export function pickDistractors(
  answerIds: Set<string>,
  words: Word[],
  progress: Progress,
  pairs: ContrastPair[],
  count: number,
  rng: () => number,
): Word[] {
  const byId = new Map(words.map(w => [w.id, w]))
  const learned = (id: string): boolean => {
    const e = progress.words[id]
    return e !== undefined && e.state !== 'new'
  }

  const out: Word[] = []
  const taken = new Set(answerIds)

  const add = (id: string) => {
    if (out.length >= count || taken.has(id) || !learned(id)) return
    const w = byId.get(id)
    if (w === undefined) return
    taken.add(id)
    out.push(w)
  }

  for (const p of shuffle(pairs, rng)) {
    if (out.length >= count) break
    if (answerIds.has(p.a)) add(p.b)
    else if (answerIds.has(p.b)) add(p.a)
  }

  const poses = new Set<string>()
  for (const id of answerIds) {
    const pos = byId.get(id)?.meanings[0]?.pos
    if (pos !== undefined) poses.add(pos)
  }
  for (const w of shuffle(words, rng)) {
    if (out.length >= count) break
    if (poses.has(w.meanings[0]?.pos)) add(w.id)
  }

  for (const w of shuffle(words, rng)) {
    if (out.length >= count) break
    add(w.id)
  }

  return out
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run src/lib/passage.test.ts
```

预期:PASS,共 19 个用例。

- [ ] **Step 5: 提交**

```bash
git add src/lib/passage.ts src/lib/passage.test.ts
git commit -m "feat(passage): 候选词 —— 易混词优先,三级降级"
```

---

## Task 5: 组装一道短文题

**Files:**
- Modify: `src/lib/passage.ts`
- Modify: `src/lib/passage.test.ts`

- [ ] **Step 1: 写失败的测试**

顶部 import 补上 `buildPassageQuestion`,追加:

```ts
describe('buildPassageQuestion', () => {
  const rng = () => 0.5
  const ids = ['a', 'b', 'c', 'd', 'e']
  const words = ids.map(i => word(i))
  const allLearned = progressWith(Object.fromEntries(ids.map(i => [i, TODAY])))
  const threeBlank = passage({ en: ['{{a}} {{b}} {{c}}'], zh: ['甲'] })

  it('候选词 = 全部答案 + 干扰词', () => {
    const q = buildPassageQuestion(threeBlank, words, allLearned, TODAY, [], rng)!
    expect(q.blanks).toHaveLength(3)
    expect(q.choices).toHaveLength(3 + 2)
    expect(new Set(q.choices.map(c => c.wordId)).size).toBe(5)  // 无重复
    for (const b of q.blanks) {
      expect(q.choices.some(c => c.wordId === b.wordId)).toBe(true)
    }
  })

  it('候选词带词头原形,给界面显示用', () => {
    const q = buildPassageQuestion(threeBlank, words, allLearned, TODAY, [], rng)!
    expect(q.choices.every(c => c.headword !== '')).toBe(true)
  })

  it('可挖空不足 3 个返回 null', () => {
    const p = passage({ en: ['{{a}} {{b}}'], zh: ['甲'] })
    expect(buildPassageQuestion(p, words, allLearned, TODAY, [], rng)).toBeNull()
  })

  it('解析失败返回 null,不抛错', () => {
    const p = passage({ en: ['{{a}} {{b} {{c}}'], zh: ['甲'] })
    expect(buildPassageQuestion(p, words, allLearned, TODAY, [], rng)).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx vitest run src/lib/passage.test.ts -t buildPassageQuestion
```

预期:FAIL,`buildPassageQuestion is not exported`。

- [ ] **Step 3: 写实现**

末尾追加:

```ts
/** 候选词。`wordId` 用来判分,`headword` 用来显示 —— 两者不一定相同。 */
export interface Choice { wordId: string; headword: string }

export interface PassageQuestion {
  passage: Passage
  sentences: Token[][]
  /** 按正文出现顺序 */
  blanks: Blank[]
  /** 已打乱 */
  choices: Choice[]
}

/**
 * 把一篇短文组装成一道题。出不来(解析失败 / 可挖空不足)返回 null,
 * 由调用方换下一篇。
 */
export function buildPassageQuestion(
  passage: Passage,
  words: Word[],
  progress: Progress,
  today: string,
  pairs: ContrastPair[],
  rng: () => number,
): PassageQuestion | null {
  const sentences = parsePassage(passage)
  if (sentences === null) return null

  const byId = new Map(words.map(w => [w.id, w]))
  const blanks = selectBlanks(sentences, byId, progress, today)
  if (blanks.length < MIN_BLANKS) return null

  const answerIds = new Set(blanks.map(b => b.wordId))
  const distractors = pickDistractors(answerIds, words, progress, pairs, DISTRACTOR_COUNT, rng)

  const choices = shuffle<Choice>(
    [
      ...blanks.map(b => ({ wordId: b.wordId, headword: byId.get(b.wordId)!.headword })),
      ...distractors.map(w => ({ wordId: w.id, headword: w.headword })),
    ],
    rng,
  )

  return { passage, sentences, blanks, choices }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run src/lib/passage.test.ts
```

预期:PASS,共 23 个用例。

- [ ] **Step 5: 提交**

```bash
git add src/lib/passage.ts src/lib/passage.test.ts
git commit -m "feat(passage): 组装短文题"
```

---

## Task 6: 选篇打分

**Files:**
- Modify: `src/lib/passage.ts`
- Modify: `src/lib/passage.test.ts`

- [ ] **Step 1: 写失败的测试**

顶部 import 补上 `pickPassage, pushRecent, RECENT_LIMIT`,追加:

```ts
describe('pickPassage', () => {
  const rng = () => 0.5
  const ids = ['a', 'b', 'c', 'd', 'e', 'f']
  const words = ids.map(i => word(i))

  const p1 = passage({ id: 'p1', en: ['{{a}} {{b}} {{c}}'], zh: ['甲'] })
  const p2 = passage({ id: 'p2', en: ['{{d}} {{e}} {{f}}'], zh: ['乙'] })

  it('挑今天到期词最多的那篇', () => {
    const progress = progressWith({
      a: TODAY, b: TODAY, c: TODAY,        // p1:三个都到期
      d: TODAY, e: '2099-01-01', f: '2099-01-01',  // p2:只有一个到期
    })
    expect(pickPassage([p1, p2], words, progress, TODAY, [], rng)?.passage.id).toBe('p1')
  })

  it('最近做过的要让位 —— 第二次做记住的是上次的答案,不是词', () => {
    const progress = progressWith({
      a: TODAY, b: TODAY, c: TODAY,
      d: TODAY, e: TODAY, f: '2099-01-01',  // p2 分数本来比 p1 低
    })
    expect(pickPassage([p1, p2], words, progress, TODAY, ['p1'], rng)?.passage.id).toBe('p2')
  })

  it('一篇都出不来时返回 null', () => {
    const progress = progressWith({ a: TODAY })  // 每篇最多一个空
    expect(pickPassage([p1, p2], words, progress, TODAY, [], rng)).toBeNull()
  })

  it('坏数据的那篇被跳过,不影响别的篇', () => {
    const broken = passage({ id: 'bad', en: ['{{a} {{b}} {{c}}'], zh: ['甲'] })
    const progress = progressWith({ a: TODAY, b: TODAY, c: TODAY })
    expect(pickPassage([broken, p1], words, progress, TODAY, [], rng)?.passage.id).toBe('p1')
  })
})

describe('pushRecent', () => {
  it('新的排在最前', () => {
    expect(pushRecent(['b', 'c'], 'a')).toEqual(['a', 'b', 'c'])
  })

  it('已在列表里的挪到最前而不是留两份', () => {
    expect(pushRecent(['b', 'a', 'c'], 'a')).toEqual(['a', 'b', 'c'])
  })

  it('超过上限时砍掉最旧的', () => {
    const long = Array.from({ length: RECENT_LIMIT }, (_, i) => `p${i}`)
    const out = pushRecent(long, 'new')
    expect(out).toHaveLength(RECENT_LIMIT)
    expect(out[0]).toBe('new')
    expect(out).not.toContain(`p${RECENT_LIMIT - 1}`)
  })
})
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx vitest run src/lib/passage.test.ts -t pickPassage
```

预期:FAIL,`pickPassage is not exported`。

- [ ] **Step 3: 写实现**

顶部 import 补上 `buildContrastPairs`(与已有的 `import type { ContrastPair } from './contrast'` 并列):

```ts
import { buildContrastPairs } from './contrast'
```

末尾追加:

```ts
/** 到期词的权重高于已学未到期 —— 这题首先是复习工具,其次才是阅读。 */
export const DUE_WEIGHT = 3
export const LEARNED_WEIGHT = 1
/**
 * 最近做过的惩罚。**刻意压过「多一个到期词」(+3)**:宁可换一篇覆盖略差的新
 * 短文,也别连着做同一篇 —— 第二次做时你记住的是上次的答案,不是词。
 */
export const RECENT_PENALTY = 5
/** 「最近做过」记多少篇。存 localStorage,不进 progress.json。 */
export const RECENT_LIMIT = 10

export function scoreQuestion(
  q: PassageQuestion,
  progress: Progress,
  today: string,
  recentIds: string[],
): number {
  let s = 0
  for (const b of q.blanks) {
    s += progress.words[b.wordId].due <= today ? DUE_WEIGHT : LEARNED_WEIGHT
  }
  return recentIds.includes(q.passage.id) ? s - RECENT_PENALTY : s
}

/**
 * 挑一篇今天最该做的短文。一篇都出不来返回 null(由调用方给空状态文案)。
 *
 * `buildContrastPairs` 对全词库只算一次 —— 放进循环就是每篇重算一遍倒排索引。
 */
export function pickPassage(
  passages: Passage[],
  words: Word[],
  progress: Progress,
  today: string,
  recentIds: string[],
  rng: () => number = Math.random,
): PassageQuestion | null {
  const pairs = buildContrastPairs(words)
  let best: PassageQuestion | null = null
  let bestScore = -Infinity
  // 先打乱:同分时取先遇到的那篇,不打乱就永远是数组里靠前的那几篇
  for (const p of shuffle(passages, rng)) {
    const q = buildPassageQuestion(p, words, progress, today, pairs, rng)
    if (q === null) continue
    const s = scoreQuestion(q, progress, today, recentIds)
    if (s > bestScore) {
      bestScore = s
      best = q
    }
  }
  return best
}

/** 把 id 推到「最近做过」的最前面,超过上限砍掉最旧的。 */
export function pushRecent(recent: string[], id: string, limit = RECENT_LIMIT): string[] {
  return [id, ...recent.filter(x => x !== id)].slice(0, limit)
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run src/lib/passage.test.ts
```

预期:PASS,共 30 个用例。

- [ ] **Step 5: 提交**

```bash
git add src/lib/passage.ts src/lib/passage.test.ts
git commit -m "feat(passage): 选篇打分与最近做过"
```

---

## Task 7: 种子语料

**Files:**
- Create: `src/data/passages.json`

- [ ] **Step 1: 写语料**

创建 `src/data/passages.json`。两篇都只用 `usageScore >= 7` 的词(这批词最可能已经学过):

```json
{
  "version": 1,
  "passages": [
    {
      "id": "committee-report",
      "title": "一票通过的那份报告",
      "en": [
        "The committee's report was {{contentious}} before anyone had finished reading it.",
        "Its central claim rested on a single lab result that no independent team could {{corroborate}}, and the paragraph blaming a decade-old {{oversight}} at the treatment plant used figures the plant's engineers had already {{refute|refuted}} in writing.",
        "Two members called the methodology {{dubious}} and threatened to {{thwart}} the vote entirely.",
        "The chair spent an hour trying to talk them down, but the {{animosity}} in the room had been building for months.",
        "In the end the board {{ratify|ratified}} the report by a single vote, and nobody looked pleased about it."
      ],
      "zh": [
        "还没等人读完,委员会那份报告就已经争议缠身。",
        "它的核心论点建立在一个没有任何独立团队能证实的化验结果上,而指责水处理厂十年前那次失察的那一段,用的数字早被厂里的工程师书面驳斥过。",
        "两名成员称这套方法靠不住,扬言要直接把表决搅黄。",
        "主席花了一小时劝他们,但会议室里的敌意已经积攒了好几个月。",
        "最后董事会以一票之差批准了这份报告,没有一个人看上去高兴。"
      ]
    },
    {
      "id": "sweltering-commute",
      "title": "第九天的热浪",
      "en": [
        "The heat wave was in its ninth day, and the {{sweltering}} platform at Union Station smelled like hot rubber.",
        "By noon the transit authority's inbox was {{inundate|inundated}} with complaints, most of them about a cooling system that an {{ominous}} internal memo had flagged as a {{precursor}} to total failure back in March.",
        "Management had given the maintenance team almost no {{leeway}} on the repair budget, and the {{grandiose}} plan to replace the entire line by 2029 did nothing for anyone standing on that platform.",
        "The delays only {{exacerbate|exacerbated}} the crowding, and the heat refused to {{abate}} until well after dark."
      ],
      "zh": [
        "热浪进入第九天,联合车站那个酷热难耐的站台闻起来像烧热的橡胶。",
        "到中午,交通局的邮箱已经被投诉淹没,大多冲着那套冷却系统——三月一份不祥的内部备忘录早就把它标为整体瘫痪的先兆。",
        "管理层在维修预算上几乎没给检修组任何回旋余地,而那个要在 2029 年前把整条线换掉的浮夸计划,对当天站在站台上的任何人都毫无用处。",
        "延误只是让拥挤更加恶化,而暑气直到天黑很久之后才开始减弱。"
      ]
    }
  ]
}
```

- [ ] **Step 2: 确认引用的词都在词库里**

```bash
node -e "const d=require('./data/words.json');const p=require('./src/data/passages.json');const ids=new Set(d.words.map(w=>w.id));const used=[...JSON.stringify(p).matchAll(/\{\{([^{}|]+)/g)].map(m=>m[1]);const bad=used.filter(i=>!ids.has(i));console.log('引用',used.length,'个标记, 词库缺失:',bad)"
```

预期:`引用 16 个标记, 词库缺失: []`

- [ ] **Step 3: 提交**

```bash
git add src/data/passages.json
git commit -m "data: 短文选词填空的两篇种子语料"
```

---

## Task 8: 校验脚本

**Files:**
- Create: `scripts/validate-passages.ts`
- Modify: `package.json`

- [ ] **Step 1: 写脚本**

创建 `scripts/validate-passages.ts`:

```ts
/**
 * 短文语料的写入端闸门。校验不过不进仓库。
 *
 * 运行:npm run validate-passages
 *
 * 读取端(lib/passage.ts)对坏数据是宽容的 —— 跳过那一篇,不抛错不白屏。
 * 那是不白屏的兜底,不是质量保证;质量保证在这里。
 */
import { readFileSync } from 'node:fs'
import { isInflectionOf } from '../src/lib/headword.ts'

/** 每篇至少标记多少个词。挖空只挖学过的,标记少了早期一篇也凑不出 3 个空。 */
const MIN_MARKS = 6

const MARKER = /\{\{([^{}|]+)(?:\|([^{}|]+))?\}\}/g

// 与 validate-words.ts 一致:脚本里不套类型,校验的对象本来就可能不合形状
const words = JSON.parse(readFileSync('data/words.json', 'utf8'))
const file = JSON.parse(readFileSync('src/data/passages.json', 'utf8'))

if (file.version !== 1) { console.error('version 必须为 1'); process.exit(1) }
if (!Array.isArray(file.passages)) { console.error('passages 必须是数组'); process.exit(1) }

const byId = new Map<string, { headword: string }>(
  words.words.map((w: { id: string; headword: string }) => [w.id, w]),
)
const errors: string[] = []
const seenIds = new Set<string>()
const useCount = new Map<string, number>()

for (const p of file.passages) {
  const at = (msg: string) => errors.push(`[${p.id}] ${msg}`)

  // 形状先兜一层,否则下面 p.en.entries() 会抛出一个看不出哪篇出问题的栈
  if (typeof p.id !== 'string' || typeof p.title !== 'string'
      || !Array.isArray(p.en) || !Array.isArray(p.zh)) {
    errors.push(`[${String(p.id)}] 缺 id / title / en / zh,或类型不对`)
    continue
  }

  if (!/^[a-z0-9-]+$/.test(p.id)) at('id 只允许小写字母、数字与连字符')
  if (seenIds.has(p.id)) at('id 重复')
  seenIds.add(p.id)

  if (p.title.trim() === '') at('title 不能为空')
  if (p.en.length === 0) at('en 不能为空')
  if (p.en.length !== p.zh.length) at(`中英句数对不上:en ${p.en.length} 句,zh ${p.zh.length} 句`)

  let marks = 0
  for (const [si, sentence] of p.en.entries()) {
    // 先把合法标记摘掉,残留花括号说明写坏了
    const stripped = sentence.replace(MARKER, '')
    if (/[{}]/.test(stripped)) at(`第 ${si + 1} 句有畸形标记`)

    for (const m of sentence.matchAll(MARKER)) {
      marks += 1
      const wordId = m[1].trim()
      const surface = (m[2] ?? m[1]).trim()
      const w = byId.get(wordId)
      if (w === undefined) {
        at(`第 ${si + 1} 句引用了词库里没有的 ${wordId}`)
        continue
      }
      if (!isInflectionOf(surface, w.headword)) {
        at(`第 ${si + 1} 句:「${surface}」不是 ${w.headword} 的变形`)
      }
      useCount.set(wordId, (useCount.get(wordId) ?? 0) + 1)
    }
  }
  if (marks < MIN_MARKS) at(`只标记了 ${marks} 个词,至少要 ${MIN_MARKS} 个`)
}

// --- 覆盖分布报告(不算错误,是给下一批语料的输入) ---
const covered = [...useCount.keys()].length
console.log(`短文 ${file.passages.length} 篇,覆盖 ${covered} / ${words.words.length} 个词`)
const multi = [...useCount.values()].filter(c => c >= 3).length
console.log(`其中出现 3 次以上的:${multi} 个`)

if (errors.length > 0) {
  console.error(`\n校验不通过,共 ${errors.length} 条:`)
  for (const e of errors) console.error('  ' + e)
  process.exit(1)
}
console.log('校验通过')
```

- [ ] **Step 2: 加 npm 脚本**

在 `package.json` 的 `scripts` 里,`validate-words` 之后加一行:

```json
    "validate-passages": "tsx scripts/validate-passages.ts"
```

- [ ] **Step 3: 跑它**

```bash
npm run validate-passages
```

预期:

```
短文 2 篇,覆盖 16 / 471 个词
其中出现 3 次以上的:0 个
校验通过
```

- [ ] **Step 4: 确认它抓得住坏数据**

临时把 `src/data/passages.json` 里 `{{refute|refuted}}` 改成 `{{refute|reference}}`,再跑一次:

```bash
npm run validate-passages
```

预期:退出码 1,报 `[committee-report] 第 2 句:「reference」不是 refute 的变形`。

**确认后把改动还原:**

```bash
git checkout src/data/passages.json
```

- [ ] **Step 5: 提交**

```bash
git add scripts/validate-passages.ts package.json
git commit -m "feat(scripts): 短文语料校验"
```

---

## Task 9: localStorage 键

**Files:**
- Modify: `src/lib/storage.ts`

- [ ] **Step 1: 加键**

在 `src/lib/storage.ts` 的 `KEYS` 里,`stagingOps` 之后加一行:

```ts
  recentPassages: 'volcab.recentPassages', // 最近做过的短文 id。只防重复,不值得为它往 progress.json 加同步字段
```

- [ ] **Step 2: 确认类型仍然通过**

```bash
npx tsc -b
```

预期:无输出(成功)。

- [ ] **Step 3: 提交**

```bash
git add src/lib/storage.ts
git commit -m "feat(storage): 记最近做过的短文"
```

---

## Task 10: 短文会话的做题态

**Files:**
- Create: `src/pages/QuizPassage.tsx`

- [ ] **Step 1: 写组件**

创建 `src/pages/QuizPassage.tsx`:

```tsx
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Chip } from '../components/Chip'
import { pickPassage, pushRecent } from '../lib/passage'
import type { Passage, PassageQuestion } from '../lib/passage'
import { isSoundEnabled, playQuizResult } from '../lib/sound'
import { todayStr } from '../lib/srs'
import { storage } from '../lib/storage'
import { useApp } from '../state/store'
import type { Word } from '../types'

/**
 * 短文选词填空。
 *
 * 与其余四个模式的关键区别:**交卷制**。现有题型点了就锁死,这里是填完整篇再交,
 * 中途随便改。理由是几个空互为线索 —— 做到第五个空发现第二个填错了,是这题正常
 * 的解题路径,不是失误;不让改等于剥夺了这个题型最核心的推理过程。
 * 正因为交互不同,它没有复用 QuizQuestionView(与 QuizSprint 同一条理由)。
 */
export function PassageSession({
  words,
  passages,
  onRestart,
}: {
  words: Word[]
  passages: Passage[]
  onRestart: () => void
}) {
  const { progress, recordQuiz } = useApp()
  const soundEnabled = isSoundEnabled(progress.settings)

  // 惰性初始值,理由同 QuizSession:pickPassage 走 Math.random,渲染期间重新
  // 调用会在答题过程中把短文悄悄换掉。
  const [question] = useState<PassageQuestion | null>(() => {
    const recent = storage.get<string[]>('recentPassages') ?? []
    const q = pickPassage(passages, words, progress, todayStr(new Date()), recent)
    if (q !== null) storage.set('recentPassages', pushRecent(recent, q.passage.id))
    return q
  })

  /** 空下标 → 选中的候选词 wordId */
  const [filled, setFilled] = useState<Record<number, string>>({})
  const [active, setActive] = useState<number | null>(0)
  const [submitted, setSubmitted] = useState(false)
  const recordedRef = useRef(false)

  const blanks = question?.blanks ?? []
  const filledCount = Object.keys(filled).length
  const allFilled = blanks.length > 0 && filledCount === blanks.length

  /** wordId → 它占着第几个空;没被用掉就是 undefined */
  const usedBy = useMemo(() => {
    const m = new Map<string, number>()
    for (const [k, v] of Object.entries(filled)) m.set(v, Number(k))
    return m
  }, [filled])

  const chooseBlank = (i: number) => {
    if (submitted) return
    setActive(i)
  }

  const chooseWord = (wordId: string) => {
    if (submitted) return
    // 已经占着某个空的词:再点一次就是撤回
    const at = usedBy.get(wordId)
    if (at !== undefined) {
      setFilled(f => {
        const next = { ...f }
        delete next[at]
        return next
      })
      setActive(at)
      return
    }
    const i = active ?? blanks.findIndex((_, n) => filled[n] === undefined)
    if (i < 0) return
    setFilled(f => ({ ...f, [i]: wordId }))
    // 自动跳到下一个还空着的空 —— 每填一个都要手动点下一个空太累
    const nextEmpty = blanks.findIndex((_, n) => n !== i && filled[n] === undefined)
    setActive(nextEmpty < 0 ? null : nextEmpty)
  }

  const score = blanks.filter((b, i) => filled[i] === b.wordId).length

  const submit = useCallback(() => {
    if (submitted || !allFilled) return
    // 在点击的调用栈内同步播放,iOS 要求 AudioContext 解锁发生在用户手势内
    playQuizResult(score === blanks.length, soundEnabled)
    setSubmitted(true)
    setActive(null)
  }, [submitted, allFilled, score, blanks.length, soundEnabled])

  useEffect(() => {
    if (!submitted || recordedRef.current) return
    recordedRef.current = true
    const wrongIds = blanks.filter((b, i) => filled[i] !== b.wordId).map(b => b.wordId)
    recordQuiz(score, blanks.length, wrongIds)
  }, [submitted, blanks, filled, score, recordQuiz])

  if (question === null) {
    return (
      <Card className="quiz-empty">
        <p>短文题只考你学过的词,一篇里至少要凑够 3 个。再学一阵子,这里的题会自己多起来。</p>
        <Link className="btn btn--primary" to="/library">
          去词库看看
        </Link>
      </Card>
    )
  }

  /** 某个 token 是第几个空;不是空返回 -1 */
  const blankIndexAt = (si: number, ti: number) =>
    blanks.findIndex(b => b.si === si && b.ti === ti)

  const headwordOf = (wordId: string) =>
    question.choices.find(c => c.wordId === wordId)?.headword ?? wordId

  return (
    <>
      <div className="quiz-progress">
        <div
          className="progress"
          role="progressbar"
          aria-label="填空进度"
          aria-valuemin={0}
          aria-valuemax={blanks.length}
          aria-valuenow={filledCount}
          aria-valuetext={`已填 ${filledCount} / ${blanks.length} 个空`}
        >
          <div className="progress__fill" style={{ width: `${(filledCount / blanks.length) * 100}%` }} />
        </div>
        <p className="muted num quiz-progress__count">
          已填 {filledCount} / {blanks.length} 个空
        </p>
      </div>

      <Card>
        <p className="quiz-q__label">读短文,把词填进空里</p>
        <p className="quiz-passage__title">{question.passage.title}</p>

        <div className="quiz-passage__text" lang="en">
          {question.sentences.map((tokens, si) => (
            <Fragment key={si}>
              {tokens.map((t, ti) => {
                if (t.kind === 'text') return <Fragment key={ti}>{t.text}</Fragment>
                const bi = blankIndexAt(si, ti)
                if (bi < 0) return <Fragment key={ti}>{t.surface}</Fragment>
                const chosen = filled[bi]
                const correct = chosen === blanks[bi].wordId
                const cls = ['quiz-blank-slot']
                if (!submitted && active === bi) cls.push('quiz-blank-slot--active')
                if (submitted) cls.push(correct ? 'quiz-blank-slot--correct' : 'quiz-blank-slot--wrong')
                return (
                  <button
                    key={ti}
                    type="button"
                    className={cls.join(' ')}
                    disabled={submitted}
                    aria-label={`第 ${bi + 1} 个空`}
                    onClick={() => chooseBlank(bi)}
                  >
                    {submitted && !correct && chosen !== undefined ? (
                      <span className="quiz-blank-slot__wrong">{headwordOf(chosen)}</span>
                    ) : null}
                    {submitted ? blanks[bi].surface : (chosen === undefined ? '___' : headwordOf(chosen))}
                  </button>
                )
              })}
              {si < question.sentences.length - 1 ? ' ' : null}
            </Fragment>
          ))}
        </div>

        {!submitted ? (
          <>
            <div className="quiz-passage__choices" role="group" aria-label="候选词">
              {question.choices.map(c => (
                <Chip
                  key={c.wordId}
                  label={<span lang="en">{c.headword}</span>}
                  selected={usedBy.has(c.wordId)}
                  onClick={() => chooseWord(c.wordId)}
                />
              ))}
            </div>
            <Button
              className="quiz-q__next"
              variant="primary"
              block
              disabled={!allFilled}
              onClick={submit}
            >
              {allFilled ? '交卷' : `还剩 ${blanks.length - filledCount} 个空`}
            </Button>
          </>
        ) : null}
      </Card>

      {submitted ? <PassageResult question={question} score={score} onRestart={onRestart} /> : null}
    </>
  )
}
```

（`PassageResult` 在 Task 11 补上；本步先加一个占位实现放在同文件末尾,让编译通过：）

```tsx
function PassageResult({
  question, score, onRestart,
}: { question: PassageQuestion; score: number; onRestart: () => void }) {
  return (
    <Card>
      <p className="quiz-result__score" role="status">
        <span className="num quiz-result__score-num">{score}</span>
        <span className="muted"> / {question.blanks.length}</span>
      </p>
      <Button variant="primary" size="lg" block onClick={onRestart}>
        再来一篇
      </Button>
    </Card>
  )
}
```

- [ ] **Step 2: 确认类型通过**

```bash
npx tsc -b
```

预期:无输出。

- [ ] **Step 3: 提交**

```bash
git add src/pages/QuizPassage.tsx
git commit -m "feat(quiz): 短文模式的做题态"
```

---

## Task 11: 交卷态 —— 成绩与逐句对照

**Files:**
- Modify: `src/pages/QuizPassage.tsx`

- [ ] **Step 1: 换掉占位的 PassageResult**

把 Task 10 里那个占位实现整个替换成下面这段。

注意 `wrongSentences` 是**传进来的**,不是从 `question` 里算的:`Blank` 是纯出题结果,不该背着答题状态。哪个空填错了只有 `PassageSession` 知道。

```tsx
/**
 * 交卷后的结果:成绩 + 逐句中英对照。
 *
 * **中译只在这里出现。**做题时给中译等于把答案翻译成中文摆在旁边 ——
 * 「董事会对并购感到忧虑」,apprehensive 就不用想了。
 */
function PassageResult({
  question,
  score,
  wrongSentences,
  onRestart,
}: {
  question: PassageQuestion
  score: number
  /** 有填错的空的句子下标 */
  wrongSentences: Set<number>
  onRestart: () => void
}) {
  const total = question.blanks.length

  return (
    <>
      <Card>
        <p className="quiz-result__score" role="status">
          <span className="num quiz-result__score-num">{score}</span>
          <span className="muted"> / {total}</span>
        </p>
        <p className="muted quiz-result__summary">
          {score === total ? '全部填对,漂亮!' : `${total} 个空,填对 ${score} 个。`}
        </p>
      </Card>

      <Card>
        <p className="quiz-q__label">逐句对照</p>
        <ol className="quiz-passage__pairs">
          {question.passage.zh.map((zh, si) => (
            <li key={si} className={wrongSentences.has(si) ? 'quiz-passage__pair--wrong' : undefined}>
              <p lang="en">{plainSentence(question.sentences[si])}</p>
              <p className="muted">{zh}</p>
            </li>
          ))}
        </ol>
      </Card>

      <div className="quiz-result__actions">
        <Button variant="primary" size="lg" block onClick={onRestart}>
          再来一篇
        </Button>
        <Link className="btn btn--secondary btn--block" to="/">
          返回今日
        </Link>
      </div>
    </>
  )
}

/** 把 token 还原成不带标记的英文原句 —— 对照区展示的是完整句子,不是题面。 */
function plainSentence(tokens: Token[]): string {
  return tokens.map(t => (t.kind === 'text' ? t.text : t.surface)).join('')
}
```

- [ ] **Step 2: 在 `PassageSession` 里把判错信息传下去**

把渲染 `PassageResult` 那一行改成:

```tsx
      {submitted ? (
        <PassageResult
          question={question}
          score={score}
          wrongSentences={new Set(blanks.filter((b, i) => filled[i] !== b.wordId).map(b => b.si))}
          onRestart={onRestart}
        />
      ) : null}
```

- [ ] **Step 3: 补 import**

文件顶部的 type import 加上 `Token`:

```tsx
import type { Passage, PassageQuestion, Token } from '../lib/passage'
```

- [ ] **Step 4: 确认类型通过**

```bash
npx tsc -b
```

预期:无输出。

- [ ] **Step 5: 提交**

```bash
git add src/pages/QuizPassage.tsx
git commit -m "feat(quiz): 短文交卷后的成绩与逐句对照"
```

---

## Task 12: 接进 `/quiz` 与样式

**Files:**
- Modify: `src/pages/Quiz.tsx`
- Modify: `src/pages/Quiz.css`

- [ ] **Step 1: `MODES` 加一项**

在 `src/pages/Quiz.tsx` 的 `MODES` 数组末尾加:

```tsx
  { key: 'passage', label: '短文' },
```

- [ ] **Step 2: 收窄 `EMPTY_HINT` 的类型**

`EMPTY_HINT` 只服务走 `QuizSession` 的三种模式。把它的类型从

```tsx
const EMPTY_HINT: Record<Exclude<QuizMode, 'sprint'>, string> = {
```

改成

```tsx
const EMPTY_HINT: Record<Exclude<QuizMode, 'sprint' | 'passage'>, string> = {
```

同时把 `QuizSession` 的 props 类型改成:

```tsx
  mode: Exclude<QuizMode, 'sprint' | 'passage'>
```

- [ ] **Step 3: 分支到 `PassageSession`**

在 `Quiz.tsx` 顶部加 import:

```tsx
import { PassageSession } from './QuizPassage'
import type { Passage } from '../lib/passage'
```

在 `Quiz()` 组件里,`const restart = ...` 之前加语料的惰性加载 —— **动态 import,不进首屏包体**:

```tsx
  // 语料只在真的进短文模式时才拉。它是随 App 发布的静态内容,
  // 用 import() 拆成独立 chunk,不让四种日常模式为它多下几十 KB。
  const [passages, setPassages] = useState<Passage[] | null>(null)
  useEffect(() => {
    if (mode !== 'passage' || passages !== null) return
    let alive = true
    void import('../data/passages.json').then(m => {
      if (alive) setPassages((m.default as { passages: Passage[] }).passages)
    })
    return () => { alive = false }
  }, [mode, passages])
```

把渲染分支改成:

```tsx
      {mode === 'sprint' ? (
        <SprintSession key={`sprint-${session}`} words={words} onRestart={restart} />
      ) : mode === 'passage' ? (
        passages === null ? (
          <Card className="quiz-empty"><p className="muted">正在加载短文…</p></Card>
        ) : (
          <PassageSession
            key={`passage-${session}`}
            words={words}
            passages={passages}
            onRestart={restart}
          />
        )
      ) : (
        <QuizSession key={`${mode}-${session}`} words={words} mode={mode} onRestart={restart} />
      )}
```

`Quiz.tsx` 已经 import 了 `Card` 与 `useEffect`;若 `useEffect` 不在 import 列表里,补进去。

- [ ] **Step 4: 加样式**

在 `src/pages/Quiz.css` 末尾追加:

```css
/* ==========================================================================
   短文选词填空
   ========================================================================== */

.quiz-passage__title {
  margin-top: var(--sp-2);
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--text-muted);
}

/* 正文是一整段可读的散文,行高必须比按钮里的文字松 —— 这是要读的,不是要点的 */
.quiz-passage__text {
  margin-top: var(--sp-4);
  font-size: var(--fs-base);
  line-height: 2;
}

/* 空是行内按钮。用下划线而不是方框:方框会把一段散文切成一格格表单,
   读起来不再像文章。行高 2 就是为了给它留出下划线的位置。 */
.quiz-blank-slot {
  display: inline;
  padding: 0 var(--sp-1);
  border: none;
  border-bottom: 2px solid var(--rule-control);
  border-radius: 0;
  background: none;
  font: inherit;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
}

.quiz-blank-slot--active {
  border-bottom-color: var(--accent);
  background: var(--surface-sunken);
}

.quiz-blank-slot--correct {
  border-bottom-color: var(--success);
  color: var(--success);
  cursor: default;
}

.quiz-blank-slot--wrong {
  border-bottom-color: var(--danger);
  color: var(--success);
  cursor: default;
}

/* 填错时,你填的那个词划掉留在正确答案前面 —— 光给正确答案,
   你不会记得自己刚才错在哪 */
.quiz-blank-slot__wrong {
  margin-inline-end: var(--sp-1);
  text-decoration: line-through;
  color: var(--danger);
  font-weight: 400;
}

.quiz-passage__choices {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin-top: var(--sp-5);
}

/* 用掉的候选词置灰,但不移除 —— 位置固定才好再点一次撤回 */
.quiz-passage__choices .chip[aria-pressed='true'] {
  opacity: 0.4;
}

.quiz-passage__pairs {
  display: grid;
  gap: var(--sp-4);
  margin-top: var(--sp-3);
}

.quiz-passage__pairs li {
  display: grid;
  gap: var(--sp-1);
  line-height: var(--lh-snug);
}

/* 填错的那一句在译文里标出来:朱砂只做批注,这里正是「这句你错了」这条批注 */
.quiz-passage__pair--wrong {
  padding-left: var(--sp-3);
  border-left: 2px solid var(--accent);
}
```

- [ ] **Step 5: 构建与全量测试**

```bash
npm run build
```

预期:构建成功,产物里多出一个 `passages` 的独立 chunk。

```bash
npm test
```

预期:全部通过。

- [ ] **Step 6: 真机走一遍**

启动 dev server,进 `/quiz?mode=passage`,确认:

1. 短文正文里出现 `___`,候选词在下方
2. 点空 → 高亮;点候选词 → 填入并自动跳到下一个空;再点该候选词 → 撤回
3. 没填满时交卷按钮显示「还剩 N 个空」且不可点
4. 交卷后:填对的空变绿并显示句中形式(`refuted` 而不是 `refute`),填错的空显示划掉的错词 + 正确形式
5. 逐句对照出现,填错的那句左侧有朱砂批注条
6. 375px 下正文不横向溢出

- [ ] **Step 7: 提交**

```bash
git add src/pages/Quiz.tsx src/pages/Quiz.css
git commit -m "feat(quiz): 短文模式接进 /quiz"
```

---

## Task 13: 批量生产语料

**Files:**
- Modify: `src/data/passages.json`

- [ ] **Step 1: 挑词分组**

```bash
node -e "
const d=require('./data/words.json');
const used=new Set([...JSON.stringify(require('./src/data/passages.json')).matchAll(/\{\{([^{}|]+)/g)].map(m=>m[1]));
const pool=d.words.filter(w=>(w.usageScore??0)>=6&&!used.has(w.id));
pool.sort((a,b)=>(b.usageScore??0)-(a.usageScore??0));
const groups=[];
for(let i=0;i<pool.length&&groups.length<28;i+=7) groups.push(pool.slice(i,i+7).map(w=>w.id+' — '+w.meanings[0].pos+' '+w.meanings[0].zh));
groups.forEach((g,i)=>console.log('组 '+(i+1)+':\n  '+g.join('\n  ')+'\n'));
"
```

输出直接看终端即可;要存盘就重定向到 scratchpad 目录,不要写进仓库。

- [ ] **Step 2: 并行派 agent 写**

每组派一个 agent,提示词模板(把 `<组内容>` 换成上一步该组的实际内容):

```
你在给一个中文用户的英语词汇 App 写「选词填空」短文语料。

写 1 篇短文,把下面这组词自然地串进同一个情境里:
<组内容>

硬性要求:
1. 输出严格的 JSON 对象,字段为 id / title / en / zh,不要任何解释文字
2. id:小写字母+连字符,能一眼看出这篇讲什么,如 "committee-report"
3. title:一句中文短语,如「一票通过的那份报告」
4. en:字符串数组,一句一个元素,共 4~6 句,总长 80~120 词
5. zh:字符串数组,与 en 一一对应,是地道中文而不是逐词直译
6. 目标词在 en 里用 {{wordId}} 标记;若句中用的是变形,写 {{wordId|句中形式}}
   例:{{refute|refuted}}、{{ratify|ratified}}、{{oversight}}
7. 每个目标词只标记一次
8. 全部 7 个词都要用上

内容要求:
- 一个具体的现代场景(职场、新闻、城市生活),有事件、有转折,不是词义的堆砌
- 每个空必须靠上下文能判断出来。如果换成另一个同组词句子也通顺,重写那句
- 不写考试腔的空泛句子("It is important that...")

只输出 JSON 对象。
```

- [ ] **Step 3: 合并进语料文件**

把各 agent 返回的对象追加进 `src/data/passages.json` 的 `passages` 数组。

- [ ] **Step 4: 校验**

```bash
npm run validate-passages
```

预期:校验通过,并打印覆盖分布。任何一条错误都必须改掉——**校验不过不进仓库**。

- [ ] **Step 5: 人工抽查**

随机读 3 篇,逐条确认:

1. 每个空换成同组另一个词后,句子是否明显不通?(通顺 = 这个空有两个答案,必须重写)
2. 中译是不是地道中文,而不是英文语序的翻译腔?
3. 有没有事实性错误或别扭的搭配?

- [ ] **Step 6: 跑一轮真题**

```bash
npm run build
```

启动 dev server,进 `/quiz?mode=passage` 连做 5 篇,确认选出来的短文确实覆盖了当天到期的词。

- [ ] **Step 7: 提交**

```bash
git add src/data/passages.json
git commit -m "data: 短文语料补到 N 篇"
```

（把 `N` 换成实际篇数。）

---

## 收尾

- [ ] `npm run build && npm test` 全绿
- [ ] `npm run validate-passages` 通过
- [ ] 在真机(手机浏览器)上做完一整篇,确认 375px 下正文不溢出、候选词不换行错乱
- [ ] 用一周后回头看:短文题的错词率与单句挖空比是高是低?如果差不多,说明这个题型没带来额外价值,该考虑是撑到全库还是就停在试点规模
