# Architecture Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the eleven "must" and "should" findings of the 2026-09-01 architecture review: a storage ceiling nobody was watching, gates that never ran in CI, and three copies of the word validator.

**Architecture:** Four independent workstreams with disjoint file ownership, run in parallel worktrees and merged into master one at a time. W1 owns `src/state/*`, `src/lib/storage.ts`, `src/lib/github.ts` and the new `src/lib/wordsCache.ts`. W2 owns `src/lib/wordValidate.ts`, `src/pages/AddWord.tsx`, `src/pages/WordEditForm.tsx` and the rule half of `scripts/validate-words.ts`. W3 owns `package.json`, the tsconfigs, `deploy.yml`, `scripts/check-live.ts`, type fixes across `scripts/`, and the two content docs. W4 owns `src/pages/QuizSprint.tsx` and `src/pages/Quiz.tsx`. `CLAUDE.md` and `HANDOFF.md` are edited by the coordinator after the merge.

**Tech Stack:** React 19, TypeScript 6 (strict), Vite 8, vitest 4 + happy-dom, IndexedDB, GitHub Contents API, `gh` CLI, `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-01-architecture-hardening-design.md`

**Ground rules for every task** (from CLAUDE.md, restated so nobody has to open it):

- Code, comments, commit messages in English. Chinese only in UI strings and study content.
- Pure logic in `src/lib/*.ts` with a colocated `*.test.ts`. No component tests; `store.test.tsx` is the one exception and already exists.
- Anything random takes an injected `rng`. Anything time-based takes `now` / `today`.
- Read side lenient: skip the bad record, never throw. Write side strict.
- New fields on synced data are optional. Nothing in this plan adds a synced field.
- Comments explain why and cite the measurement. If you change behaviour a comment's number justified, re-measure and update the number.
- Run the full gate before every commit: `npm test && npx tsc -b && npx oxlint`. Commit small, message leads with the reason.
- Never start the dev server from a shell. Nothing in this plan needs the browser.

---

## Workstream W1: local cache and sync (three commits, in this order)

Owner files: `src/lib/storage.ts`, `src/lib/storage.test.ts`, `src/lib/github.ts`, `src/lib/github.test.ts`, new `src/lib/wordsCache.ts` + test, `src/state/errors.ts` + test, `src/state/session.ts` + test, `src/state/sync.ts` + test, `src/state/store.tsx`, `src/state/store.test.tsx`, `src/main.tsx` (only if the provider signature needs it), one addendum paragraph in `docs/superpowers/specs/2026-08-22-contents-api-size-limits-design.md`.

### Task W1.1: `storage.set` never throws, and the store reports a full device

**Files:**
- Modify: `src/lib/storage.ts:65-67`
- Modify: `src/lib/storage.test.ts`
- Modify: `src/state/errors.ts` (new constant)
- Modify: `src/state/store.tsx` (`commitProgress` at 354-358, `cacheWords` at 183-185, `cacheStaging` at 187-189, `markSettled` at 171-173, `login` at 432-441)
- Modify: `src/state/store.test.tsx`

- [ ] **Step 1: failing tests for `storage.set`**

```ts
// src/lib/storage.test.ts (add)
describe('storage.set never throws', () => {
  it('returns true on a normal write', () => {
    expect(storage.set('dirty', true)).toBe(true)
  })
  it('returns false and swallows a QuotaExceededError from setItem', () => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e
    }
    try {
      expect(storage.set('progress', { big: true })).toBe(false)
    } finally {
      Storage.prototype.setItem = original
    }
  })
})
```

- [ ] **Step 2: run, confirm the second test fails** (`set` currently returns `void` and the throw escapes).

- [ ] **Step 3: implement**

```ts
// src/lib/storage.ts
  /**
   * Returns false instead of throwing when the browser refuses the write.
   * localStorage is the nearest hard ceiling this app has: measured
   * 2026-09-01, the words + progress caches sit at 977,624 UTF-16 code
   * units, about 37% of WebKit's 5 MiB quota, and grow ~1,400 per word. The
   * old `void` signature let a QuotaExceededError escape from inside a click
   * handler, so at the limit every grade was lost before setState ran.
   *
   * Most callers ignore the result on purpose: recency lists, drill markers
   * and the pending-op queues are conveniences whose loss costs a repeat.
   * The store checks it for `progress`, the one write that is data.
   */
  set(key: StorageKey, value: unknown): boolean {
    try {
      localStorage.setItem(KEYS[key], JSON.stringify(value))
      return true
    } catch {
      return false
    }
  },
```

- [ ] **Step 4: constant in `src/state/errors.ts`**

```ts
export const STORAGE_FULL =
  '本机存储空间已满，学习记录暂时只保存在内存里并直接同步到云端；请尽快到设置页导出备份。'
```

- [ ] **Step 5: failing store test**

Using the existing `fakeRemote` / `mount` helpers in `store.test.tsx`, add under a new `describe('storage full', …)`:

- Log in normally so `progress` is cached. Then make `Storage.prototype.setItem` throw a `QuotaExceededError` **only when the key is `volcab.progress`** (let every other key through). Call `grade('w1', 'good')`.
- Assert: `ctx.progress.words.w1` exists in React state (the grade is not lost); `ctx.syncError` equals `STORAGE_FULL`; and after the debounce fires (use the existing timer-advancing pattern in the file) the fake remote received a `progress.json` put whose body contains `w1` (the cloud still got it).
- Then restore `setItem`, `grade('w2','good')`, flush again, and assert `ctx.syncError` is `null` once the write succeeds and the push settles (the flag clears when the device is no longer full).

- [ ] **Step 6: implement in `store.tsx`**

Add `const storageFullRef = useRef(false)` beside the other refs.

```ts
  /** Cleanup after a successful push: settle status, and clear whatever explanation the last failure left behind — unless the device is still full, which a push cannot fix */
  const markSettled = useCallback(() => {
    update({ syncStatus: settleStatus(), syncError: storageFullRef.current ? STORAGE_FULL : null })
  }, [settleStatus, update])
```

```ts
  /** Persist locally + mark dirty + refresh state; push timing (debounced / immediate) is up to the caller */
  const commitProgress = useCallback((progress: Progress) => {
    // The small flag is written before the large payload on purpose:
    // replacing an existing 4-byte value never grows the store, so when the
    // payload write below fails on quota, `dirty` has already landed and
    // flushProgress still pushes the in-memory copy. That ordering is what
    // turns "quota reached" into "this device cannot cache" rather than
    // "this grade never happened".
    if (!demoRef.current) storage.set('dirty', true)
    const persisted = storage.set('progress', progress)
    storageFullRef.current = !persisted
    update({
      progress,
      syncStatus: settleStatus(),
      ...(persisted ? {} : { syncError: STORAGE_FULL }),
    })
  }, [settleStatus, update])
```

`cacheWords` / `cacheStaging`: same shape, set `storageFullRef` and the notice when the write fails. In `login`, the `storage.set('words', …)` / `storage.set('progress', …)` results are checked the same way; a failed cache write must **not** fail the login (the data is in memory and the network copy is authoritative).

- [ ] **Step 7: full gate, commit**

```
fix(store): a full localStorage no longer loses the grade or blocks login

Measured 2026-09-01: words + progress caches are 977,624 UTF-16 code units,
~37% of WebKit's 5 MiB quota, growing ~1,400 per word (~1,900 words). ...
```

### Task W1.2: conditional GET on boot

**Files:**
- Modify: `src/lib/github.ts` (new method after `getFile`)
- Modify: `src/lib/github.test.ts`
- Modify: `src/state/sync.ts:31-34` (`SyncClient`)
- Modify: `src/state/sync.test.ts` and `src/state/store.test.tsx` (fake clients gain the method)
- Modify: `src/state/store.tsx` `boot()` at 509-575

- [ ] **Step 1: failing tests in `github.test.ts`**

Stub `fetch`. Assert that `getFileIfChanged('progress.json', 'abc…40 hex')` sends `If-None-Match: "abc…"` and `Accept: application/vnd.github.raw`; that a 304 response resolves to `'unchanged'`; that a 200 resolves to `{ content, sha }` with the sha taken from the ETag exactly as `getFile` does; that a 404 resolves to `null`; that a 500 throws with `HTTP 500` in the message.

- [ ] **Step 2: implement**

```ts
  /**
   * Same read as getFile, but tells GitHub which blob this device already
   * holds. Measured 2026-09-01 against the live repo: the raw media type
   * honours `If-None-Match: "<blob sha>"` with a 304 and an empty body, the
   * CORS preflight lists If-None-Match in access-control-allow-headers, and
   * GitHub documents that a 304 does not count against the rate limit.
   *
   * A separate method rather than an optional parameter on getFile, so the
   * three conflict paths in sync.ts that re-pull without a sha never see a
   * value they cannot receive.
   */
  async getFileIfChanged(path: string, sha: string): Promise<RemoteFile | null | 'unchanged'> {
    const res = await fetch(`${API}/repos/${this.owner}/${this.repo}/contents/${path}`, {
      headers: { ...this.headers(), Accept: 'application/vnd.github.raw', 'If-None-Match': `"${sha}"` },
      cache: 'no-store',
    })
    if (res.status === 304) return 'unchanged'
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`读取 ${path} 失败 (${statusTag(res)})`)
    const content = await res.text()
    const etagSha = blobShaFromETag(res.headers.get('ETag'))
    return { content, sha: etagSha ?? (await this.getSha(path)) }
  }
```

Refactor so `getFile` and `getFileIfChanged` share one private `read(path, extraHeaders)` rather than duplicating the body.

- [ ] **Step 3: `SyncClient` gains the method; every fake client in the tests implements it** (default behaviour for existing tests: behave like `getFile`, i.e. never return `'unchanged'`).

- [ ] **Step 4: failing store test**

Boot with a complete cache (words in the cache, progress in localStorage, all three shas stored). Script the fake so `getFileIfChanged` returns `'unchanged'` for every path and `getFile` throws if called. Assert: phase becomes `ready`, `ctx.words` is the cached array (same reference or deep-equal), no `parseWords` re-parse is observable (the fake's `getCalls` shows only conditional reads), and `syncStatus` settles to `'synced'`.

Second test: cache present but no `wordsSha` stored (legacy device): assert `getFile` is used for words and `getFileIfChanged` for the other two.

- [ ] **Step 5: implement in `boot()`**

For each of the three files: if this device holds a valid cache for it **and** a stored sha, call `getFileIfChanged(path, sha)`; otherwise `getFile(path)`. `'unchanged'` keeps `stateRef.current.<file>` as is and skips the parse/merge for that file. Everything downstream (pending-op replay, `flush*` calls, error handling) is unchanged. Cite the 304 measurement in the comment.

- [ ] **Step 6: full gate, commit**

```
perf(boot): send If-None-Match and keep the cache on 304

Every cold open re-downloaded ~1.4 MB (words 1,179,748 B + progress
207,275 B, live 2026-09-01) it almost always already had. ...
```

### Task W1.3: words cache moves to IndexedDB

**Files:**
- Create: `src/lib/wordsCache.ts`, `src/lib/wordsCache.test.ts`
- Modify: `src/lib/storage.ts` (remove the `words` key; keep a comment naming the old key for the one-time cleanup)
- Modify: `src/state/session.ts` (`cachedWords` at 32-35 → pure `validWords(raw: unknown)`, `bootSnapshot` at 97-117 no longer reads words)
- Modify: `src/state/session.test.ts`
- Modify: `src/state/store.tsx` (`AppProvider` props, `cacheWords`, `login`, `logout`, `boot`)
- Modify: `src/state/store.test.tsx`
- Modify: `docs/superpowers/specs/2026-08-22-contents-api-size-limits-design.md` (one addendum paragraph at the end pointing at the 2026-09-01 spec §1)

- [ ] **Step 1: the interface and the memory implementation, test-first**

```ts
// src/lib/wordsCache.ts
import type { Word } from '../types'

/** The only async cache in the app. See the 2026-09-01 architecture-hardening spec §1b for why words left localStorage. */
export interface WordsCache {
  /** Whatever was stored, unvalidated; the caller runs isWord over it (read side lenient). null when empty. */
  read(): Promise<unknown>
  /** Resolves false when the browser refused the write; the caller treats that as "no cache", never as an error. */
  write(words: Word[]): Promise<boolean>
  clear(): Promise<void>
}

export function createMemoryWordsCache(initial: unknown = null): WordsCache { … }

/** IndexedDB-backed; falls back to createMemoryWordsCache when indexedDB is undefined or open() rejects. */
export function createIndexedDbWordsCache(dbName = 'volcab', storeName = 'kv', key = 'words'): WordsCache { … }

export const wordsCache: WordsCache = createIndexedDbWordsCache()
```

Tests for the memory cache: read of empty → null; write then read → same value; clear → null; `write` resolves true. Tests for the IDB factory in happy-dom (no `indexedDB` global): it must behave as the memory cache and never throw; assert `read()` after `write()` round-trips, proving the fallback engaged.

- [ ] **Step 2: `session.ts`**

`cachedWords()` becomes `export function validWords(raw: unknown): Word[] | null` with the same predicate (`Array.isArray && length > 0 && every(isWord)`). `bootSnapshot` returns `phase: 'boot'` whenever a token and owner exist (words are unknown until the async read); the `words && progress → 'ready'` branch is deleted. Update `session.test.ts` accordingly and add a test for `validWords`.

- [ ] **Step 3: `store.tsx`**

- `AppProvider({ children, wordsCache: cache = wordsCache })`.
- `cacheWords`: `if (!demoRef.current) void cache.write(words)`. No notice on failure: after this change a lost words cache costs one network fetch, and the network copy is authoritative.
- `login`: `await cache.write(words)` in place of `storage.set('words', …)`.
- `logout`: `storage.clearAll()` plus `void cache.clear()`.
- `boot()`: first step, before any network call:

```ts
    // Words live in IndexedDB now, so the first frame cannot know them. Read
    // the cache, and if it plus the localStorage progress make a complete
    // device, go ready immediately from cache exactly as bootSnapshot used
    // to; the network round below then refreshes as before.
    const cachedRaw = await cache.read()
    if (session !== sessionRef.current) return
    const cached = validWords(cachedRaw)
    const progressCached = cachedProgress()
    if (cached && progressCached && stateRef.current.phase === 'boot') {
      update({ phase: 'ready', owner, words: cached, progress: progressCached, staging: cachedStaging() ?? [] })
    }
    // One-time cleanup of the pre-IndexedDB cache key so the quota is actually reclaimed.
    localStorage.removeItem('volcab.words')
```

  The conditional-GET decision from W1.2 for words now keys on `cached !== null` plus a stored `wordsSha`.

- `enterDemoMode` is unchanged (it never cached words).

- [ ] **Step 4: `store.test.tsx`**

Every test that seeded `storage.set('words', …)` to simulate a cached device now passes `wordsCache={createMemoryWordsCache(words)}` to the provider (extend the existing `mount` helper with an optional cache). Add: boot from cache reaches `ready` before the network resolves (hold the fake's `getFile`, assert phase, then release); logout clears the cache (`read()` → null); login writes it.

- [ ] **Step 5: `storage.ts`**

Remove `words: 'volcab.words'` from `KEYS`. Add a comment above `KEYS` naming the retired key and the boot-time `removeItem`.

- [ ] **Step 6: spec addendum, full gate, commit**

```
feat(cache): move the words cache to IndexedDB; localStorage keeps progress only

The words cache was 840,626 of the 977,624 UTF-16 code units in
localStorage (86%). ... Boot now shows the existing Booting gate until the
IndexedDB read resolves instead of being ready on the first frame; ...
```

---

## Workstream W2: one word validator (one or two commits)

Owner files: new `src/lib/wordValidate.ts` + test, new `src/pages/wordIssueText.ts` (Chinese message map; no test needed, it is a lookup table, but a test that the map is exhaustive is cheap and welcome), `src/pages/AddWord.tsx`, `src/pages/WordEditForm.tsx`, `scripts/validate-words.ts` (the per-word rule section only; leave the file-level checks and the reporting shape alone so W3's type fixes merge cleanly).

### Task W2.1: extract the rules

**Files:** as above.

- [ ] **Step 1: read all three validators and tabulate**

Read `src/pages/AddWord.tsx:234-312` (`validate`), `src/pages/WordEditForm.tsx:120-210` (`handleSubmit`, note the drift comment at 166-172), and `scripts/validate-words.ts` end to end. Also `src/lib/senseShare.ts`, `src/lib/etymology.ts`, `src/lib/heteronym.ts` — these are already shared and stay where they are; the new module calls them. Produce, in the new module's header comment, a table of every rule with which of the three enforced it before. Where they disagree, take the strictest and say so.

- [ ] **Step 2: failing tests for `validateWordDraft`**

```ts
// src/lib/wordValidate.ts (shape; fill the codes from your table)
export type WordField = 'headword' | 'phonetic' | 'meanings' | 'examples' | 'relatedForms' | 'usageScore' | 'share' | 'etymology' | 'id' | 'addedAt'
export type WordIssueCode =
  | 'headword.empty'
  | 'phonetic.notSlashed'
  | 'meanings.empty'
  | 'meanings.incomplete'
  | 'examples.tooFew'
  | 'relatedForms.partial'
  | 'usageScore.missing'
  | 'usageScore.range'
  | 'share.invalid'
  | 'etymology.tooLong'
  | 'heteronym.phoneticRequired'
  // …exactly the rules your table lists, no more
export interface WordIssue { field: WordField; code: WordIssueCode; detail?: string }
/** A Word or a form draft; every field optional so the forms can call it before the user is done. */
export type WordDraft = Partial<Word>
export function validateWordDraft(draft: WordDraft): WordIssue[]
```

One test per code (positive and negative), plus a test that a fully valid entry from `data/words.json` produces `[]`, and a full-library regression: every word in `data/words.json` validates to `[]` (the same pattern `headword.test.ts:83` uses; it is the write gate's own invariant).

- [ ] **Step 3: implement, run tests to green.**

- [ ] **Step 4: message maps**

```ts
// src/pages/wordIssueText.ts
import type { WordIssueCode } from '../lib/wordValidate'
export const WORD_ISSUE_TEXT: Record<WordIssueCode, string> = { … Chinese, one per code … }
```

```ts
// scripts/validate-words.ts
const ISSUE_TEXT: Record<WordIssueCode, string> = { … English, one per code … }
```

The `Record<WordIssueCode, string>` type is the exhaustiveness check.

- [ ] **Step 5: wire the forms**

`AddWord.validate` and `WordEditForm.handleSubmit` call `validateWordDraft`, group the issues by `field`, and map through `WORD_ISSUE_TEXT` into the existing `fieldErrors` shapes. Rules about form state (a required field the user has not typed into) may stay in the form if they are not properties of a `Word`; say which ones in a comment. Delete the two hand-written rule blocks.

- [ ] **Step 6: wire the script**

`validate-words.ts` calls `validateWordDraft` for every entry and prints `${id}: ${ISSUE_TEXT[code]}` lines; keep its existing duplicate-id and version checks and its existing output/exit shape. Run `npm run validate-words` and confirm it still passes on `data/words.json`.

- [ ] **Step 7: full gate, commit**

```
refactor(words): one validator for the add form, the edit form and the script

WordEditForm.tsx:166 recorded that the two forms had already drifted; the
script was a third description. ... Rules where the three disagreed and the
strict reading chosen: ...
```

---

## Workstream W3: tooling, CI, live-diff (three commits)

Owner files: `package.json`, `tsconfig.json`, new `tsconfig.scripts.json`, `.github/workflows/deploy.yml`, new `scripts/check-live.ts`, any `scripts/*.ts` that fails the new type check, `docs/word-add-checklist.md`, `.claude/skills/word-content/SKILL.md`.

### Task W3.1: `scripts/` under `tsc -b`

- [ ] **Step 1: create `tsconfig.scripts.json`**

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.scripts.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "types": ["node"]
  },
  "include": ["scripts/**/*.ts"],
  "exclude": ["scripts/out"]
}
```

Add `{ "path": "./tsconfig.scripts.json" }` to the `references` in `tsconfig.json`.

- [ ] **Step 2: run `npx tsc -b`, fix every error minimally.** Expect untyped JSON casts and `process.argv` indexing. Do not restructure scripts; W2 is editing `validate-words.ts` in parallel, so keep changes there to type annotations only. `scripts/parse-enex.test.ts` imports vitest; if `types: ["node"]` alone does not resolve it, add `"vitest/globals"` is **not** the answer (the file imports explicitly); check that `moduleResolution: bundler` finds the package.

- [ ] **Step 3: full gate, commit**

```
build(scripts): type-check scripts/ under tsc -b

Ten scripts import functions from src/lib and were checked by nothing; tsx
strips types without reading them. ...
```

### Task W3.2: `npm run validate`, `npm run lint`, CI

- [ ] **Step 1: `package.json`**

```json
    "lint": "oxlint",
    "validate": "npm run validate-words && npm run validate-passages && npm run validate-suggestions && npm run validate-contrast-notes && npm run validate-word-notes && npm run validate-sense-groups && npm run validate-recall-sentences && npm run validate-sentence-chunks",
```

Run `npm run validate` locally first. If any of the eight is red on the current `data/` and `src/data/`, **stop and report** which; do not fix content in this workstream.

- [ ] **Step 2: `deploy.yml`**

After `- run: npm test` add `- run: npm run lint` and `- run: npm run validate`. Update the Chinese header comment's summary line (it lists what the workflow runs) to include them; that comment is documentation of the workflow, keep it in the language it is in.

- [ ] **Step 3: docs**

`docs/word-add-checklist.md:184-185` and `:466-467` say none of the validators run in CI, and `:184` says there are five. Correct both. `.claude/skills/word-content/SKILL.md:25-27` says the same; correct it.

- [ ] **Step 4: commit**

```
ci: run oxlint and all eight content validators on every push

CLAUDE.md calls the validate-* scripts the strict half of "write side
strict, read side lenient"; deploy.yml ran neither them nor the linter. ...
```

### Task W3.3: `scripts/check-live.ts`

- [ ] **Step 1: write the script**

```ts
// scripts/check-live.ts
/**
 * Diffs data/words.json against the live volcab-data copy.
 *
 * Six of the 29 commits to data/words.json (f53adb9, 74b2cf5, 00dd875,
 * bf74fc9, cce0a48, 2710d51) repair the same drift: words the user deleted
 * in-app survived in the repo copy, and every content validator called them
 * valid because they all read the repo copy as ground truth. Each was found
 * by a person diffing by eye. This is that diff as one command.
 *
 * Reads through the authenticated gh CLI (the same call HANDOFF documents by
 * hand), so it never runs in CI and needs no PAT in a secret.
 *
 *   npx tsx scripts/check-live.ts            report, exit 1 on any difference
 *   npx tsx scripts/check-live.ts --write    overwrite data/words.json with the live file
 *   npx tsx scripts/check-live.ts --repo owner/name
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
```

Behaviour: `gh api -H "Accept: application/vnd.github.raw" repos/<repo>/contents/words.json` via `execFileSync('gh', [...])` (never a shell string); parse both; report `only live: [ids]`, `only repo: [ids]`, `differ: N entries (first 10 ids)`; exit 1 on any; `--write` serializes the live file exactly as `src/state/sync.ts` `serializeWords` does (`JSON.stringify({ version: 1, words }, null, 2) + '\n'`) — import that function rather than re-implementing it. Default repo `steveao886/volcab-data`. If `gh` is missing or unauthenticated, print its stderr and exit 2.

- [ ] **Step 2: `package.json`**: `"check-live": "tsx scripts/check-live.ts"`.

- [ ] **Step 3: run it.** Expected today: `0 only live, 0 only repo` (measured 717 = 717 on 2026-09-01); report whether entry contents differ.

- [ ] **Step 4: docs**: replace the hand-written `gh api … > /tmp/live.json` step in `docs/word-add-checklist.md:346-349` and `.claude/skills/word-content/SKILL.md:52-55` with `npm run check-live` (and `-- --write` for the realignment).

- [ ] **Step 5: commit**

```
tools(check-live): diff the repo word list against the live one in one command
```

---

## Workstream W4: two UI fixes (two commits)

Owner files: `src/pages/QuizSprint.tsx`, `src/pages/Quiz.tsx`, `src/pages/Quiz.css` only if a new class is needed.

### Task W4.1: the sprint prints a text tag beside the colour

**Files:** `src/pages/QuizSprint.tsx:226-249`

- [ ] **Step 1: replace the option loop body**

The rule is in CLAUDE.md: correctness must never be conveyed by colour alone. `QuizQuestion.tsx:408-413` already does it; copy that shape. Replace lines 242-245 (the inner `<span>` block inside `<Button>`) with:

```tsx
                  <span>
                    <span className="quiz-option__key">{i + 1}</span>
                    {opt}
                  </span>
                  {/* The tag, not the colour, is what says which one was right:
                      the 350 ms flash is exactly when a colourblind reader has
                      nothing else to go on. Same markup as QuizQuestion. */}
                  {chosen !== null && opt === q.answer ? (
                    <span className="quiz-option__tag">正确答案</span>
                  ) : null}
                  {chosen !== null && opt === chosen && opt !== q.answer ? (
                    <span className="quiz-option__tag">你的选择</span>
                  ) : null}
```

`.quiz-option__tag` already exists in `src/pages/Quiz.css:80`; no CSS change.

- [ ] **Step 2: `npx tsc -b && npx oxlint && npm test`, commit**

```
fix(sprint): print 正确答案 / 你的选择 on the flashed option

The sprint was the one surface conveying right and wrong by colour alone
(CLAUDE.md design rule). Same markup QuizQuestion.tsx:408 uses.
```

### Task W4.2: lazy content loads get a failure branch and a retry

**Files:** `src/pages/Quiz.tsx:340-395` (the four effects) and `:406-446` (the three loading cards)

- [ ] **Step 1: add one hook at module level in `Quiz.tsx`, above `QuizSessionPage`**

```tsx
/**
 * Loads one bundled-content chunk on demand. Replaces four copies of the
 * same effect, and adds the branch they all lacked: a rejected import()
 * used to leave the page on 正在加载 forever, because the guard was
 * `x !== null` and nothing ever set x. Now a failure renders a retry.
 *
 * `enabled` is the mode check; the chunk is never fetched for a mode that
 * does not use it (see the comment on the passages loader for why).
 */
function useLazyContent<T>(enabled: boolean, load: () => Promise<T>): { data: T | null; failed: boolean; retry: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled || data !== null) return
    let alive = true
    setFailed(false)
    load().then(
      v => { if (alive) setData(v) },
      () => { if (alive) setFailed(true) },
    )
    return () => { alive = false }
  }, [enabled, data, attempt, load])
  const retry = useCallback(() => setAttempt(a => a + 1), [])
  return { data, failed, retry }
}
```

`load` must be a stable function: define the four loaders as module-level constants, e.g.

```tsx
const loadPassages = () => import('../data/passages.json').then(m => (m.default as { passages: Passage[] }).passages)
const loadGroups = () => import('../data/senseGroups.json').then(m => (m.default as { groups: SenseGroup[] }).groups)
const loadSentences = () => import('../data/recallSentences.json').then(m => (m.default as { sentences: RecallSentence[] }).sentences)
const loadAnnotations = () => import('../data/sentenceChunks.json').then(m => (m.default as { chunks: ChunkAnnotation[] }).chunks)
```

- [ ] **Step 2: replace the four `useState` + `useEffect` pairs** with

```tsx
  const passages = useLazyContent(mode === 'passage', loadPassages)
  const groups = useLazyContent(mode === 'recall' || mode === 'compose', loadGroups)
  const sentences = useLazyContent(mode === 'recall' || mode === 'compose', loadSentences)
  const annotations = useLazyContent(mode === 'compose', loadAnnotations)
```

Keep the existing explanatory comments (why each is its own chunk) attached to the corresponding loader constant.

- [ ] **Step 3: one loading/failure card**

```tsx
function ContentGate({ label, failed, retry }: { label: string; failed: boolean; retry: () => void }) {
  return (
    <Card className="quiz-empty">
      {failed ? (
        <>
          <p className="muted">{label}加载失败，请检查网络后重试。</p>
          <Button type="button" variant="secondary" onClick={retry}>重试</Button>
        </>
      ) : (
        <p className="muted">正在加载{label}…</p>
      )}
    </Card>
  )
}
```

In the render, each `x === null ? <Card …>正在加载…</Card> : <Session …>` becomes: if any needed `.data` is null, render `<ContentGate label="题组" failed={groups.failed || sentences.failed} retry={() => { groups.retry(); sentences.retry() }} />` (labels: 题组 for recall, 句子 for compose, 短文 for passage, matching today's copy), else the session with `.data` passed where the raw state was passed before.

- [ ] **Step 4: `npx tsc -b && npx oxlint && npm test`, commit**

```
fix(quiz): a failed content chunk shows 重试 instead of loading forever

The four import() effects guarded on `x !== null` and had no rejection
branch. One hook replaces the four copies.
```

---

## Coordinator tasks (after all four merge)

- [ ] Merge order: W4, W3, W2, W1 (smallest blast radius first; W1 touches the most tests). Resolve conflicts in `scripts/validate-words.ts` (W2 rules vs W3 types) by keeping both.
- [ ] Full gate on master: `npm test && npm run build && npm run lint && npm run validate && npm run check-live`.
- [ ] `CLAUDE.md`: commands table gains `lint`, `validate`, `check-live`; the `words.json is 989 KB` paragraph gets the localStorage finding and the IndexedDB move; the `data/words.json … diverged` paragraph points at `check-live`.
- [ ] `HANDOFF.md`: a dated section with what this round measured (the quota numbers, the 304 test, the strict result) and the lesson: **the nearest ceiling is the one nobody measured**; a size analysis that names one limit is not finished until it names the next one too.
- [ ] Measure on the phone: with the app open, run in the console the same fill-until-throw probe used in the review, and write the real quota into the spec §1 table.
