# Volcab Project Handoff Notes

**Last updated:** the extra-practice three-modes + etymology round
**Status:** **shipped and in daily use.** Only small fixes from here on, no more development at scale.

Live URL: https://steveao886.github.io/volcab-app/

---

## One-line status

A vocabulary-learning PWA: SM-2 spaced repetition + four quiz modes + word-list management, with learning progress synced across devices via the private repo `volcab-data`. **All six pages are complete and in daily use on real devices**, 432 tests, type-check / build / lint / word-list validation all green, GitHub Actions deploys on every push.

**Once today's queue is empty there's still work to do**: the test page's three extra-practice modes — discrimination, listening, and sprint. None of the three pollute SRS state — they follow `recordQuiz`'s convention exactly: a wrong answer only moves the due date up, `ease` and `intervalDays` are never touched.

## Two repos

| Repo | Visibility | Contents |
|---|---|---|
| `steveao886/volcab-app` | Public | Source code. Pushing to master auto-builds and deploys to Pages |
| `steveao886/volcab-data` | Private | `words.json` (471 words / 5 example sentences each), `progress.json` (learning progress), `staging.json` (words awaiting completion) |

⚠️ **`data/words.json` (in the app repo) is not the live word list.** It only feeds dev-mode demo data and two full-list regression tests; the app at runtime reads the copy in `volcab-data`. The two **have diverged before**: the user deleted 5 words in the app, and that only got written to `volcab-data` — the repo copy stayed frozen at the original 476-word import snapshot, and the drift went unnoticed for months (the demo data having 5 extra words throws no error).

For list-wide bulk edits (backfilling fields, filling in data), **pull the current state of `volcab-data` and diff against it before making changes**:

```bash
gh api repos/steveao886/volcab-data/contents/words.json -H "Accept: application/vnd.github.raw" > /tmp/live.json
```

Then **apply the change on top of the live copy, rather than overwriting it with the local copy** — the latter would resurrect words the user had deleted. This is exactly the failure condition noted in the word-entry spec for "overwrite the list directly, invalid if the user has already modified the list in-app" — and it really did trigger once.

Auth is a GitHub fine-grained PAT scoped to read/write on `volcab-data` Contents only, stored in browser localStorage. No server.

## Verification commands (should all be green)

```bash
npm test && npx tsc -b --noEmit && npm run build && npx oxlint && npm run validate-words
```

**To see the design system**: `npm run dev` → `#/dev` (dev mode only) — every state of every component is on that one page.
**To see the UI without a real token**: the "Demo mode (dev only)" button at the bottom of the login page loads the local 476-word list with no network connection. Absent from the production build (verified: zero hits in `dist`).

---

## Feature overview

| Page | What it does |
|---|---|
| Login | Paste a PAT + a seven-step illustrated guide (including the **expiration** step — skip it and you get locked out a month later) |
| Today | Due count / new-word count / streak days / total progress; 7-day bar chart; sync-status badge; **an extra "focus on lapses" entry point appears when there are stubborn words** |
| Review | SRS cards, flip to see definitions/examples/**etymology**/related forms + **likelihood-of-encounter score and sense-share for polysemous words**, **headword highlighted** in example sentences, four-tier grading, **can delete the word on the spot after flipping**, progress shown as "N left". **`?mode=lapses` is the lapses-only mode**: the queue switches to the top 20 words ranked by miss count and ignores due dates, everything else behaves identically |
| Quick Test | **Four mode chips at the top, driven by `?mode=`, defaulting to "mixed"** (behavior with no query param is identical to before the extra modes existed). Mixed = six question types in rotation: see word pick meaning, see meaning pick word, spelling, cloze-in-example, collocation fill-in, synonym/antonym hints, weighted by sense share for polysemous words. **Discrimination** = pick-one-of-two-confusable-words cloze + a side-by-side comparison card after answering. **Listening** = sound→meaning / sound→form in rotation. **Sprint** = 60 seconds, tapping an option scores it immediately and advances, tracks personal best |
| Word List | Searchable list of 476 rows (headword/Chinese-English definitions, case-insensitive) + status and source filters + bulk delete |
| Entry Detail | Full entry + pronunciation + learning stats + **contemporary likelihood-of-encounter score and sense share** + **etymology** + edit + delete |
| Add Word | **Quick-capture** at the top (word only, goes to staging); full form below (dictionary lookup pre-fills, **likelihood score and sense share required**) |
| Stats `/stats` | 30-day review volume, accuracy trend, streak-break calendar, mastery distribution, **mastery rate for high-frequency words (bucketed by likelihood score into three tiers)**, cumulative volume |
| Settings | Daily new-word count, sound toggle, account info, export backup |

**For what a word entry must look like, [`docs/word-entry-spec.md`](../word-entry-spec.md) is authoritative** (the single source of truth — don't consult the phase design docs). It spells out every required field, the scoring anchors for `usageScore`, the hard constraints on sense share `share`, the "better to omit" rule for `etymology`, and the workflow for completing entries in the staging area.

**5 example sentences per word** (2355 total). This number matters: the cloze-quiz prompt is randomly picked from these 5, and the more there are, the less likely you are to hit the same prompt for the same word twice. Follow the same 5-sentence rule when adding words.

Across the whole list, 3 sentences fail to locate the headword (`deify/deifies`, `delve/delving`, `requite/unrequited`) — cloze and highlighting skip them, and each of those words still has 4 usable sentences left. **Don't loosen the stemming rules in `lib/headword.ts` over this** — that set of enumerated suffixes was tuned empirically, and loosening it makes the `mire` stem match **mirth**. A 0.13% blemish isn't worth that risk.

**Etymology coverage is 460/471** (repo copy matches the live one). The remaining 11 are deliberately left blank: `harangue` / `grouse` / `rabble` / `obscene` / `agog` / `turmoil` / `vehement` have etymologies that are themselves disputed, and breaking down `purebred` / `interchangeability` / `wastefulness` / `undervaluation` yields no useful information. **Don't fill these in just to hit 100%** — a wrong etymology isn't just a missing piece of information, it's a false memory anchor driven into your head; folk etymology is worse than a blank.

**How the staging area for new words works**: the input box at the top of `/add` drops a word in — just the word, nothing else. Once enough have piled up, have the AI read `staging.json` in-session, batch-generate complete entries per the word-entry spec (**produce `usageScore` and, for polysemous words, `share`, at this step** — don't add them after the fact once already in the store), merge into `words.json`, and **remove exactly the promoted entries by headword** (don't clear the whole file — the user may have added more words in the meantime).

---

## Architecture and key conventions

```
src/
├── lib/        pure functions, all tested: srs (SM-2) / queue / merge / quiz / github / storage / tts / sound
│              + senseShare (sense-share rules, imported by the validation script)
│              + etymology (etymology field rules, also imported by the validation script)
│              + headword (locates the headword within a sentence, shared by cloze and highlighting)
│              + contrast (confusable-word pairing: builds an inverted index over overlapping synonyms, scores by closeness)
├── state/      store.tsx (React bindings) + sync/session/errors (pure logic, heavily tested)
├── components/ design-system components
├── styles/     tokens / base / components / layout
└── pages/      eight pages + their own pure functions (reviewQueue / libraryFilter / statsDerive / todayStats / stagingCapture / dictionaryApi)
```

**Testing philosophy**: no component tests for UI (a deliberate decision); **but any real logic gets extracted into a pure-function file and TDD is mandatory.** The great majority of the 386 tests come from those pure-function files, plus 32 orchestration/integration tests in `store.test.tsx`.

**Design language, "ink and paper"**: warm ivory paper / ink black, vermillion **used only for annotation** (margin marks, tab-index ticks, progress bars, stamps), hairline strokes rather than shadows, serif for English headwords, a dedicated font stack for phonetics, CJK-first sans-serif for Chinese. Mobile-first at 375px, both light and dark themes. `--tap: 44px` is the minimum tappable size.

**Sync mechanism**:
- Progress pushes on a 30-second debounce; word-list and staging-area changes push immediately
- Conflict handling: re-fetch → merge per word (keep the newer `lastReviewedAt`) → push again, **retried only once**
- **settings is resolved by `settings.updatedAt`**; a missing timestamp is treated as oldest
- The pending-push queue is persisted to localStorage, so a failed push isn't lost even if the tab is closed

---

## Known issues (**not fixed**, ordered by severity)

1. ~~**`words.json` hits the 1 MB read limit**~~ — **fixed**: `getFile` now uses `Accept: application/vnd.github.raw`, raising the limit to 100 MB. The sha is read from the raw response's ETag (verified to be the blob sha, and it's exposed via `Access-Control-Expose-Headers`); if the shape is wrong it falls back to an extra JSON request for the sha alone. **Note that `progress.json` goes through this same `getFile`, so the concern about "the full log hitting the ceiling in about 9 months" (v1.1 spec §5.1) is resolved along with it.**
2. **Four spots still have no automated tests**: the 30-second debounce (would need `PUSH_DEBOUNCE_MS` made injectable), `online`/`offline`/`visibilitychange` (would need tests that stub `navigator.onLine` and `document.visibilityState`), demo mode, and **sprint mode's 60-second countdown and 350ms auto-advance** (both timers live inside `QuizSprint.tsx`; testing them requires making the durations injectable — the question-generation and scoring logic itself is already tested, only the timing isn't).
3. **Word-list/entry-detail back navigation pushes instead of popping**: search terms, filters, and scroll position are lost every time, the 476-row list resets to the top; the history stack only grows, so under a standalone-window system back gesture you land back on the word you just viewed.
4. **Quiz results page loses its results if you tap the wrong word**: entering entry detail unmounts `QuizSession`, and coming back starts a fresh round.
5. ~~**Newly added words don't enter the review queue for months**~~ — **fixed**: `buildQueue` now sorts new words by `usageScore` descending instead of array order; the tiebreaker for review words also switched from alphabetical to likelihood-of-encounter score.
6. **Two separate bar-chart implementations**: the Today page's 7 bars use CSS flex, the Stats page's 30 bars use SVG (rounding error in 30 flex bars at 375px width would overflow). The reasoning holds, but it leaves duplication behind.
7. **Sound effects are subtle**: 90ms sine wave, peak gain 0.12. iOS's **side mute switch silences Web Audio**, which isn't a bug but is very easy to mistake for one.

   The same trap is more serious in **listening mode**: iOS can block `speechSynthesis` calls that lack a user gesture, so every question has an explicit "play again" button, and autoplay on question entry **being blocked doesn't affect the ability to answer**. Deliberately no detection of whether playback succeeded — such detection is unreliable, and the button itself is a complete fallback. If you can't hear anything on a real device, check the mute switch before touching the code.
8. **The version number on the settings page is a constant**; `package.json` is still `0.0.0`. A real version number would need a `define` added to `vite.config.ts`.
9. **Eyebrow-label styling is scattered across four places** (`.pos` / `.page__eyebrow` / `.quiz-q__label` / `.review-done__label`), differing only in color. Extracting `.eyebrow` was a design decision that was never carried out.

---

## Pitfalls hit along the way (important, don't repeat them)

**This environment's browser panel doesn't composite frames.** Screenshots always time out, `requestAnimationFrame` never fires, coordinate clicks don't register, `getComputedStyle` returns stale values mid CSS-transition. **Not a single screenshot exists anywhere in this project** — every visual conclusion is grounded in the DOM and computed-style layer only. To verify layout, use `getBoundingClientRect()` to check rectangle intersection, don't eyeball it.

**HMR lies.** When behavior doesn't change after editing code, force-refresh before drawing any conclusion. At least twice this nearly led to misjudging a fix as ineffective.

**`el.blur()` doesn't produce a React-visible `focusout` when the panel isn't focused.** To test form submission, dispatch a bubbling `focusout`, otherwise you'll wrongly conclude `onBlur` isn't wired up.

**`preview_start` without an explicit URL may start a server in the main repo** rather than the current worktree.

**Parallel agents sharing the same browser session fight over tabs**, and have hit "Tab cap reached." If you need one, create your own tab and always pass an explicit `tabId`.

---

## ⏳ Open follow-up: re-measure retention on or after 2026-08-20

**Set 2026-07-30. Nothing else in this file is pending; this is.**

`settings.intervalModifier` was set to **1.3** on 2026-07-30 because measured
retention was far above the 90% that SM-2's defaults aim for. That decision
was made on **six days of data and seven lapses**, which is thin. It has to be
checked against real data before it is either trusted or pushed further.

Baseline at the time of the change:

| | |
|---|---|
| Retention on scheduled reviews | **97.8%** (7 lapses / ~317 real reviews) |
| 95% CI on that | 95.5% – 98.9% |
| Headline "accuracy" (the misleading one) | 90.8% |
| Words tracked | 113 |
| Median interval | 4d |
| `intervalModifier` before → after | unset (1.0) → 1.3 |

**Why the two percentages differ, and why it matters:** `reviewed`/`correct`
count every card view, including the two learning-step grades each new word
costs before graduating. That number ran 7 points *below* true retention.
Tuning intervals against it would have moved them the wrong way — it nearly
did. `reviewPhase`/`reviewPhaseCorrect` were added in the same change to
measure the real thing; the stats page prints it as 真实留存率.

**How to re-measure** (needs `gh` as steveao886):

```bash
gh api repos/steveao886/volcab-data/contents/progress.json --jq '.content' | base64 -d > /tmp/p.json
node -e "const p=require('/tmp/p.json');let r=0,c=0;for(const s of Object.values(p.dailyStats)){r+=s.reviewPhase??0;c+=s.reviewPhaseCorrect??0}console.log(c+'/'+r,'=',(c/r*100).toFixed(1)+'%')"
```

Only days recorded after 2026-07-30 carry those fields, so this is a clean
post-change measurement — no need to exclude anything by hand.

**What to do with the answer.** The target is 90%.

- **Still ≥ 95%** — 1.3 wasn't enough. Raise toward 1.5 and check again. Say
  the new number out loud rather than nudging silently; the knob compounds
  (1.3 is ≈3.7× after five reviews, not 30%).
- **90–94%** — working as intended. Leave it alone.
- **< 88%** — overshot. Drop back toward 1.15. Expect this to show up as more
  words in the lapse list before it shows up in the percentage.
- **Fewer than ~150 scheduled reviews recorded** — the sample is still too
  small to act on, exactly as it was on 2026-07-30. Wait longer; do not
  split the difference on noise.

Delete this section once the check has been made and the outcome recorded.

---

## How this project got built (methodology, worth reusing)

**Parallelism + isolation**: the eight pages were built by eight agents working simultaneously, each in its own git worktree, with `node_modules` shared via a junction. The rule was that **page agents were never allowed to touch `src/styles/` or `src/components/`** — if a page needed styling that didn't exist yet, it wrote its own page-level CSS and listed it in its report, to be consolidated in one pass after merging. Eight parallel tracks, zero merge conflicts.

**Two-phase review per task**: first check spec compliance (was the right thing built), then check code quality (was it built well). Reviewers were explicitly instructed to "not trust the implementer's report — read the code yourself and verify." This process caught things like: the PAT walkthrough missing the expiration step (an easy mistake to make copying the plan verbatim, and one that locks the user out a month later), a word-list edit getting silently overwritten by the remote after a failed push, the add-word page having no entry point at all, focus dropping back to `body` after every answered question, and full-width commas failing to split tags.

**Mutation testing**: after finishing, deliberately break the production code and confirm the corresponding tests go red. This process once caught a real no-op — three tests that, because of an early-exit path, never executed their assertions yet still showed green.

**Write failure conditions into the spec.** The "overwrite the word list directly" strategy is documented with an explicit note: "invalid if the user has already modified the list in-app." Later, when a push was rejected, no on-the-spot judgment call was needed — it was just a matter of checking whether that condition had triggered. **A written-down failure condition beats any amount of careful caution.**

---

## Environment

- Windows, both PowerShell and Git Bash available
- `gh` logged in as: **steveao886**
- `Volcab.enex` is a personal note file, already gitignored, **never `git add` it** (the app repo is public). Confirmed it has never been tracked.

## User preferences

- UI in Chinese, definitions bilingual (Chinese/English)
- Example sentences must have a concrete scene and vividness, no textbook-flat filler
- The user pauses between phases; don't push ahead to the next phase on your own initiative

## Parallel worktree subagents (2026-08-07 UI round)

Three independent page rebuilds (Today hero / Quiz hub / Review interval
preview) ran as three parallel subagents, each in its own git worktree
under `.claude/worktrees/`, then merged back — zero conflicts, because
the plans were scoped to disjoint files up front. Lessons that outlived
the round:

- **A worktree may be checked out from a stale base.** All three agents
  found the just-committed spec/plan docs missing from their checkout and
  had to read them from the main repo path. Point agents at absolute
  paths in the main checkout for any doc committed in the same session.
- **Worktrees inside the repo can run the root's toolchain.** No
  `npm install` needed: `npx vitest/oxlint/tsc` resolve by walking up to
  the root `node_modules`. This is also why `vite.config.ts` excludes
  `.claude/worktrees/` from vitest.
- **Plans that hand agents complete code still get compile-checked by
  reality.** One plan snippet failed `tsc` (TS18047 null-narrowing) and
  one carried a wrong `lang` attribute; both were caught because agents
  were told to run the full gate and report deviations rather than
  silently patch. Keep that reporting clause in every dispatch prompt.

## The struggling-word count was an undercount (2026-08-08, repaired)

`rankStrugglingWords` requires `ease < 2.5 && intervalDays < 21`. The
pre-`71fba29` bug inflated `intervalDays` and never touched `ease` — and
`intervalDays` is an *exclusion* in that predicate, so the damage runs one
way only: a word the scheduler itself rates hard, carried past 21 days, is
filed as mature and disappears from every surface built on the ranking.

Measured on the live `progress.json`, 312 entries past `new`:

| | |
|---|---|
| `ease < 2.5` | **81** |
| shown (`intervalDays < 21`) | 54 |
| hidden (`intervalDays >= 21`) | **27** |

Short by a third. Eight of the 27 are beyond the current
`MAX_INTERVAL_DAYS` of 100; three sit at exactly 365 — the old ceiling,
which is the bug's fingerprint. `promulgate` is still at ease 1.70 / 268
days, the same figures `71fba29`'s message quotes. That commit's other
signal survives too: words 90+ days out have a median 8 reps against the
library's 5, so for pre-fix entries more gradings still means longer
intervals.

**Repaired 2026-08-08** (`volcab-data` commit `dd6d6a0`). All 27 entries
clamped to `intervalDays` 20 with `due` recomputed as their last-reviewed day
plus 20; the list now reports 81 with 0 hidden. Two things that repair
turned on, both of which would have silently wasted it:

- **Clamp to 20, not 21.** The predicate is `intervalDays < MATURE_INTERVAL_DAYS`.
  Clamping to 21 leaves every word excluded and the whole repair is a no-op.
- **`lastReviewedAt` had to be bumped +1 second.** `mergeProgress(local,
  remote)` keeps the local entry when `le.lastReviewedAt >= re.lastReviewedAt`
  — local wins ties — and it is called local-first on both the boot path
  (`store.tsx`) and the push-conflict path (`sync.ts`). Repairing the remote
  without touching the timestamp means the browser's cached copy out-ranks it
  and reverts the fix the next time the app opens. A whole second, not a
  millisecond: ISO strings compare as strings, and +1ms can confine the change
  to the fractional part, which compares backwards against a timestamp that
  has none. The calendar day is unchanged, so `buildLapseQueue`'s
  "already dealt with today" reading is unaffected.

**Any future direct write to `progress.json` faces the same merge trap.**
Bump the timestamp or the write will not survive.

Why it needed a one-time repair at all: `71fba29` closed the source, but
`MAX_INTERVAL_DAYS` is forward-looking by design, so an entry only gets
clamped when it next comes due — 2027 for the 365-day words. Waiting was
not a plan.

Reproducing the measurement does **not** need a manual export. `gh` is
authenticated with `repo` scope and `steveao886/volcab-data` is reachable:

    gh api -H "Accept: application/vnd.github.raw" \
      repos/steveao886/volcab-data/contents/progress.json

Worth remembering generally — the private data repo is readable from the
CLI, so "ask the user to export a backup" is rarely the right move.


## Delegating bulk content drafting to Gemini (2026-08-17)

`~/repos/antigravity-setup.md` plus `~/repos/antigravity-run.js` drive the
local Antigravity agent from the CLI, and volcab is already a registered
project. Both modes were verified from this repo: Q&A via `--quiet`, and
file handoff via `--wait-file`. Writes work even though volcab's project json
has an empty `settings` block — the setup doc predicts that would block them
and it does not.

Forty-two passages were drafted this way. What the round trips taught:

**The gate holds; the prose does not.** Across 420 markers the validator
caught every structural error, and every one was mechanical. Nothing about
correctness got through. But style has no gate, and the first draft came back
uniformly padded — an adjective on every noun and an `-ly` adverb on every
verb, sentences that read the same in any order. Abstract style instructions
did not land. **Quoting the model's own worst sentences back at it did.**

**Give it rules it cannot infer, precomputed.** Two markers failed because
`headwordPattern` falls back to `stem + [a-z]*` when the exact word is
missing, so `{{subdue}}` collides with *submarine* and `{{modesty}}` with
*modern* and *model*. No amount of instruction gets a model to derive that.
Handing over a per-word table of banned prefixes dropped it to zero.

**Watch what a constraint makes it write.** Told not to put an article against
a marker, it wrote `one absolute {{autocracy}}` and `One {{astute}}
technician` — 13 of them. The warning was satisfied and the English was worse.
A rule that can be dodged will be.

**Parallel batches cannot see each other.** Five concurrent runs produced two
identical ids and five duplicated settings, because each brief listed only the
ids that existed when it was written. Either serialise, or assign disjoint
namespaces and settings up front.

**Do the Chinese yourself.** Two rounds of sharpening the brief never got the
register; the output stays translationese ("他高度孤立的物理位置使他极易受到…的
影响"). It is the half the user reads every session and the half no validator
sees. Budget for editing it, not for prompting it.

The division that worked: Gemini drafts English prose; the validator gates
structure; a person writes the Chinese and reads every distractor pool.
