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
| `npm run build` | `tsc -b && vite build` — run this, not `tsc` alone (`-b` also type-checks `scripts/`) |
| `npm run lint` | oxlint; runs in CI |
| `npm run validate` | all nine `validate-*` content gates in one go; runs in CI |
| `npm run validate-words` | gate for `data/words.json`; the per-word rules live in `src/lib/wordValidate.ts`, shared with both entry forms |
| `npm run check-live` | diff `data/words.json` against the live `volcab-data` copy through `gh`; `-- --write` realigns the repo copy |

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

**`--model` is a tier, not a model id** — only `flash_lite | flash | pro`, and
the server picks inside it. **Pass no `--model`.** Measured 2026-09-14 on
Antigravity 2.13.0: `flash` → `gemini-3.8-flash-tiered`, `pro` →
`gemini-3.1-pro-low`, i.e. `pro` is two generations behind *and* pinned to Low
thinking. A specific model or a high thinking level can only be picked by hand
in the IDE. The runner prints `running on <slug>`; `--require-model <substring>`
exits 3 rather than letting a job be served by a weaker model.

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

`words.json` is **1.35 MiB** (2026-09-14, 843 words, ~1,677 bytes each). **It crossed 1 MiB somewhere around word 640 and nothing happened, exactly as predicted — so don't re-panic about it**: 1 MiB governs only whether the JSON media type returns `content`, and `getFile` asks for `application/vnd.github.raw` (100 MB). The write path is not capped there either — a 40 MB file writes fine, ~24,000 words away. **Still do not add bulk to it**: GitHub's ceiling is between 40 MB and 46 MB, GitHub documents no write limit at all, and above it `putFile` gets a 422 that used to be indistinguishable from a merge conflict. See `docs/superpowers/specs/2026-08-22-contents-api-size-limits-design.md`.

**The nearer ceiling was localStorage, and nobody had measured it** until 2026-09-01: the words and progress caches sat at 977,624 UTF-16 code units, about 37% of WebKit's 5 MiB quota, roughly 1,900 words away at that month's pace. The words cache now lives in IndexedDB (`src/lib/wordsCache.ts`, async, falls back to memory when IndexedDB is unavailable); progress stays in localStorage and reaches the same quota around 12,000 words. `storage.set` returns `false` instead of throwing, and the store reports `STORAGE_FULL` through `syncError`. Boot reads each synced file with `If-None-Match` when it holds both a cache and a sha, and a 304 keeps the local copy. See `docs/superpowers/specs/2026-09-01-architecture-hardening-design.md`.

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

`src/lib/srs.ts` is the scheduler, and it owns the schedule. Practice surfaces may reach it in exactly one way:

**A quiz miss halves `intervalDays` and never does anything else** (`demoteWord`). `ease`, `lapses`, `state` and `lastReviewedAt` are the scheduler's alone; `due` only ever moves *toward* now, never away. Three guards make that safe and all three are load-bearing:

- **Review-phase words only**, and **at most one demotion per word per day** (`ProgressEntry.demotedOn`). Wrong demotes and right does nothing, so without the cap it is a one-way ratchet and quizzes have no daily limit.
- **`due` takes a minimum against the existing date.** Scheduling from today alone can push a near-due word *further out* — a miss would promote it.
- **The 60-second sprint is exempt**, and the drills (`practiceGrade`) and free practice (`recordPractice`) never demote at all.

Everything else still holds: a practice miss stamps `missedAt` and nothing more. **Never pull `due` forward while leaving `intervalDays` alone** — `gradeWord` computes `next = intervalDays * ease` knowing nothing about elapsed time, so a word yanked back early and graded "good" grows as if the full interval had been served. That was a real bug (`71fba29`); the demotion above avoids it by changing the interval itself.

**A scheduled review is the only thing that empties 顽固词, and the number on
今日 says so.** `strugglingPracticePool` admits a word on low ease, an immature
interval, *or* a `missedAt` inside seven days, and all three exits belong to
`grade`: the walk (`/practice?pick=struggling`) passes `settle: false`, so a
right answer there writes nothing and a wrong one only adds. Playing it cannot
move its own count, which read as a broken counter until 2026-09-22 — a real
user report. Two things came out of it. `grade` now clears `missedAt`, but only
on 记得/太简单 and only on a review-phase card: `again` and `hard` both dent ease,
so they confirm the miss rather than overturn it, and both learning steps land
inside one sitting, which is the short-term retrieval the 08-15 spec refuses to
credit. The 08-15 hazard does not reach `grade` at all — a graded card's `due`
moves past today, so it cannot be farmed. And the pool size moved out of
`PlanItem.count` into `hint`: that slot is remaining work everywhere else on
the page. Measured on the live library that day: 227 in the pool, 182 waiting
on ease or interval, 45 on a miss alone — and 123 of the 182 one good review
from crossing `MATURE_INTERVAL_DAYS`.

The manual 回想 rating (`ProgressEntry.recallRating`, 太简单 / 要多考) is **not** a second door. It is read only by `generateRecallSession`, as a third multiplier on the draw beside `difficultyWeight` and `recallWeight`, and reaches nothing in `srs.ts`. Its two levels are 0.05 and 6 and both numbers were measured — re-measure before changing either.

See `docs/superpowers/specs/2026-08-09-quiz-demotion-design.md` and `docs/superpowers/specs/2026-08-25-recall-rating-design.md`.

## Content rules

`docs/word-entry-spec.md` is authoritative for the shape of an entry. These are the rules that cost something to rediscover:

**Five example sentences per word, always.** The cloze prompt is drawn at random from them, so fewer means repeating the same prompt for the same word sooner. They must carry a concrete scene — textbook-flat filler is the one thing the user reliably rejects.

**Render only the sense `meanings[0]` describes.** `buildSentenceQuestion` sets `hint` to `meanings[0].en` and nothing else, so a rendering of a secondary sense tells the learner the answer is a different word than the one being asked. This bites because a word's five examples are written to *cover* its senses — an instruction like "pick two examples showing different situations" walks straight into the secondary sense on the 236-of-843 words that have one. It is a content rule and not a validator rule because nothing in the data tags which sense an example illustrates. Measured: handing each authoring agent an `ONLY_THIS_SENSE` gloss plus an `other_senses_DO_NOT_RENDER` list took the drift rate from **15% (9 of 60) to 0.09% (1 of 1,119, itself a false positive)** — from one paragraph in the brief.

**An antonym hangs off a word, not off a sense, and 发散's 反面 axis is where that shows.** A concept prompt names one sense; a member carrying two brings the antonyms of both. 一路不松劲,压力再大也不改口 drew `relentless` through its 坚定 sense and then accepted `intermittent` and `sporadic`, which answer its 持续不断 one — two of three answers about a sense the prompt never named. Read over all 31 opposite questions: **9 had at least one stray and 4 were mostly strays**, and the culprits are a handful of double-life words (`relentless`, `reactive`, `callous`, `ostentatious`, `agreeable`, `inert`), not badly authored concepts. `Concept.excludeOpposites` bans *answers* on that axis only — not members, because `relentless` is a fine 近义 for 不松劲. **A quorum ("two members must name it") was measured and rejected: 24 of 31 questions have a single-member answer and most are right.** Re-read with `npm run validate-concepts -- --opposites`, which prints every question with the member behind each answer; the validator gates staleness but the sense judgement is human.

**A 发散 prompt is the members' intersection, never their union.** Same disease as the antonym rule above, pointed at the prompt instead of the answers — and it costs more, because a stretched prompt is read on every play of the question while a stray answer is only met by whoever produces it. 对眼下的处境和上头攒着一肚子意见 ran 16 characters against a median of 12 and the user's verdict on reveal was "其实就是不满意的意思": 上头 was carried by `disaffection` alone (离心,对当权者失去拥护) and 处境 by `discontent`, while `dissatisfaction` has neither. The three share 不满 and nothing else. **Also name what the axis asks for, not the operation it looks like** — the label 〔加否定〕 read as "now give me the opposite" beside 〔反面〕 in the same round, when every answer on that axis *means* the prompt and merely carries a prefix. It is 〔否定前缀〕, and the instruction leads with 同样的意思.

**A hint ladder calibrated on one axis is not calibrated on all of them.** 发散's rungs open the first 1 then 3 letters, tuned on 近义 where a single initial pins 64% of answers inside their own set. On 否定前缀 every answer starts with one of the seven prefixes the instruction line already prints, so measured over its 20 answers the ladder was worth **0.00 stem letters at tier 1 and 0.85 at tier 2**, against 1.00 and 3.00 on the other three axes — and on the question whose answers all share `dis-`, climbing the whole ladder rendered three identical `dis•••`. `hintOpen` counts the rungs past the prefix. Before adding a per-axis surface, ask what the shared mechanism is worth *on that axis* and measure it there.

**Don't fill a blank `etymology` just to reach 100%.** The blanks are deliberate: some are genuinely disputed (`harangue`, `grouse`, `rabble`, `obscene`, `agog`, `turmoil`, `vehement`), and decomposing others (`purebred`, `interchangeability`, `wastefulness`, `undervaluation`) yields nothing useful. A wrong etymology is not a missing fact, it is a false memory anchor driven into the learner's head. Folk etymology is worse than a blank.

**Don't loosen the stemming in `src/lib/headword.ts`.** A handful of sentences across the library fail to locate their headword; cloze and highlighting skip them and those words still have four usable sentences each. The enumerated suffix list was tuned empirically, and loosening it makes the `mire` stem match **mirth**. A fraction-of-a-percent blemish is not worth that.

**Stem comparisons here need a prefix *relation*, not a shared prefix.** "Shares the first N characters" flags `interceded` against `intern,`. Require one string to be a prefix of the other with a bounded length gap, which separates inflections from words that merely open the same way.

**Store indices into content, not copies of it.** The 组句 annotations are token offsets into sentences that live in `words.json` and `senseGroups.json` — 37 KB instead of ~150 KB, and the English has exactly one home so it cannot drift. The price is that an annotation is not self-describing, paid by a checksum field (`answer`) that both the validator and the runtime re-derive.

## Delegating bulk content drafting to a second model

Worth doing, with a division of labour that has held across every round: **the second model drafts English prose; the validator gates structure; a person writes the Chinese and reads every distractor pool.**

**The gate holds; the prose does not.** Across 420 markers the validator caught every structural error and every one was mechanical — nothing about correctness got through. Style has no gate, and first drafts come back uniformly padded. Abstract style instructions do not land; **quoting the model's own worst sentences back at it does.**

**Give it rules it cannot infer, precomputed.** `headwordPattern` falls back to `stem + [a-z]*`, so `{{subdue}}` collides with *submarine*. No instruction gets a model to derive that; a per-word table of banned prefixes dropped it to zero. Same trick, different shape, for multi-word headwords: a table of literally allowed surface forms (`fell through` yes, `fall right through` no) produced zero locate failures across 8 phrases × 5 sentences.

**Watch what a constraint makes it write.** Told not to put an article against a marker, it wrote `one absolute {{autocracy}}` — 13 times. The warning was satisfied and the English was worse. A rule that can be dodged will be.

**A prose reviewer that cannot see the option pool over-reports ambiguity.** Given finished sentences and asked for defects, it flagged 7 and 5 were real; both false flags were "ten other words fit this blank", naming words that are not in the library and so can never be offered. Hand it the headword list or discount that category by hand.

**Do the Chinese yourself.** Two rounds of sharpening the brief never got the register — the output stays translationese. It is the half the user reads every session and the half no validator sees. Budget for editing it, not for prompting it.

**Both halves are needed.** A mechanical pre-check caught one entry in 1,119 that put its target in the sentence twice, which no reviewer catches by eye; the brief stops the failure a script cannot see. Keep the fan-out serialised or give agents disjoint id namespaces up front — parallel agents assigning ids collide otherwise.

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
- `tsconfig.app.json` enables `strict` (measured clean on 2026-09-01) but **not** `noUncheckedIndexedAccess` (503 errors on the same day). Indexed access is typed as present; guard it by hand.
- `noUnusedLocals` is on: an unused import fails the build, including a type-only one.
- Chinese full-width punctuation inside a PowerShell here-string is fine, but double quotes in a commit message body will break `git commit -m @'...'@`.
- **`Volcab.enex` is a personal note file and this repo is public.** It is gitignored and has never been tracked. Never `git add` it.

### Browser and UI debugging

- **Handling a key on keydown and moving focus in the same handler is the dangerous combination.** Chrome activates a focused button on the **keypress**, delivered to whatever holds focus when it is dispatched — not to the element that got the keydown. 组句 submitted on keydown, disabled the input and focused 下一题 in that same handler, so the rest of the press clicked 下一题 and the verdict lived 0.7ms. The fix is one `e.preventDefault()` on the keydown. 拼写 is safe because it submits through the form's *implicit submission*, which **is** the keypress's default action; 回想 is safe because each auto-focused button consumes its own keypress before handing focus on.
- **`mcp__Claude_Browser__computer` cannot activate a button by keyboard at all** — its synthesized key events carry no default action, so a focused button scores zero clicks on Enter and on Space. Every negative result it gives about keyboard activation is an artifact. `mcp__chrome-devtools__press_key` dispatches the real thing. **Prove the tool can reproduce a mechanism before trusting it to disprove one.**
- **HMR lies.** When behavior does not change after an edit, force-refresh before concluding the fix did nothing.
- **A shared class name is a layout contract, not a look.** `.quiz-progress` is a
  grid container and reusing it for a one-line counter stacked 第 / 1 / 8 / 题 onto
  four lines; `.word` is the 34px headword face and reusing it for a list of
  answers clipped `apathetic` off the card at 375px. Both passed tsc, lint and
  the whole suite, and both were visible in the first screenshot. **Screenshot
  any new screen at 375px before calling it done** — no other check in this repo
  looks at layout.
- **Play the thing, with a wrong answer.** 发散's typo tolerance was measured,
  specified and unit-tested, and the first real typo typed into the finished
  screen was rejected: a swap of two adjacent letters is two edits under plain
  Levenshtein, and a swap is the commonest slip there is. Tests written from the
  same model as the code share the model's blind spot.
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

**Lessons that outlive their round belong in this file, not in a separate handoff doc.** `docs/superpowers/HANDOFF.md` held them until 2026-09-14 and was deleted: it had drifted into an inventory of word counts, test counts and feature tables that rotted, nobody read it, and the one time it mattered it was found only by accident. Everything load-bearing in it is above. Add to the matching section here instead — and keep it to rules and measured numbers, never inventory.

**Re-measure against the rule as written, not the proxy you measured with.** A
feasibility count said an axis had 33 askable questions; the rule that actually
shipped in the spec yielded **1**, because the quick count had allowed the
dominant part of speech and the rule did not. The gap was invisible until the
number was recomputed from the specified rule. Any figure that justified a
design decision has to be re-derived from the decision's final wording before
the spec is committed.

**Review in two phases**: first whether the right thing was built, then whether it was built well — and read the code rather than trusting the implementer's report. **After a change, break the production code on purpose and confirm the matching test goes red.** That once caught three tests that an early-exit path made into no-ops while they still showed green.

Commit in small, self-contained steps, with a message that leads with the finding or the reason — not just the change.
