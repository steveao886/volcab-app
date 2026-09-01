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

For list-wide bulk edits (backfilling fields, filling in data), **diff the repo copy against the live `volcab-data` before making changes**:

```bash
npm run check-live
```

It exits 1 on any difference (ids in either direction, or an entry whose content differs). `npm run check-live -- --write` realigns the repo copy to the live file using the app's own serialiser. Since 2026-09-01 this replaces the hand-typed `gh api … > /tmp/live.json` step; six of the 29 commits to `data/words.json` before it were repairs of drift nobody had noticed.

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

## ⏳ Open follow-up: re-measure retention on or after 2026-09-10

**Checked 2026-08-20 (the 07-30 follow-up). Answer: inconclusive by construction —
the measurement describes 1.3, but the live setting is now 1.6.** Re-armed for
2026-09-10, when the first words scheduled under 1.5/1.6 come due.

### What the 2026-08-20 check found

| | 2026-07-30 | 2026-08-20 |
|---|---|---|
| Retention on scheduled reviews | 97.8% (7 / ~317) | **94.7%** (61 misses / 1151) |
| 95% CI | 95.5 – 98.9% | 93.3 – 95.9% |
| Words tracked | 113 | 526 |
| Median interval | 4d | 16d |
| Words with `lapses > 0` | — | 125 (23.8%), 166 lapses all-time |
| `intervalModifier` | 1.0 → 1.3 | **1.6** |

**The sample is big enough (1151 ≫ 150) but it does not measure the current
setting.** `intervalModifier` was raised twice more after the 07-30 change, by
the user, without a measurement in between:

- 2026-07-30 — 1.0 → **1.3**
- 2026-08-12 — 1.3 → **1.5**
- 2026-08-18 — 1.5 → **1.6**

Retention on a given day tests the interval assigned at the *previous* grading,
not the modifier in force that day. With a 16-day median interval, essentially
every review in the 1151 was serving an interval set under 1.3 or earlier. Do
not read the per-day dip around 08-11..08-16 as the 1.5 change landing — it
cannot be; 1.5 was only set on 08-12.

**391 of 526 words (74%) currently carry an interval assigned under 1.5 or 1.6,
and not one of them is due yet.** That cohort lands 08-22 -> 09-14. Until it is
graded, the 1.5/1.6 decision rests on no evidence at all.

### Verdict on 1.3

**94.7%, straddling the boundary.** Per the 07-30 rubric that is "90-94%, leave
it alone" by a hair, or ">=95%, raise toward 1.5" within the CI. Raising to 1.5
was defensible. The further nudge to 1.6 was not evidence-backed, but it is not
obviously wrong either — pushing 94.7% down to a 90% target plausibly wants
something in the 1.5-1.6 range.

**Recommendation made 2026-08-20: hold at 1.6, raise nothing, re-check 09-10.**
Tuning further now would be tuning on data that describes a setting no longer in
use.

### Re-check on 2026-09-10

Same command as before, but **the all-time sum is no longer the right number** —
it is now dominated by the 1.3 era and will mask the change. Restrict to days on
or after 2026-08-22, when the 1.5/1.6 cohort starts coming due:

```bash
gh api repos/steveao886/volcab-data/contents/progress.json --jq '.content' | base64 -d > /tmp/p.json
node -e "const p=require('/tmp/p.json');let r=0,c=0;for(const [d,s] of Object.entries(p.dailyStats)){if(d<'2026-08-22')continue;r+=s.reviewPhase??0;c+=s.reviewPhaseCorrect??0}console.log(c+'/'+r,'=',(c/r*100).toFixed(1)+'%')"
```

Target is still 90%. **>=95%** -> 1.6 still too gentle. **90-94%** -> correct, stop
touching it. **<88%** -> overshot; drop toward 1.4 and expect the lapse list to
grow before the percentage recovers.

**The knob compounds — always say the multiplier out loud before changing it.**
1.3 is 3.71x after five reviews; 1.5 is 7.59x; 1.6 is **10.49x**. Going 1.3 -> 1.6
did not lengthen intervals by 23%, it lengthened them by **2.8x** over five
reviews. Also check `settings.intervalModifier` on the live data before trusting
any prompt or doc that states its value — this run's own brief said 1.3.

Delete this section once retention has been measured against a modifier that was
actually in force for the intervals being tested.

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


## The 38-word round, and what a second model was actually good for (2026-08-19)

`gemini` the standalone CLI **no longer works on this account** — it exits with
`IneligibleTierError: This client is no longer supported for Gemini Code Assist
for individuals`, pointing at Antigravity. `~/repos/antigravity-run.js` is now
the only path to a Gemini model from this machine, and it still works: two runs
this round, `--wait-file` both times, 95s and ~4min.

The division from the passage round held, and gained a second lane:

- **Lane 1, drafting.** Gemini wrote the English half of the eight multi-word
  phrase entries; the Chinese was written here. Unchanged from 2026-08-17 and
  still the right split.
- **Lane 2, adversarial review.** Gemini was given all 190 finished example
  sentences and asked for four categories of defect. It flagged 7. **Five were
  real** — `plausibilities` used as a count noun, "the ministry repressed the
  language" where a language is suppressed, "surveying students about
  belonging" without *a sense of*, and two blanks that genuinely admitted a
  library word as a second answer.
- **The two false flags share one cause, and it generalises**: both were "ten
  other words fit this blank", and the words it named (*assume*, *suppose*,
  *despondent*) are not in the library, so the app can never offer them as
  options. **A prose reviewer that cannot see the option pool over-reports
  ambiguity.** Either hand it the headword list or discount that whole
  category by hand.

**Precomputed surface forms beat instructions again.** Multi-word headwords
match contiguously and only the first word inflects, which no model derives.
A table of literally allowed forms per phrase (`fell through` yes, `fall right
through` no) produced **zero locate failures across 8 phrases × 5 sentences**,
where the passage round needed the same trick in the shape of a banned-prefix
table.

**Fan-out shape that worked**: 5 agents × 6 words for entries, one central
pre-check, then the pair diff as the single barrier, then 4 agents × ~10 pairs
for notes. 38 entries passed the central pre-check with **zero blocking
problems on the first pass**. The one hazard that had to be named in the
prompts was **sibling forms** — `prominent`/`prominently`,
`interchange`/`interchangeable` — where one entry's example containing the
other's form would blank the wrong word.

**A new word breaks existing sense groups in two directions, not one.**
`68e7d2f` recorded the second only:

1. **A member gets deleted.** Three groups here referenced words the user had
   removed in-app. One lost a ranked member and had to take outside
   distractors to stay above the three-authored-options floor; one was re-cut
   for a different part of speech; one was deleted, because its only member
   was gone and nothing left in the library carried the sense.
2. **A distractor becomes a library word.** Four groups here — `culmination`,
   `expressionless`, `assignable`, `dearth`/`scarcity` all arrived as
   headwords while sitting in some group's `extra`. The validator says exactly
   what to do: promote them into `order`.

Run `npm run validate-sense-groups` after **any** word addition or deletion,
not just after editing the groups file.

**A spurious contrast pair is better fixed at the synonym, not papered over
with a note.** `estrangement` listing `breach` paired it with `contravene`;
`belonging` listing `acceptance` paired it with `credence`. Both pairs are
nonsense, and the honest fix is to drop the one loose synonym — a note
explaining two unrelated words is worse content than no pair at all.

## 组句 (2026-08-30)

**Two measurements killed two of the three input forms before any of them was
designed.** The user proposed full typing, half typing, or Duolingo-style word
ordering. Measuring the corpus first — example sentences run 19 tokens at the
median, only 5 of 1215 under 12 — ruled out both word-level ordering (does not
fit 375px) and full typing (the friction that retired 猜词) without a single
line of code. **Measure the content before designing the interaction it has to
carry.**

**A heuristic that is 90% right is worth measuring before trusting.** A
splitter cutting only at punctuation and coordinators/subordinators landed
**1.0%** of the 1215 sentences in the 5–6 chunk range, at median block length
8 tokens. That number is what turned "we could derive chunk boundaries" into
"chunk boundaries are authored", and it took one script to get.

**Store indices into content, not copies of it.** The annotations are token
offsets into sentences that live in `words.json` and `senseGroups.json`.
That kept the file at 37 KB (7.6 KB gzipped) instead of ~150 KB, and — more
importantly — left the English with exactly one home, so it cannot drift. The
price is that nothing about an annotation is self-describing, which is paid
by a checksum field (`answer`) that both the validator and the runtime
re-derive.

**Two bugs here were only findable in the browser, and both were about what a
distractor looks like rather than what it says.** Drawing distractors from the
untouched sentence shipped one carrying its source's final period, among five
chunks that had all had theirs lifted out — it identified itself without being
read. Then a gate that rejected only exact duplicates offered `in rents`
beside the real `the rise in rents`. Unit tests asserted the rules that were
written; the screen showed the rules that were missing.

**The stem heuristics in this area need a prefix relation, not a shared
prefix.** Both the answer-leak check and the distractor gate first used
"shares the first N characters", which flagged `interceded` against `intern,`.
Requiring one string to be a *prefix* of the other, with a bounded length gap,
separates inflections from words that merely open the same way.
