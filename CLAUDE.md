# CLAUDE.md

Guidance for working in this repository.

## Hard rules

Each of these has cost something once. The reason is in the section named.

- **Never start the dev server with a shell command.** Use `preview_start` with the `volcab-dev` config. (Commands)
- **Never overwrite the live `volcab-data` copy with the repo copy.** Apply a bulk edit on top of a fresh pull of live. (Architecture)
- **A direct write to `progress.json` bumps `lastReviewedAt` by a full second**, or the browser's cached copy reverts it. (Architecture)
- **Never play a scenario on the user's live library.** Use 演示模式 with seeded progress. (`.claude/rules/ui.md`)
- **Practice never writes `ease`, `lapses`, `state` or `lastReviewedAt`, and nothing pulls `due` forward while leaving `intervalDays` alone.** (SRS)
- **UI strings and study content stay Chinese; code, comments, docs and commit messages are English.** (Language policy)
- **Never `git add Volcab.enex`, and commit only under the GitHub noreply address.** This repo is public. (Gotchas)
- **Don't start the next phase on your own initiative.** The user pauses between phases. (Working with the user)

## Where the rest lives

This file holds what every session needs. Three areas have their own file under `.claude/rules/`, loaded only when a matching file is opened:

| File | Loads on | Holds |
|---|---|---|
| `.claude/rules/srs.md` | `src/lib/srs.ts`, `queue.ts`, `src/state/**`, the review, quiz, practice and 今日 pages, `src/types.ts` | every way a surface may write to the schedule, the day limits, the interval ceiling, and the measurement behind each constant |
| `.claude/rules/content.md` | `data/**`, `src/data/**`, `scripts/**`, the content libs | the content rules, and how to delegate bulk drafting to a second model |
| `.claude/rules/ui.md` | any `.css`, `src/pages/**`, `src/components/**` | the 朱批 design language and the browser-debugging gotchas |

**If a task touches one of these areas and its file has not appeared in context, read it by hand before changing anything.** A path-scoped rule that never loaded gives no warning.

Comments and specs written before 2026-11-13 cite "CLAUDE.md" for rules that now live in those files. The split moved text and changed no rule.

## What this is

A personal English-vocabulary app for one Chinese-speaking learner. React 19 + TypeScript + Vite, shipped as a PWA to GitHub Pages under the base path `/volcab-app/`. There is no server: the app talks directly to a private GitHub repo (`volcab-data`) through the Contents API using a fine-grained PAT the user pastes at login.

Core loops: spaced-repetition review (`/review`), quizzes in several modes (`/quiz` — mixed, contrast, audio, 60-second sprint, passage cloze), a word library, and a capture-then-enrich flow for adding new words.

## Commands

| | |
|---|---|
| `npm test` | vitest, single run |
| `npx vitest run src/lib/foo.test.ts` | one file |
| `npm run build` | `tsc -b && vite build` — run this, not `tsc` alone (`-b` also type-checks `scripts/`) |
| `npm run lint` | oxlint; runs in CI |
| `npm run validate` | all eleven `validate-*` content gates in one go; runs in CI |
| `npm run validate-words` | gate for `data/words.json`; the per-word rules live in `src/lib/wordValidate.ts`, shared with both entry forms |
| `npm run check-live` | diff `data/words.json` against the live `volcab-data` copy through `gh`; `-- --write` realigns the repo copy |
| `npm run synonym-todo` | the next 近义词 groups the page will show that lack a current paragraph in `src/data/synonymNotes.json`, in page order, from live progress through `gh`; `-- --limit N` (default 30). The content round's to-do list; never in CI |
| `npm run check-synonyms` | ask Jev, for each contrast pair joined only by a shared synonym, whether the synonym reads two ways; prints suspicious pairs grouped by synonym. `-- --ids a,b` for a batch. Same key, never in CI. Shared plumbing lives in `scripts/jev.ts` |
| `npm run check-links` | the other direction: same-POS pairs sharing a Chinese gloss term that nothing joins, each with Jev's guess at whether a quiz would have to accept both. `-- --ids a,b` for a batch, `-- --no-jev` without a key |
| `npm run check-senses` | ask Jev which sense each 回想 rendering's example uses and print where it disagrees with the `sense` tag, or agrees unsurely; `-- --ids a,b` for a batch. Needs `TYPESAFE_API_KEY` in `.env.local` (gitignored), so never in CI |

**Never start the dev server with a shell command.** Use the browser preview tooling (`preview_start` with the `volcab-dev` config in `.claude/launch.json`), then drive and verify the page with the same toolset.

### Reaching a Gemini model

The standalone `gemini` CLI is **dead on this account** and will stay dead —
`IneligibleTierError` / `reasonCode UNSUPPORTED_CLIENT` against `tierId
free-tier`. It is the *client* that is refused, not the account: the same OAuth
token in `~/.gemini/oauth_creds.json` refreshes fine and Antigravity
authenticates with it seconds later. Don't debug it, and don't conclude Gemini
is unreachable.

The working path is `node ~/repos/antigravity-run.js "<prompt>"` (setup notes in
`~/repos/antigravity-setup.md`), which drives the local Antigravity agent
headlessly; volcab is already a registered project. `--wait-file <path>` for
file handoff, `--quiet <sec>` for Q&A.

**Models: pass no `--model` for ordinary jobs (= `standard`), or `--model
writing` for writing jobs.** `~/repos/antigravity-run.js` is only a shim; the
real runner is the shared `~/repos/antigravity-runner`, and which concrete model
each alias maps to lives only in its `models.json` — don't copy model ids into
this file (`node ~/repos/antigravity-run.js --models` shows the current mapping).
When the runner switches models, the first call from this repo prints what
changed and lists any lines here that still name the old model. The old tiers
`flash` / `pro` are auto-mapped to `standard` with a warning; a pinned model
that doesn't show up in the conversation record exits 3 rather than letting a
job be served by a different model.

What to hand a second model, and what to keep, is in `.claude/rules/content.md`.

## Language policy

**Code, comments, documentation, and commit messages are English.** This is an English-language codebase.

**Chinese stays in exactly two places, and both are the product, not commentary:**

1. **UI strings** — every label, button, `aria-label`, and sentence rendered on screen. The user of this app is a Chinese speaker; the interface is Chinese by design (`index.html` is `lang="zh-CN"`, and so is the PWA manifest).
2. **Study content** — `meanings[].zh` in the word data, and the `zh` translation array plus `title` in `src/data/passages.json`.

When editing a file that mixes them, translate the comment and leave the string literal alone. A mistranslated comment is cosmetic; a translated UI string is a product bug.

## Architecture

### Data lives in three synced files

`volcab-data` holds `words.json`, `progress.json`, and `staging.json`. `src/state/sync.ts` owns reading and writing them; `src/state/store.tsx` orchestrates when.

Everything under `src/state/` that touches sync is **data-safety logic, not wiring** — per-path mutexes, catch-up flags, session-invalidation checks, and reconciling a server response against local state *at the moment it returns*. `store.test.tsx` is the one file in the repo allowed to have component tests, and its header explains why. Read that header before changing anything there.

`words.json` is **3.01 MiB** (2026-11-13, 1,825 words, ~1,728 bytes each). **It crossed 1 MiB somewhere around word 640 and nothing happened, exactly as predicted — so don't re-panic about it**: 1 MiB governs only whether the JSON media type returns `content`, and `getFile` asks for `application/vnd.github.raw` (100 MB). The write path is not capped there either — a 40 MB file writes fine, ~21,000 words away. **Still do not add bulk to it**: GitHub's ceiling is between 40 MB and 46 MB, GitHub documents no write limit at all, and above it `putFile` gets a 422 that used to be indistinguishable from a merge conflict. See `docs/superpowers/specs/2026-08-22-contents-api-size-limits-design.md`.

**The nearer ceiling was localStorage, and nobody had measured it** until 2026-09-01: the words and progress caches sat at 977,624 UTF-16 code units, about 37% of WebKit's 5 MiB quota, roughly 1,900 words away at that month's pace. The words cache now lives in IndexedDB (`src/lib/wordsCache.ts`, async, falls back to memory when IndexedDB is unavailable); progress stays in localStorage and reaches the same quota around 12,000 words. That estimate has been optimistic since the forget log and tangles arrived (2026-10-21), because both grow progress by the lapse rather than by the word and nothing prunes either: at the live library's 5.85 lapses a day, forget records add about 284K UTF-16 units a year (10.8% of the quota) and tangles up to 574K more (21.9%) if every lapse names a new partner — see `Progress.tangles` in `src/types.ts`. `storage.set` returns `false` instead of throwing, and the store reports `STORAGE_FULL` through `syncError`. Boot reads each synced file with `If-None-Match` when it holds both a cache and a sha, and a 304 keeps the local copy. See `docs/superpowers/specs/2026-09-01-architecture-hardening-design.md`.

### Bundled content is not synced data

`src/data/passages.json` ships inside the app bundle. It is read-only content the user never edits, so it does not belong in the sync schema and its types live in `src/lib/passage.ts`, deliberately not in `src/types.ts`. `src/types.ts` is the *synced* data model.

`data/words.json` and `data/wordlist.json` at the repo root are copies used by the scripts. **They have diverged from the live library before**: six of the first 29 commits to `data/words.json` were repairs of drift found by eye (`f53adb9` was the first). `npm run check-live` is that diff as one command; run it before any content work. The live library is authoritative; code that reads a word by id must tolerate the id not existing.

**Apply a bulk edit on top of the live copy — never overwrite live with the repo copy.** The user deletes words in the app, and those deletions only ever land in `volcab-data`. Pushing the repo copy over it resurrects them. This is a documented failure condition that really did trigger once.

**A direct write to `progress.json` must bump `lastReviewedAt` by a full second, or it will not survive.** `mergeProgress(local, remote)` keeps the local entry when `le.lastReviewedAt >= re.lastReviewedAt` — local wins ties — and it runs local-first on both the boot path (`store.tsx`) and the push-conflict path (`sync.ts`). Repair the remote without moving the timestamp and the browser's cached copy out-ranks it and reverts your fix on next open. A whole second, not a millisecond: ISO strings compare as strings, and +1ms can land entirely in the fractional part, which compares backwards against a timestamp that has none. The calendar day is unchanged, so `buildLapseQueue`'s "already dealt with today" reading is unaffected.

**`gh` can read the private data repo**, so "ask the user to export a backup" is almost never the right move:

    gh api -H "Accept: application/vnd.github.raw"       repos/steveao886/volcab-data/contents/progress.json

### Routing

`HashRouter` — GitHub Pages has no server-side rewrite. Sub-modes go through a `?mode=` query param (`/quiz?mode=sprint`, `/review?mode=lapses`) and switch with `replace: true`, so the system back gesture leaves the page instead of walking backwards through modes.

### SRS

`src/lib/srs.ts` is the scheduler, and it owns the schedule; `src/lib/queue.ts` builds the day. **The mechanism and the measurement behind each constant are in `.claude/rules/srs.md`. Read it before changing what any surface writes to progress.** What holds everywhere:

- **A practice miss stamps `missedAt` and nothing more.** `ease`, `lapses`, `state` and `lastReviewedAt` are the scheduler's alone.
- **A quiz miss halves `intervalDays` and never does anything else** (`demoteWord`): review-phase words only, at most once per word per day (`demotedOn`), with `due` only ever moving toward now. The 60-second sprint, the drills, free practice and untangling never demote.
- **想不出 on a turned-over review card halves the interval too, and is not a lapse** (`gradeUnproduced`). It shares `demotedOn` with the quiz demotion and cannot be `demoteWord`.
- **Never pull `due` forward while leaving `intervalDays` alone.** `gradeWord` computes `next = intervalDays * ease` knowing nothing about elapsed time. That was a real bug (`71fba29`).
- **A scheduled review is the only thing that clears `missedAt` and empties 顽固词.** Playing the pool cannot move its own count.
- **The manual 回想 rating (`recallRating`) reaches nothing in `srs.ts`.**
- **The day's limits live in `queue.ts`.** A review carried over from an earlier day takes a new word's place, one for one. A day serves at most `reviewCap` review-phase words (default 88, the user's is 120), and a day that holds any back learns no new words. The counter is `DailyStat.reviewWords`, not `reviewPhase`.
- **No interval is longer than `MAX_INTERVAL_DAYS`** (21, which is also `MATURE_INTERVAL_DAYS`) unless 设置's 最长间隔 says so. A word at the ceiling lands on exactly 21, and `intervalModifier` is the wrong lever for retention.
- **The review log exists: it is the data repo's commit history.** Commits to `progress.json`, diffed pair by pair on `lastReviewedAt`, give every grade. Check a reconstruction against the app's own counters, and back-test a simulator on the last 30 real days before reading its forecast.

## Content rules

`docs/word-entry-spec.md` is authoritative for the shape of an entry, the `word-content` skill is the procedure, and `.claude/rules/content.md` has the rules with their evidence. The ones that cost most to rediscover:

- **Five example sentences per word, always**, each carrying a concrete scene. Textbook-flat filler is the one thing the user reliably rejects.
- **Render only the sense `meanings[0]` describes.** The cloze hint is `meanings[0].en` and nothing else, and 578 of 1,825 words have a second sense (2026-11-13).
- **A synonym or an antonym hangs off a word, not off a sense.** One homograph joins unrelated words into contrast pairs and 发散 answer sets. Check the concept a synonym anchors before cutting it, and don't write a headword into `synonyms` just to make it appear on a card.
- **A 发散 prompt is the members' intersection, never their union.**
- **Don't fill a blank `etymology` just to reach 100%.** Folk etymology is worse than a blank.
- **Don't loosen the stemming in `src/lib/headword.ts`.** Loosening it makes the `mire` stem match **mirth**.
- **Store indices into content, not copies of it.**
- **When drafting is delegated**, the second model drafts English prose, the validator gates structure, and you read the Chinese line by line and every distractor pool.

## Conventions

**Comments explain why, and cite evidence.** This codebase's comments are unusually load-bearing: they name the specific bug a decision prevents, and they quote real measurements over the word library ("across 476 words / 1251 marked occurrences: zero losses, zero false hits"). A comment that restates the code is noise. If you change behavior that a measurement justified, **re-measure and update the number** — a stale number is worse than none.

**Tests:**
- Pure logic goes in `src/lib/*.ts` with a colocated `*.test.ts`.
- **UI gets no component tests.** Push the logic worth testing down into `src/lib/` and leave the render layer thin enough not to need them. `store.tsx` is the single authorized exception.
- Anything random takes an injected `rng: () => number` defaulting to `Math.random`, so tests are deterministic. Never call `Math.random` inside a function body.

**Write side strict, read side lenient.** The `scripts/validate-*.ts` gates are where quality is enforced — malformed data must not reach the repo. The runtime does the opposite: skip the bad record, never throw, never white-screen. Both halves are required; neither substitutes for the other.

**New fields on synced data are optional.** Another device running an older build will push data without them. A required field means either a failed schema check or a forced migration. See the comments on `Meaning.share` and `settings.updatedAt`.

**Prefer failing closed over guessing.** When input is malformed or a word can't be located, skip it. Shipping a cloze question with no blank, or an etymology someone invented, is worse than shipping nothing.

## UI

Mobile-first; **375px is the design width** and layouts must not overflow it. The look is **朱批** (`src/styles/tokens.css`): the marks a Chinese reader makes in a book, on 月白 paper in 墨 ink. `.claude/rules/ui.md` has the vocabulary, the browser-debugging gotchas and the evidence. What holds everywhere:

- **Cinnabar (`--accent`) is for marks only**, never a heading color or a decorative fill, and every `var(--accent)` in a stylesheet carries a `/* mark: … */` comment. Correct is 石青 blue, not green.
- **Pages are built from the vocabulary in `components.css`, not from cards.**
- **UI text is Chinese punctuation**: no ` · ` joins, and full-width marks beside a CJK character.
- **Correctness is never conveyed by color alone**, and a keyboard shortcut is printed on the control it triggers.
- **Screenshot any new screen at 375px before calling it done**, with `mcp__chrome-devtools__take_screenshot` and not the Browser pane's. No other check in this repo looks at layout.
- **Play the thing, with a wrong answer**, in 演示模式 and never on the live library.
- **Handling a key on keydown and moving focus in the same handler is the dangerous combination.** `mcp__Claude_Browser__computer` cannot activate a button by keyboard at all, so it can neither show nor rule out that bug; `mcp__chrome-devtools__press_key` can.

## Gotchas

- **vitest excludes `.claude/worktrees/`** (see `vite.config.ts`). Background tasks check out the whole repo there; without the exclusion the suite runs twice and another branch's failures are attributed to yours.
- `tsconfig.app.json` enables `strict` (measured clean on 2026-09-01) but **not** `noUncheckedIndexedAccess` (503 errors on the same day). Indexed access is typed as present; guard it by hand.
- `noUnusedLocals` is on: an unused import fails the build, including a type-only one.
- Chinese full-width punctuation inside a PowerShell here-string is fine, but double quotes in a commit message body will break `git commit -m @'...'@`.
- **`Volcab.enex` is a personal note file and this repo is public.** It is gitignored and has never been tracked. Never `git add` it.
- **A commit id that does not resolve is probably from before 2026-11-13.** Six commits carried a personal email address in this public repo, so the 197 commits from 2026-09-12 on were rewritten that day (same trees, dates and messages; only the identity changed) and force-pushed. The ids cited in tracked files were updated; 11 commit messages on master still cite the old ones. Match by date and subject. Commit only under the GitHub noreply address: `git config user.email` must not print a real mailbox.
- **happy-dom's `Storage` is a Proxy that caches bound methods.** A `Storage.prototype.setItem` patch made after any write is inert, and a plain instance assignment is swallowed by the proxy's `set` trap. Patch with `Object.defineProperty` on the instance (see `refuseWrites` in `store.test.tsx`).

### Worktrees

- **A worktree is often checked out from a stale base** — this has bitten twice, once four commits behind and missing `strict`. Run `git merge master --no-edit` before the first commit, and point agents at absolute paths in the main checkout for any doc committed in the same session.
- Worktrees inside the repo run the root's toolchain; `npx vitest/oxlint/tsc` resolve by walking up to the root `node_modules`, so no `npm install` is needed.
- **Cherry-pick, don't merge, when bringing a branch back.** If the branch merged master in, a merge back puts merge commits in a history that has none. `git cherry-pick $(git rev-list --no-merges --reverse master..<branch>)` stays linear, and is conflict-free when file ownership was disjoint by plan.

## Working with the user

- The user pauses between phases. **Don't start the next phase on your own initiative.**
- Measure the content before designing the interaction it has to carry. Two of three proposed 组句 input forms were ruled out by measuring the corpus (19 tokens at the median) before anything was designed.
- **Write failure conditions into the spec.** "Overwrite the word list directly — invalid if the user has already modified the list in-app" meant that when a push was later rejected, no judgment call was needed, just a check of whether that condition had triggered. A written-down failure condition beats any amount of careful caution.
- **A size analysis that names one limit is not finished until it names the next one.** The 08-22 spec established GitHub's 40 MB write ceiling and called it "the real ceiling"; localStorage was sitting at 37% of quota, about 1,900 words away, and `storage.set` did not catch.

## How to develop here

Non-trivial work goes through spec → plan → execute. **Two of those three leave
an artifact behind; the plan does not.** The 19 plans written through 2026-09-09
were deleted on 2026-09-14 once every feature in them had shipped — a
task-by-task checklist is a working document, and a spent one only makes the
directory harder to search. Write the plan wherever you like and let it go.

Only the spec survives: `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` — what is being built and **why each tradeoff was chosen**. Read the relevant one before changing a subsystem; the reasoning behind a decision is harder to recover than the code implementing it.

**Lessons that outlive their round belong in this file or the matching `.claude/rules/` file, not in a separate handoff doc.** `docs/superpowers/HANDOFF.md` held them until 2026-09-14 and was deleted: it had drifted into an inventory of word counts, test counts and feature tables that rotted, nobody read it, and the one time it mattered it was found only by accident. Everything load-bearing in it is here or in those files. Add to the matching section — and keep it to rules and measured numbers, never inventory.

**A rule only one area needs goes in that area's rules file, with at most one line here.** This file is loaded whole into every session, and by 2026-11-13 it had reached 296 lines and 49 KB, a quarter of it SRS mechanism. Who asked for a change and what its first draft got wrong go in the spec; what stays in a rules file is the rule, the guard, and the number that justifies a constant.

**Re-measure against the rule as written, not the proxy you measured with.** A
feasibility count said an axis had 33 askable questions; the rule that actually
shipped in the spec yielded **1**, because the quick count had allowed the
dominant part of speech and the rule did not. The gap was invisible until the
number was recomputed from the specified rule. Any figure that justified a
design decision has to be re-derived from the decision's final wording before
the spec is committed.

**Review in two phases**: first whether the right thing was built, then whether it was built well — and read the code rather than trusting the implementer's report. **After a change, break the production code on purpose and confirm the matching test goes red.** That once caught three tests that an early-exit path made into no-ops while they still showed green.

Commit in small, self-contained steps, with a message that leads with the finding or the reason — not just the change. **Every number in a commit message comes from a command run for it, not from memory**: twice on 2026-10-01 a count written from recollection was wrong in a pushed commit (0.73M Jev tokens for 0.43M, 166 excludes for 137) and needed a correction in the next one.
