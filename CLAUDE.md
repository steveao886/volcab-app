# CLAUDE.md

Guidance for working in this repository.

## What this is

A personal English-vocabulary app for one Chinese-speaking learner. React 19 + TypeScript + Vite, shipped as a PWA to GitHub Pages under the base path `/volcab-app/`. There is no server: the app talks directly to a private GitHub repo (`volcab-data`) through the Contents API using a fine-grained PAT the user pastes at login.

Core loops: spaced-repetition review (`/review`), quizzes in several modes (`/quiz` — mixed, contrast, audio, 60-second sprint, passage cloze), a word library, and a capture-then-enrich flow for adding new words.

## Commands

| | |
|---|---|
| `npm test` | vitest, single run |
| `npx vitest run src/lib/foo.test.ts` | one file |
| `npm run build` | `tsc -b && vite build` — run this, not `tsc` alone |
| `npx oxlint` | lint |
| `npm run validate-words` | gate for `data/words.json` |
| `npm run validate-passages` | gate for `src/data/passages.json` |

**Never start the dev server with a shell command.** Use the browser preview tooling (`preview_start` with the `volcab-dev` config in `.claude/launch.json`), then drive and verify the page with the same toolset.

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

`words.json` is around 750 KB. The GitHub Contents API only returns file content inline below 1 MB. **Do not add bulk to it.**

### Bundled content is not synced data

`src/data/passages.json` ships inside the app bundle. It is read-only content the user never edits, so it does not belong in the sync schema and its types live in `src/lib/passage.ts`, deliberately not in `src/types.ts`. `src/types.ts` is the *synced* data model.

`data/words.json` and `data/wordlist.json` at the repo root are copies used by the scripts. **They have diverged from the live library before** (see commit `f53adb9`). The live library is authoritative; code that reads a word by id must tolerate the id not existing.

### Routing

`HashRouter` — GitHub Pages has no server-side rewrite. Sub-modes go through a `?mode=` query param (`/quiz?mode=sprint`, `/review?mode=lapses`) and switch with `replace: true`, so the system back gesture leaves the page instead of walking backwards through modes.

### SRS

`src/lib/srs.ts` is the scheduler, and it owns the schedule. Practice surfaces may reach it in exactly one way:

**A quiz miss halves `intervalDays` and never does anything else** (`demoteWord`). `ease`, `lapses`, `state` and `lastReviewedAt` are the scheduler's alone; `due` only ever moves *toward* now, never away. Three guards make that safe and all three are load-bearing:

- **Review-phase words only**, and **at most one demotion per word per day** (`ProgressEntry.demotedOn`). Wrong demotes and right does nothing, so without the cap it is a one-way ratchet and quizzes have no daily limit.
- **`due` takes a minimum against the existing date.** Scheduling from today alone can push a near-due word *further out* — a miss would promote it.
- **The 60-second sprint is exempt**, and the drills (`practiceGrade`) and free practice (`recordPractice`) never demote at all.

Everything else still holds: a practice miss stamps `missedAt` and nothing more. **Never pull `due` forward while leaving `intervalDays` alone** — `gradeWord` computes `next = intervalDays * ease` knowing nothing about elapsed time, so a word yanked back early and graded "good" grows as if the full interval had been served. That was a real bug (`71fba29`); the demotion above avoids it by changing the interval itself.

See `docs/superpowers/specs/2026-08-09-quiz-demotion-design.md`.

## Conventions

**Comments explain why, and cite evidence.** This codebase's comments are unusually load-bearing: they name the specific bug a decision prevents, and they quote real measurements over the word library ("across 476 words / 1251 marked occurrences: zero losses, zero false hits"). A comment that restates the code is noise. If you change behavior that a measurement justified, **re-measure and update the number** — a stale number is worse than none.

**Tests:**
- Pure logic goes in `src/lib/*.ts` with a colocated `*.test.ts`.
- **UI gets no component tests.** Push the logic worth testing down into `src/lib/` and leave the render layer thin enough not to need them. `store.tsx` is the single authorized exception.
- Anything random takes an injected `rng: () => number` defaulting to `Math.random`, so tests are deterministic. Never call `Math.random` inside a function body.

**Write side strict, read side lenient.** The `scripts/validate-*.ts` gates are where quality is enforced — malformed data must not reach the repo. The runtime does the opposite: skip the bad record, never throw, never white-screen. Both halves are required; neither substitutes for the other.

**New fields on synced data are optional.** Another device running an older build will push data without them. A required field means either a failed schema check or a forced migration. See the comments on `Meaning.share` and `settings.updatedAt`.

**Prefer failing closed over guessing.** When input is malformed or a word can't be located, skip it. Shipping a cloze question with no blank, or an etymology someone invented, is worse than shipping nothing.

## Design language

Mobile-first; **375px is the design width** and layouts must not overflow it. The palette is ink and paper (`src/styles/tokens.css`); vermilion is reserved for annotation and destructive actions, never for decoration.

Correctness must never be conveyed by color alone — quiz options carry a text tag as well as a color, for colorblind users and screenshots.

Keyboard shortcuts must be printed on the control they trigger. An undocumented shortcut does not exist.

## Gotchas

- **vitest excludes `.claude/worktrees/`** (see `vite.config.ts`). Background tasks check out the whole repo there; without the exclusion the suite runs twice and another branch's failures are attributed to yours.
- `tsconfig.app.json` does not enable `strict` or `noUncheckedIndexedAccess`. Indexed access is typed as present.
- `noUnusedLocals` is on: an unused import fails the build, including a type-only one.
- Chinese full-width punctuation inside a PowerShell here-string is fine, but double quotes in a commit message body will break `git commit -m @'...'@`.

## How to develop here

Non-trivial work goes through spec → plan → execute, and the artifacts are kept:

- `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` — what is being built and **why each tradeoff was chosen**
- `docs/superpowers/plans/YYYY-MM-DD-<topic>.md` — the task-by-task implementation plan
- `docs/superpowers/HANDOFF.md` — lessons that outlived the work that produced them

Read the relevant spec before changing a subsystem. These documents exist because the reasoning behind a decision is harder to recover than the code implementing it.

Commit in small, self-contained steps, with a message that leads with the finding or the reason — not just the change.
