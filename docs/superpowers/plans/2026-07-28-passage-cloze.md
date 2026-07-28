# Passage Cloze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fifth mode, "短文" (Passage), to `/quiz` — a passage of 80–120 words with 3–7 blanks, candidate words listed below it, submit only after filling in the whole passage, then a sentence-by-sentence Chinese-English comparison after submission.

**Architecture:** All question-generation logic lives in the pure-function module `src/lib/passage.ts` (parse markers → select blanks → assemble candidate words → score passages); the render layer `src/pages/QuizPassage.tsx` is only responsible for painting the already-computed result. The content file `src/data/passages.json` ships with the app and is split into its own chunk via `import()`. Scoring reuses the existing `recordQuiz(score, total, wrongIds)` — not a single line of `store.tsx` or `srs.ts` changes.

**Tech Stack:** React 19 + TypeScript + Vite + vitest (happy-dom). No new dependencies.

**Design doc:** `docs/superpowers/specs/2026-07-28-passage-cloze-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/passage.ts` (new) | Marker parsing, blank selection, candidate words, passage scoring. **All pure functions** — touches neither the DOM nor localStorage |
| `src/lib/passage.test.ts` (new) | Tests for the above |
| `src/lib/headword.ts` (modified) | Adds `isInflectionOf` — strict suffix matching, for the validation script |
| `src/lib/headword.test.ts` (modified) | Tests for `isInflectionOf` |
| `src/data/passages.json` (new) | Content. Read-only, shipped with the app |
| `src/lib/storage.ts` (modified) | Adds the `recentPassages` key |
| `src/pages/QuizPassage.tsx` (new) | The entire passage-mode session: answering state + submitted state |
| `src/pages/Quiz.tsx` (modified) | Adds an entry to `MODES`, branches to `PassageSession` |
| `src/pages/Quiz.css` (modified) | `.quiz-passage-*` styles |
| `scripts/validate-passages.ts` (new) | The write-path gate |
| `package.json` (modified) | Adds the `validate-passages` script |

**Why not reuse `QuizQuestionView`:** Passage mode is submit-once (answers can be changed, the whole passage is judged at once), which is a different interaction from the existing "tap and it locks, one question judged at a time." `QuizSprint.tsx` didn't reuse it either, for the same reason — that precedent sits right alongside it.

---

## Task 1: Marker Parsing

**Files:**
- Create: `src/lib/passage.ts`
- Create: `src/lib/passage.test.ts`

- [ ] **Step 1: Write a failing test**

Create `src/lib/passage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parsePassage, parseSentence } from './passage'
import type { Passage } from './passage'

/**
 * Pure logic for generating passage questions. The UI has no component tests
 * (per repo convention, see the top of store.test.tsx), so every branch worth
 * testing has to live in this file.
 */

const passage = (over: Partial<Passage> = {}): Passage => ({
  id: 'p1',
  title: '测试短文',
  en: ['The board was {{contentious}} about it.'],
  zh: ['董事会对此争议不小。'],
  ...over,
})

describe('parseSentence', () => {
  it('shorthand marker: surface form equals the headword', () => {
    expect(parseSentence('a {{refute}} b')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'word', wordId: 'refute', surface: 'refute' },
      { kind: 'text', text: ' b' },
    ])
  })

  it('marker with a pipe: surface form differs from the headword', () => {
    expect(parseSentence('they {{refute|refuted}} it')).toEqual([
      { kind: 'text', text: 'they ' },
      { kind: 'word', wordId: 'refute', surface: 'refuted' },
      { kind: 'text', text: ' it' },
    ])
  })

  it('multiple markers in one sentence', () => {
    const tokens = parseSentence('{{a}} and {{b|bs}}')
    expect(tokens?.filter(t => t.kind === 'word')).toHaveLength(2)
  })

  it('no markers means one text segment for the whole sentence', () => {
    expect(parseSentence('plain text')).toEqual([{ kind: 'text', text: 'plain text' }])
  })

  it('malformed markers return null — better to skip the whole passage than produce a question with the wrong blank', () => {
    expect(parseSentence('a {{b} c')).toBeNull()       // unbalanced braces
    expect(parseSentence('a {{b|c|d}} e')).toBeNull()  // two pipes
    expect(parseSentence('a {{}} b')).toBeNull()       // empty id
    expect(parseSentence('a {{b|}} c')).toBeNull()     // empty surface form
  })
})

describe('parsePassage', () => {
  it('parses sentence by sentence, returns a 2D token array when the sentence count matches zh', () => {
    const r = parsePassage(passage({ en: ['{{a}} x.', 'y {{b}}.'], zh: ['甲', '乙'] }))
    expect(r).toHaveLength(2)
  })

  it('returns null when the zh sentence count is off — the read path is tolerant of bad data, it just skips this passage', () => {
    expect(parsePassage(passage({ en: ['a', 'b'], zh: ['甲'] }))).toBeNull()
  })

  it('returns null for an empty passage', () => {
    expect(parsePassage(passage({ en: [], zh: [] }))).toBeNull()
  })

  it('returns null for the whole passage if any single sentence is malformed', () => {
    expect(parsePassage(passage({ en: ['ok {{a}}', 'bad {{b}'], zh: ['甲', '乙'] }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
npx vitest run src/lib/passage.test.ts
```

Expected: FAIL, `Failed to resolve import "./passage"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/passage.ts`:

```ts
/**
 * Question-generation logic for passage word-choice cloze. All pure functions —
 * the render layer is only responsible for painting the result computed here.
 *
 * Design: docs/superpowers/specs/2026-07-28-passage-cloze-design.md
 */

export interface Passage {
  id: string
  title: string
  /** Sentence-by-sentence English. Target words are marked with {{wordId|surface form}}; shorthand to {{concoct}} when the surface form matches the headword */
  en: string[]
  /** Sentence-by-sentence Chinese translation, one-to-one with en */
  zh: string[]
}

export interface PassagesFile { version: 1; passages: Passage[] }

export type Token =
  | { kind: 'text'; text: string }
  | { kind: 'word'; wordId: string; surface: string }

/**
 * `{{wordId}}` or `{{wordId|surface form}}`.
 *
 * Neither the id nor the form may contain `{}|`, so a broken marker like
 * `{{a|b|c}}` **won't match** and is left as-is in the text segment — the
 * leftover-brace check below then fails the whole sentence.
 */
const MARKER = /\{\{([^{}|]+)(?:\|([^{}|]+))?\}\}/g

/**
 * Parse one sentence. Malformed markers return null.
 *
 * **Better to skip the whole passage than to settle for something wrong**: a
 * broken marker doesn't just mean one fewer blank, it means the wrong blank
 * gets dug, or a half-string like `{{refute` gets printed straight into the
 * question. Same rule as words.json's "strict on write, lenient on read" —
 * the validation script is the gate, this is the no-blank-screen fallback.
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

/** Parses the whole passage sentence by sentence. Returns null for the whole passage if any sentence is malformed, or if the English/Chinese sentence counts don't match. */
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

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npx vitest run src/lib/passage.test.ts
```

Expected: PASS, all 9 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/passage.ts src/lib/passage.test.ts
git commit -m "feat(passage): passage marker parsing"
```

---

## Task 2: `isInflectionOf` — Strict Word-Form Matching for the Validation Script

**Files:**
- Modify: `src/lib/headword.ts`
- Modify: `src/lib/headword.test.ts`

- [ ] **Step 1: Write a failing test**

Append to the end of `src/lib/headword.test.ts`:

```ts
describe('isInflectionOf', () => {
  it('the base form itself counts', () => {
    expect(isInflectionOf('refute', 'refute')).toBe(true)
  })

  it('common inflected forms count', () => {
    expect(isInflectionOf('refuted', 'refute')).toBe(true)
    expect(isInflectionOf('ratified', 'ratify')).toBe(true)
    expect(isInflectionOf('inundated', 'inundate')).toBe(true)
    expect(isInflectionOf('thwarting', 'thwart')).toBe(true)
  })

  it('case-insensitive', () => {
    expect(isInflectionOf('Refuted', 'refute')).toBe(true)
  })

  /**
   * This case is this function's entire reason for existing. headwordPattern
   * falls back to the loose stem match `stem + [a-z]*` when the base form is
   * absent, and using that for validation would judge reference to be an
   * inflected form of refute — that loose rule is a necessary fallback when
   * locating a word across a whole sentence, but it's a loophole when
   * validating a single word.
   */
  it('words that merely look similar but are unrelated do not count', () => {
    expect(isInflectionOf('reference', 'refute')).toBe(false)
    expect(isInflectionOf('mirth', 'mire')).toBe(false)
    expect(isInflectionOf('officials', 'officiate')).toBe(false)
  })

  it('extra prefixes or suffixes do not count', () => {
    expect(isInflectionOf('unrefuted', 'refute')).toBe(false)
    expect(isInflectionOf('refutation', 'refute')).toBe(false)
  })

  it('empty strings do not count', () => {
    expect(isInflectionOf('', 'refute')).toBe(false)
    expect(isInflectionOf('refute', '')).toBe(false)
  })
})
```

Also update the import at the top of the file to include `isInflectionOf`:

```ts
import { escapeRe, headwordPattern, isInflectionOf, splitByHeadword } from './headword'
```

(If the original import line's members differ, just add `isInflectionOf` to it — don't remove any existing members.)

- [ ] **Step 2: Run the test and confirm it fails**

```bash
npx vitest run src/lib/headword.test.ts
```

Expected: FAIL, `isInflectionOf is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/lib/headword.ts`, leave the `SUFFIX` constant above `tightPattern` unchanged, and append after `headwordPattern`:

```ts
/**
 * Whether `surface` is an inflected form of `headword`.
 *
 * **Only uses the tight rule, never falls back to headwordPattern's loose path.**
 * That fallback (`stem + [a-z]*`) exists so a headword can still be located
 * across a whole sentence; used to validate a single word, it would judge
 * `reference` to be an inflected form of `refute`, and `mirth` an inflected
 * form of `mire`. During validation there's only one candidate word, so
 * there's none of the "skip the question if you can't locate it" pressure —
 * this calls for the strict suffix-enumeration rule.
 *
 * Only used by the write-path validation script (scripts/validate-passages.ts).
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

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npx vitest run src/lib/headword.test.ts
```

Expected: PASS, 6 new cases green, existing cases unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/lib/headword.ts src/lib/headword.test.ts
git commit -m "feat(headword): add isInflectionOf, validates the surface form of passage markers"
```

---

## Task 3: Selecting Blanks

**Files:**
- Modify: `src/lib/passage.ts`
- Modify: `src/lib/passage.test.ts`

- [ ] **Step 1: Write a failing test**

In `src/lib/passage.test.ts`, first add the new symbols to the top import, and add a set of test doubles:

```ts
import { MAX_BLANKS, parsePassage, parseSentence, selectBlanks } from './passage'
import { emptyProgress } from '../types'
import type { Progress, Word } from '../types'
```

Append after `const passage = ...`:

```ts
/** Builds a word entry that's good enough for testing. Tests only care about id / headword / meanings[0].pos. */
const word = (id: string, pos = 'v.'): Word => ({
  id, headword: id, phonetic: '', 
  meanings: [{ pos, en: '', zh: id }],
  examples: [], synonyms: [], antonyms: [], collocations: [], relatedForms: [],
  sourceNote: 'test', addedAt: '2026-01-01',
})

/** Progress with state=review and a controllable due date. Words listed in ids count as learned. */
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

Then append more tests:

```ts
describe('selectBlanks', () => {
  it('only blanks words that are learned; unlearned ones stay in the passage as-is, as reading material', () => {
    const sentences = parsePassage(passage({
      en: ['{{a}} {{b}} {{c}}'], zh: ['甲'],
    }))!
    const words = [word('a'), word('b'), word('c')]
    const progress = progressWith({ a: TODAY, b: TODAY })  // c is unlearned
    const blanks = selectBlanks(sentences, byId(words), progress, TODAY)
    expect(blanks.map(b => b.wordId)).toEqual(['a', 'b'])
  })

  it('words missing from the word list are never blanked — the repo copy and the live word list diverge', () => {
    const sentences = parsePassage(passage({ en: ['{{a}} {{ghost}}'], zh: ['甲'] }))!
    const progress = progressWith({ a: TODAY, ghost: TODAY })
    const blanks = selectBlanks(sentences, byId([word('a')]), progress, TODAY)
    expect(blanks.map(b => b.wordId)).toEqual(['a'])
  })

  it('the same word gets at most one blank per passage, otherwise the candidate area would show two identical words', () => {
    const sentences = parsePassage(passage({ en: ['{{a}} then {{a|as}}'], zh: ['甲'] }))!
    const blanks = selectBlanks(sentences, byId([word('a')]), progressWith({ a: TODAY }), TODAY)
    expect(blanks).toHaveLength(1)
    expect(blanks[0].surface).toBe('a')
  })

  it('carries the surface form and position', () => {
    const sentences = parsePassage(passage({
      en: ['x {{refute|refuted}} y', 'z {{a}}'], zh: ['甲', '乙'],
    }))!
    const words = [word('refute'), word('a')]
    const blanks = selectBlanks(sentences, byId(words), progressWith({ refute: TODAY, a: TODAY }), TODAY)
    expect(blanks[0]).toMatchObject({ si: 0, ti: 1, wordId: 'refute', surface: 'refuted' })
    expect(blanks[1]).toMatchObject({ si: 1, wordId: 'a' })
  })

  it('when over the cap, due words are prioritized, but the return order still follows the passage', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    const sentences = parsePassage(passage({
      en: [ids.map(i => `{{${i}}}`).join(' ')], zh: ['甲'],
    }))!
    const words = ids.map(i => word(i))
    // the first two are not due, the rest are — 9 candidates cut down to 7, the first two should be dropped
    const progress = progressWith(Object.fromEntries(
      ids.map((i, n) => [i, n < 2 ? '2099-01-01' : TODAY]),
    ))
    const blanks = selectBlanks(sentences, byId(words), progress, TODAY)
    expect(blanks).toHaveLength(MAX_BLANKS)
    expect(blanks.map(b => b.wordId)).toEqual(['c', 'd', 'e', 'f', 'g', 'h', 'i'])
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
npx vitest run src/lib/passage.test.ts
```

Expected: FAIL, `selectBlanks is not exported`.

- [ ] **Step 3: Write the implementation**

Append to the end of `src/lib/passage.ts` (and add an import at the top of the file):

```ts
import type { Progress, Word } from '../types'
```

```ts
/** A passage needs at least 3 blanks. With two blanks the mutual-clue inference doesn't hold — it degenerates into a couple of single-sentence clozes. */
export const MIN_BLANKS = 3
/** At most 7 blanks per screen — any more and you won't finish. */
export const MAX_BLANKS = 7

export interface Blank {
  /** Which sentence */
  si: number
  /** Which token within that sentence */
  ti: number
  wordId: string
  /** Surface form — this is what gets filled in once judged correct */
  surface: string
}

/**
 * Selects which blanks to dig.
 *
 * **Only blanks words that are learned** (`state !== 'new'`); unlearned
 * words, and words that can't be found in the word list, are printed as-is.
 * This follows the same lesson contrast mode already learned (see
 * generateContrastQuiz in quiz.ts): don't quiz you on a word you've never
 * seen. But unlike contrast mode, an unseen word is allowed to stay in the
 * context — it isn't a question there, it's reading material.
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
      // The same word gets at most one blank per passage — otherwise the
      // candidate area would show two identical words, and the rule
      // "used means crossed off" would immediately contradict itself.
      if (seen.has(t.wordId)) return
      if (!words.has(t.wordId)) return
      const e = progress.words[t.wordId]
      if (e === undefined || e.state === 'new') return
      seen.add(t.wordId)
      eligible.push({ si, ti, wordId: t.wordId, surface: t.surface })
    })
  })

  if (eligible.length <= MAX_BLANKS) return eligible

  // Due ones claim a spot first, then passage order is restored — rendering
  // must follow the order things appear in; what gets cut is "which word to
  // blank," not "how to order them"
  const isDue = (b: Blank) => progress.words[b.wordId].due <= today
  const picked = new Set([...eligible.filter(isDue), ...eligible.filter(b => !isDue(b))].slice(0, MAX_BLANKS))
  return eligible.filter(b => picked.has(b))
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npx vitest run src/lib/passage.test.ts
```

Expected: PASS, 14 cases total.

- [ ] **Step 5: Commit**

```bash
git add src/lib/passage.ts src/lib/passage.test.ts
git commit -m "feat(passage): select blanks — only learned words, due ones prioritized"
```

---

## Task 4: Candidate Words

**Files:**
- Modify: `src/lib/passage.ts`
- Modify: `src/lib/passage.test.ts`

- [ ] **Step 1: Write a failing test**

Add `pickDistractors` to the top import, and add:

```ts
import { buildContrastPairs } from './contrast'
```

Append tests:

```ts
describe('pickDistractors', () => {
  const rng = () => 0.5

  it('prioritizes already-learned words that are easily confused with one of the answers', () => {
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

  it('falls back to already-learned words with a matching part of speech when there are not enough confusables', () => {
    const words = [word('alpha', 'adj.'), word('bravo', 'adj.'), word('charlie', 'n.')]
    const progress = progressWith({ alpha: TODAY, bravo: TODAY, charlie: TODAY })
    const out = pickDistractors(new Set(['alpha']), words, progress, [], 1, rng)
    expect(out.map(w => w.id)).toEqual(['bravo'])
  })

  it('never picks one of the answers itself', () => {
    const words = [word('alpha'), word('bravo')]
    const progress = progressWith({ alpha: TODAY, bravo: TODAY })
    const out = pickDistractors(new Set(['alpha', 'bravo']), words, progress, [], 2, rng)
    expect(out).toHaveLength(0)
  })

  it('unlearned words are never used as distractors', () => {
    const words = [word('alpha'), word('bravo')]
    const out = pickDistractors(new Set(['alpha']), words, progressWith({ alpha: TODAY }), [], 2, rng)
    expect(out).toHaveLength(0)
  })

  it('gives fewer when it cannot fill the quota — one fewer distractor just makes it easier, a duplicate option is a defect', () => {
    const words = [word('alpha'), word('bravo')]
    const progress = progressWith({ alpha: TODAY, bravo: TODAY })
    const out = pickDistractors(new Set(['alpha']), words, progress, [], 5, rng)
    expect(out.map(w => w.id)).toEqual(['bravo'])
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
npx vitest run src/lib/passage.test.ts -t pickDistractors
```

Expected: FAIL, `pickDistractors is not exported`.

- [ ] **Step 3: Write the implementation**

Add to the top import (**only import what's actually used here** — `noUnusedLocals` is on, and importing `buildContrastPairs` here too would fail compilation outright; it isn't needed until Task 6):

```ts
import type { ContrastPair } from './contrast'
import { shuffle } from './quiz'
```

Append to the end:

```ts
/** How many more candidate words there are than blanks. Real word-choice cloze questions always give extra, to force you to eliminate options. */
export const DISTRACTOR_COUNT = 2

/**
 * Picks distractors. Three-tier fallback, and it gives fewer when it can't
 * fill the quota — one fewer distractor just makes this passage slightly
 * easier, while surfacing an option that duplicates an answer is a defect
 * (the same class of problem sharedSynonyms in quiz.ts guards against).
 *
 * 1. Already-learned words from `buildContrastPairs` that are easily confused
 *    with one of the answers — a ready-made confusable-word graph
 * 2. Already-learned words whose primary sense shares its part of speech with
 *    one of the answers (words with a different part of speech would never
 *    clash within a sentence anyway)
 * 3. Any already-learned word
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

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npx vitest run src/lib/passage.test.ts
```

Expected: PASS, 19 cases total.

- [ ] **Step 5: Commit**

```bash
git add src/lib/passage.ts src/lib/passage.test.ts
git commit -m "feat(passage): candidate words — confusables first, three-tier fallback"
```

---

## Task 5: Assembling a Passage Question

**Files:**
- Modify: `src/lib/passage.ts`
- Modify: `src/lib/passage.test.ts`

- [ ] **Step 1: Write a failing test**

Add `buildPassageQuestion` to the top import, and append:

```ts
describe('buildPassageQuestion', () => {
  const rng = () => 0.5
  const ids = ['a', 'b', 'c', 'd', 'e']
  const words = ids.map(i => word(i))
  const allLearned = progressWith(Object.fromEntries(ids.map(i => [i, TODAY])))
  const threeBlank = passage({ en: ['{{a}} {{b}} {{c}}'], zh: ['甲'] })

  it('candidate words = all answers + distractors', () => {
    const q = buildPassageQuestion(threeBlank, words, allLearned, TODAY, [], rng)!
    expect(q.blanks).toHaveLength(3)
    expect(q.choices).toHaveLength(3 + 2)
    expect(new Set(q.choices.map(c => c.wordId)).size).toBe(5)  // no duplicates
    for (const b of q.blanks) {
      expect(q.choices.some(c => c.wordId === b.wordId)).toBe(true)
    }
  })

  it('candidate words carry the base form, for the UI to display', () => {
    const q = buildPassageQuestion(threeBlank, words, allLearned, TODAY, [], rng)!
    expect(q.choices.every(c => c.headword !== '')).toBe(true)
  })

  it('returns null when there are fewer than 3 eligible blanks', () => {
    const p = passage({ en: ['{{a}} {{b}}'], zh: ['甲'] })
    expect(buildPassageQuestion(p, words, allLearned, TODAY, [], rng)).toBeNull()
  })

  it('returns null on parse failure, without throwing', () => {
    const p = passage({ en: ['{{a}} {{b} {{c}}'], zh: ['甲'] })
    expect(buildPassageQuestion(p, words, allLearned, TODAY, [], rng)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
npx vitest run src/lib/passage.test.ts -t buildPassageQuestion
```

Expected: FAIL, `buildPassageQuestion is not exported`.

- [ ] **Step 3: Write the implementation**

Append to the end:

```ts
/** A candidate word. `wordId` is used for scoring, `headword` for display — the two aren't necessarily the same. */
export interface Choice { wordId: string; headword: string }

export interface PassageQuestion {
  passage: Passage
  sentences: Token[][]
  /** In the order they appear in the passage */
  blanks: Blank[]
  /** Already shuffled */
  choices: Choice[]
}

/**
 * Assembles a passage into a question. Returns null when it can't produce one
 * (parse failure / not enough eligible blanks); it's up to the caller to move
 * on to the next passage.
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

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npx vitest run src/lib/passage.test.ts
```

Expected: PASS, 23 cases total.

- [ ] **Step 5: Commit**

```bash
git add src/lib/passage.ts src/lib/passage.test.ts
git commit -m "feat(passage): assemble a passage question"
```

---

## Task 6: Passage-Selection Scoring

**Files:**
- Modify: `src/lib/passage.ts`
- Modify: `src/lib/passage.test.ts`

- [ ] **Step 1: Write a failing test**

Add `pickPassage, pushRecent, RECENT_LIMIT` to the top import, and append:

```ts
describe('pickPassage', () => {
  const rng = () => 0.5
  const ids = ['a', 'b', 'c', 'd', 'e', 'f']
  const words = ids.map(i => word(i))

  const p1 = passage({ id: 'p1', en: ['{{a}} {{b}} {{c}}'], zh: ['甲'] })
  const p2 = passage({ id: 'p2', en: ['{{d}} {{e}} {{f}}'], zh: ['乙'] })

  it('picks the passage with the most words due today', () => {
    const progress = progressWith({
      a: TODAY, b: TODAY, c: TODAY,        // p1: all three are due
      d: TODAY, e: '2099-01-01', f: '2099-01-01',  // p2: only one is due
    })
    expect(pickPassage([p1, p2], words, progress, TODAY, [], rng)?.passage.id).toBe('p1')
  })

  it('recently done passages give way — the second time through you remember last time\'s answers, not the words', () => {
    const progress = progressWith({
      a: TODAY, b: TODAY, c: TODAY,
      d: TODAY, e: TODAY, f: '2099-01-01',  // p2's score would normally be lower than p1's
    })
    expect(pickPassage([p1, p2], words, progress, TODAY, ['p1'], rng)?.passage.id).toBe('p2')
  })

  it('returns null when not a single passage can produce a question', () => {
    const progress = progressWith({ a: TODAY })  // at most one blank per passage
    expect(pickPassage([p1, p2], words, progress, TODAY, [], rng)).toBeNull()
  })

  it('the passage with bad data gets skipped, without affecting the others', () => {
    const broken = passage({ id: 'bad', en: ['{{a} {{b}} {{c}}'], zh: ['甲'] })
    const progress = progressWith({ a: TODAY, b: TODAY, c: TODAY })
    expect(pickPassage([broken, p1], words, progress, TODAY, [], rng)?.passage.id).toBe('p1')
  })
})

describe('pushRecent', () => {
  it('the newest goes first', () => {
    expect(pushRecent(['b', 'c'], 'a')).toEqual(['a', 'b', 'c'])
  })

  it('an id already in the list moves to the front instead of being duplicated', () => {
    expect(pushRecent(['b', 'a', 'c'], 'a')).toEqual(['a', 'b', 'c'])
  })

  it('drops the oldest once past the limit', () => {
    const long = Array.from({ length: RECENT_LIMIT }, (_, i) => `p${i}`)
    const out = pushRecent(long, 'new')
    expect(out).toHaveLength(RECENT_LIMIT)
    expect(out[0]).toBe('new')
    expect(out).not.toContain(`p${RECENT_LIMIT - 1}`)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
npx vitest run src/lib/passage.test.ts -t pickPassage
```

Expected: FAIL, `pickPassage is not exported`.

- [ ] **Step 3: Write the implementation**

Add `buildContrastPairs` to the top import (alongside the existing `import type { ContrastPair } from './contrast'`):

```ts
import { buildContrastPairs } from './contrast'
```

Append to the end:

```ts
/** Due words are weighted above learned-but-not-due — this question type is first a review tool, and only second a reading exercise. */
export const DUE_WEIGHT = 3
export const LEARNED_WEIGHT = 1
/**
 * The penalty for having done a passage recently. **Deliberately set to
 * outweigh "one more due word" (+3)**: better to switch to a new passage
 * with slightly worse coverage than to do the same one back-to-back — the
 * second time through, what you remember is last time's answers, not the
 * words.
 */
export const RECENT_PENALTY = 5
/** How many passages to remember as "recently done." Stored in localStorage, not in progress.json. */
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
 * Picks the passage most worth doing today. Returns null when not a single
 * passage can produce a question (the caller supplies the empty-state copy).
 *
 * `buildContrastPairs` is computed once for the whole word list — putting it
 * inside the loop would mean recomputing the inverted index once per passage.
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
  // Shuffle first: on a tie, the first one encountered wins — without
  // shuffling it would always be whichever passages sit earlier in the array
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

/** Pushes an id to the front of "recently done," dropping the oldest once past the limit. */
export function pushRecent(recent: string[], id: string, limit = RECENT_LIMIT): string[] {
  return [id, ...recent.filter(x => x !== id)].slice(0, limit)
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npx vitest run src/lib/passage.test.ts
```

Expected: PASS, 30 cases total.

- [ ] **Step 5: Commit**

```bash
git add src/lib/passage.ts src/lib/passage.test.ts
git commit -m "feat(passage): passage-selection scoring and recently-done tracking"
```

---

## Task 7: Seed Content

**Files:**
- Create: `src/data/passages.json`

- [ ] **Step 1: Write the content**

Create `src/data/passages.json`. Both passages use only words with `usageScore >= 7` (this batch is the most likely to already be learned):

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

- [ ] **Step 2: Confirm every referenced word exists in the word list**

```bash
node -e "const d=require('./data/words.json');const p=require('./src/data/passages.json');const ids=new Set(d.words.map(w=>w.id));const used=[...JSON.stringify(p).matchAll(/\{\{([^{}|]+)/g)].map(m=>m[1]);const bad=used.filter(i=>!ids.has(i));console.log('referenced',used.length,'markers, missing from word list:',bad)"
```

Expected: `referenced 16 markers, missing from word list: []`

- [ ] **Step 3: Commit**

```bash
git add src/data/passages.json
git commit -m "data: two seed passages for passage cloze"
```

---

## Task 8: Validation Script

**Files:**
- Create: `scripts/validate-passages.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the script**

Create `scripts/validate-passages.ts`:

```ts
/**
 * The write-path gate for passage content. A passage that fails validation
 * does not go into the repo.
 *
 * Run: npm run validate-passages
 *
 * The read path (lib/passage.ts) is tolerant of bad data — it skips that
 * passage, without throwing and without a blank screen. That's the
 * no-blank-screen fallback, not a quality guarantee; the quality guarantee
 * lives here.
 */
import { readFileSync } from 'node:fs'
import { isInflectionOf } from '../src/lib/headword.ts'

/** Minimum number of marked words per passage. Blanks only ever come from learned words, so too few markers means even an early passage can't scrape together 3 blanks. */
const MIN_MARKS = 6

const MARKER = /\{\{([^{}|]+)(?:\|([^{}|]+))?\}\}/g

// Consistent with validate-words.ts: no types in this script — the objects being validated may well not match the expected shape anyway
const words = JSON.parse(readFileSync('data/words.json', 'utf8'))
const file = JSON.parse(readFileSync('src/data/passages.json', 'utf8'))

if (file.version !== 1) { console.error('version must be 1'); process.exit(1) }
if (!Array.isArray(file.passages)) { console.error('passages must be an array'); process.exit(1) }

const byId = new Map<string, { headword: string }>(
  words.words.map((w: { id: string; headword: string }) => [w.id, w]),
)
const errors: string[] = []
const seenIds = new Set<string>()
const useCount = new Map<string, number>()

for (const p of file.passages) {
  const at = (msg: string) => errors.push(`[${p.id}] ${msg}`)

  // Guard the shape first, otherwise p.en.entries() below throws a stack trace that doesn't say which passage is at fault
  if (typeof p.id !== 'string' || typeof p.title !== 'string'
      || !Array.isArray(p.en) || !Array.isArray(p.zh)) {
    errors.push(`[${String(p.id)}] missing id / title / en / zh, or wrong type`)
    continue
  }

  if (!/^[a-z0-9-]+$/.test(p.id)) at('id may only contain lowercase letters, digits, and hyphens')
  if (seenIds.has(p.id)) at('duplicate id')
  seenIds.add(p.id)

  if (p.title.trim() === '') at('title cannot be empty')
  if (p.en.length === 0) at('en cannot be empty')
  if (p.en.length !== p.zh.length) at(`en/zh sentence count mismatch: en has ${p.en.length}, zh has ${p.zh.length}`)

  let marks = 0
  for (const [si, sentence] of p.en.entries()) {
    // Strip out valid markers first — any leftover braces mean this one is broken
    const stripped = sentence.replace(MARKER, '')
    if (/[{}]/.test(stripped)) at(`sentence ${si + 1} has a malformed marker`)

    for (const m of sentence.matchAll(MARKER)) {
      marks += 1
      const wordId = m[1].trim()
      const surface = (m[2] ?? m[1]).trim()
      const w = byId.get(wordId)
      if (w === undefined) {
        at(`sentence ${si + 1} references ${wordId}, which isn't in the word list`)
        continue
      }
      if (!isInflectionOf(surface, w.headword)) {
        at(`sentence ${si + 1}: "${surface}" is not an inflected form of ${w.headword}`)
      }
      useCount.set(wordId, (useCount.get(wordId) ?? 0) + 1)
    }
  }
  if (marks < MIN_MARKS) at(`only ${marks} words marked, need at least ${MIN_MARKS}`)
}

// --- Coverage-distribution report (not an error — it's input for the next batch of content) ---
const covered = [...useCount.keys()].length
console.log(`${file.passages.length} passages, covering ${covered} / ${words.words.length} words`)
const multi = [...useCount.values()].filter(c => c >= 3).length
console.log(`of which appear 3+ times: ${multi}`)

if (errors.length > 0) {
  console.error(`\nValidation failed, ${errors.length} issue(s):`)
  for (const e of errors) console.error('  ' + e)
  process.exit(1)
}
console.log('Validation passed')
```

- [ ] **Step 2: Add the npm script**

In `package.json`'s `scripts`, add a line after `validate-words`:

```json
    "validate-passages": "tsx scripts/validate-passages.ts"
```

- [ ] **Step 3: Run it**

```bash
npm run validate-passages
```

Expected:

```
2 passages, covering 16 / 471 words
of which appear 3+ times: 0
Validation passed
```

- [ ] **Step 4: Confirm it catches bad data**

Temporarily change `{{refute|refuted}}` to `{{refute|reference}}` in `src/data/passages.json`, then run it again:

```bash
npm run validate-passages
```

Expected: exit code 1, reporting `[committee-report] sentence 2: "reference" is not an inflected form of refute`.

**After confirming, revert the change:**

```bash
git checkout src/data/passages.json
```

- [ ] **Step 5: Commit**

```bash
git add scripts/validate-passages.ts package.json
git commit -m "feat(scripts): passage content validation"
```

---

## Task 9: localStorage Key

**Files:**
- Modify: `src/lib/storage.ts`

- [ ] **Step 1: Add the key**

In `KEYS` in `src/lib/storage.ts`, add a line after `stagingOps`:

```ts
  recentPassages: 'volcab.recentPassages', // ids of recently done passages. Only guards against repeats — not worth adding a sync field to progress.json for this
```

- [ ] **Step 2: Confirm the types still pass**

```bash
npx tsc -b
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add src/lib/storage.ts
git commit -m "feat(storage): track recently done passages"
```

---

## Task 10: Passage Session — Answering State

**Files:**
- Create: `src/pages/QuizPassage.tsx`

- [ ] **Step 1: Write the component**

Create `src/pages/QuizPassage.tsx`:

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
 * Passage word-choice cloze.
 *
 * The key difference from the other four modes: **submit-once**. Existing
 * question types lock as soon as you tap an answer; here you fill in the
 * whole passage, then submit, and you're free to change anything along the
 * way. The reason is that the blanks are mutual clues — realizing at the
 * fifth blank that the second one is wrong is the normal way to solve this
 * question, not a mistake; refusing to let you change an answer would strip
 * away the core inference process of this question type.
 * Precisely because the interaction is different, it doesn't reuse
 * QuizQuestionView (same reason as QuizSprint).
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

  // Lazy initial value, same reason as QuizSession: pickPassage runs on
  // Math.random, and calling it again during a re-render would quietly swap
  // out the passage mid-answer.
  const [question] = useState<PassageQuestion | null>(() => {
    const recent = storage.get<string[]>('recentPassages') ?? []
    const q = pickPassage(passages, words, progress, todayStr(new Date()), recent)
    if (q !== null) storage.set('recentPassages', pushRecent(recent, q.passage.id))
    return q
  })

  /** Blank index → the wordId of the chosen candidate */
  const [filled, setFilled] = useState<Record<number, string>>({})
  const [active, setActive] = useState<number | null>(0)
  const [submitted, setSubmitted] = useState(false)
  const recordedRef = useRef(false)

  const blanks = question?.blanks ?? []
  const filledCount = Object.keys(filled).length
  const allFilled = blanks.length > 0 && filledCount === blanks.length

  /** wordId → which blank it occupies; undefined if unused */
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
    // A word that's already occupying a blank: tapping it again withdraws it
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
    // Auto-advance to the next still-empty blank — having to tap the next blank by hand every time is too tiring
    const nextEmpty = blanks.findIndex((_, n) => n !== i && filled[n] === undefined)
    setActive(nextEmpty < 0 ? null : nextEmpty)
  }

  const score = blanks.filter((b, i) => filled[i] === b.wordId).length

  const submit = useCallback(() => {
    if (submitted || !allFilled) return
    // Play synchronously within the click's call stack — iOS requires AudioContext unlocking to happen inside a user gesture
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

  /** Which blank a given token is; -1 if it isn't one */
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

(`PassageResult` gets filled in during Task 11; for this step, add a placeholder implementation at the end of the same file, just enough to compile:)

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

- [ ] **Step 2: Confirm the types pass**

```bash
npx tsc -b
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/pages/QuizPassage.tsx
git commit -m "feat(quiz): passage mode answering state"
```

---

## Task 11: Submitted State — Score and Sentence-by-Sentence Comparison

**Files:**
- Modify: `src/pages/QuizPassage.tsx`

- [ ] **Step 1: Replace the placeholder PassageResult**

Replace the placeholder implementation from Task 10 entirely with the block below.

Note that `wrongSentences` is **passed in**, not computed from `question`: `Blank` is a pure question-generation result and shouldn't carry answering state. Only `PassageSession` knows which blank was filled wrong.

```tsx
/**
 * The result after submitting: score + sentence-by-sentence Chinese-English comparison.
 *
 * **The Chinese translation only appears here.** Showing it while you're
 * still answering would put the answer in Chinese right next to the blank —
 * "董事会对并购感到忧虑" (the board is apprehensive about the merger), and
 * there's nothing left to think about for apprehensive.
 */
function PassageResult({
  question,
  score,
  wrongSentences,
  onRestart,
}: {
  question: PassageQuestion
  score: number
  /** Indices of the sentences containing a blank that was filled wrong */
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

/** Reconstructs the plain, unmarked English sentence from tokens — the comparison area shows the complete sentence, not the question text with blanks. */
function plainSentence(tokens: Token[]): string {
  return tokens.map(t => (t.kind === 'text' ? t.text : t.surface)).join('')
}
```

- [ ] **Step 2: Pass the wrong-answer info down in `PassageSession`**

Change the line that renders `PassageResult` to:

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

- [ ] **Step 3: Add the import**

Add `Token` to the type import at the top of the file:

```tsx
import type { Passage, PassageQuestion, Token } from '../lib/passage'
```

- [ ] **Step 4: Confirm the types pass**

```bash
npx tsc -b
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/pages/QuizPassage.tsx
git commit -m "feat(quiz): passage submission score and sentence-by-sentence comparison"
```

---

## Task 12: Wire Into `/quiz` and Styling

**Files:**
- Modify: `src/pages/Quiz.tsx`
- Modify: `src/pages/Quiz.css`

- [ ] **Step 1: Add an entry to `MODES`**

Add to the end of the `MODES` array in `src/pages/Quiz.tsx`:

```tsx
  { key: 'passage', label: '短文' },
```

- [ ] **Step 2: Narrow the type of `EMPTY_HINT`**

`EMPTY_HINT` only serves the three modes that go through `QuizSession`. Change its type from

```tsx
const EMPTY_HINT: Record<Exclude<QuizMode, 'sprint'>, string> = {
```

to

```tsx
const EMPTY_HINT: Record<Exclude<QuizMode, 'sprint' | 'passage'>, string> = {
```

Also change `QuizSession`'s props type to:

```tsx
  mode: Exclude<QuizMode, 'sprint' | 'passage'>
```

- [ ] **Step 3: Branch to `PassageSession`**

Add an import at the top of `Quiz.tsx`:

```tsx
import { PassageSession } from './QuizPassage'
import type { Passage } from '../lib/passage'
```

In the `Quiz()` component, before `const restart = ...`, add lazy loading of the content — **dynamic import, so it never enters the initial bundle**:

```tsx
  // The content is only fetched once you actually enter passage mode. It's
  // static content shipped with the app, split into a separate chunk via
  // import() so the four everyday modes don't have to download an extra
  // few dozen KB for it.
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

Change the render branch to:

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

`Quiz.tsx` already imports `Card` and `useEffect`; if `useEffect` isn't in the import list, add it.

- [ ] **Step 4: Add styles**

Append to the end of `src/pages/Quiz.css`:

```css
/* ==========================================================================
   Passage word-choice cloze
   ========================================================================== */

.quiz-passage__title {
  margin-top: var(--sp-2);
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--text-muted);
}

/* The passage text is a block of readable prose; the line height needs to be looser than button text — this is meant to be read, not tapped */
.quiz-passage__text {
  margin-top: var(--sp-4);
  font-size: var(--fs-base);
  line-height: 2;
}

/* A blank is an inline button. Underline rather than a box: a box would chop
   a block of prose into a grid of form fields and it would stop reading like
   an article. Line height 2 exists specifically to leave room for the underline. */
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

/* When wrong, the word you filled in stays struck through in front of the
   correct answer — showing only the correct answer, you wouldn't remember
   where you went wrong */
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

/* A used candidate word is greyed out, not removed — keeping its position fixed makes it easy to tap again to withdraw it */
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

/* The sentence containing a wrong answer gets marked in the translation: vermillion is reserved for annotations, and this is exactly the annotation "you got this sentence wrong" */
.quiz-passage__pair--wrong {
  padding-left: var(--sp-3);
  border-left: 2px solid var(--accent);
}
```

- [ ] **Step 5: Build and run the full test suite**

```bash
npm run build
```

Expected: build succeeds, and the output includes one more standalone `passages` chunk.

```bash
npm test
```

Expected: everything passes.

- [ ] **Step 6: Walk through it on a real device**

Start the dev server, go to `/quiz?mode=passage`, and confirm:

1. `___` appears in the passage text, with candidate words below
2. Tap a blank → it highlights; tap a candidate word → it fills the blank and auto-advances to the next blank; tap that candidate word again → it's withdrawn
3. While not fully filled, the submit button shows "还剩 N 个空" and can't be tapped
4. After submitting: correctly filled blanks turn green and show the surface form (`refuted`, not `refute`), and wrongly filled blanks show the struck-through wrong word plus the correct form
5. The sentence-by-sentence comparison appears, with a vermillion annotation bar on the left of any sentence answered wrong
6. At 375px the passage text doesn't overflow horizontally

- [ ] **Step 7: Commit**

```bash
git add src/pages/Quiz.tsx src/pages/Quiz.css
git commit -m "feat(quiz): wire passage mode into /quiz"
```

---

## Task 13: Batch-Producing Content

**Files:**
- Modify: `src/data/passages.json`

- [ ] **Step 1: Pick words and group them**

```bash
node -e "
const d=require('./data/words.json');
const used=new Set([...JSON.stringify(require('./src/data/passages.json')).matchAll(/\{\{([^{}|]+)/g)].map(m=>m[1]));
const pool=d.words.filter(w=>(w.usageScore??0)>=6&&!used.has(w.id));
pool.sort((a,b)=>(b.usageScore??0)-(a.usageScore??0));
const groups=[];
for(let i=0;i<pool.length&&groups.length<28;i+=7) groups.push(pool.slice(i,i+7).map(w=>w.id+' — '+w.meanings[0].pos+' '+w.meanings[0].zh));
groups.forEach((g,i)=>console.log('Group '+(i+1)+':\n  '+g.join('\n  ')+'\n'));
"
```

Just read the output straight from the terminal; if you need to save it, redirect it to the scratchpad directory — don't write it into the repo.

- [ ] **Step 2: Dispatch agents in parallel to write**

Dispatch one agent per group, using this prompt template (replace `<group contents>` with that group's actual contents from the previous step):

```
You're writing "word-choice cloze" passage content for a Chinese-speaking user's English vocabulary app.

Write 1 passage that naturally strings the following group of words into the same scenario:
<group contents>

Hard requirements:
1. Output a strict JSON object with fields id / title / en / zh — no explanatory text of any kind
2. id: lowercase letters + hyphens, should make it obvious what the passage is about at a glance, e.g. "committee-report"
3. title: one Chinese phrase, e.g. "一票通过的那份报告"
4. en: array of strings, one sentence per element, 4–6 sentences total, 80–120 words total
5. zh: array of strings, one-to-one with en, idiomatic Chinese rather than word-for-word translation
6. Mark target words in en with {{wordId}}; if the sentence uses an inflected form, write {{wordId|surface form}}
   e.g.: {{refute|refuted}}, {{ratify|ratified}}, {{oversight}}
7. Mark each target word only once
8. Use all 7 words

Content requirements:
- A specific, contemporary scenario (workplace, news, city life) with an event and a turn — not a pile-up of word definitions
- Every blank must be decidable from context. If swapping in another word from the same group would still read naturally, rewrite that sentence
- Don't write vague, test-prep-style sentences ("It is important that...")

Output only the JSON object.
```

- [ ] **Step 3: Merge into the content file**

Append each agent's returned object into the `passages` array in `src/data/passages.json`.

- [ ] **Step 4: Validate**

```bash
npm run validate-passages
```

Expected: validation passes and prints the coverage distribution. Every single error must be fixed — **a passage that fails validation does not go into the repo**.

- [ ] **Step 5: Spot-check by hand**

Read 3 passages at random and confirm, one item at a time:

1. Does the sentence clearly stop making sense if each blank is swapped for another word from the same group? (Still reads fine = this blank has two valid answers, and must be rewritten)
2. Is the Chinese translation idiomatic, rather than translationese that follows English word order?
3. Are there any factual errors or awkward collocations?

- [ ] **Step 6: Run through a real round**

```bash
npm run build
```

Start the dev server, go to `/quiz?mode=passage`, and do 5 passages in a row, confirming the passages chosen really do cover the words due that day.

- [ ] **Step 7: Commit**

```bash
git add src/data/passages.json
git commit -m "data: content filled out to N passages"
```

(Replace `N` with the actual passage count.)

---

## Wrap-up

- [ ] `npm run build && npm test` all green
- [ ] `npm run validate-passages` passes
- [ ] Complete a full passage on a real device (mobile browser), confirming the text doesn't overflow at 375px and the candidate words don't wrap awkwardly
- [ ] Look back after a week of use: is the wrong-answer rate for passage questions higher or lower than for single-sentence cloze? If they're about the same, that means this question type isn't adding extra value, and it's worth reconsidering whether to scale it up to the full word list or just stop at pilot scale
