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
job be served by a different model. (Superseded note: before 2026-11-09
`--model` only took tiers and `pro` meant the stale `gemini-3.1-pro-low`.)

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
A ticked 专攻顽固词 row stays a link (`PlanItem.reopenable`): done there means
you sat down today, not that the pool is empty. That is why 今日 has no separate
顽固词加练 card — it existed only because the ticked row went inert, and put
the same walk on the page three times.

**A word missed in 回想 comes back Chinese-first, on the review card it already had, and that card has a second way to reach the schedule** (`gradeUnproduced`, 2026-11-11). Asked for as "should 回想 misses join the daily review", under one constraint from the user: no added work. Measured that day, 76 of the 103 words on a live 回想 miss had not been asked again for 8 days or more (median 20), and 69 of those 76 had been graded in the scheduled review meanwhile and passed, because its card is headword-front. So the debt is derived from `RecallStat` (`lib/recallDebt.ts`: missed, not yet right three times running, due 1 / 3 / 7 days after the last answer), no card is added, and a due review-phase card whose debt is due is turned over. 想不出 there halves the interval and is **not a lapse**: `ease`, `lapses` and `state` stay where they were, the one-a-day cap is `demotedOn`, shared with the quiz demotion in both directions. It cannot be `demoteWord`, which takes a minimum against a `due` that is already today and would leave the card due forever. It counts in `reviewed` and `reviewWords` and stays out of `reviewPhase`, since a card that showed the meaning first tested no recognition. Three things the first draft got wrong and a review caught: the halved one-day word qualified for 今日巩固, 18 words' glosses printed the answer or other English, usually its near-twin, on the turned front, and an owed 回想 slot could be dealt as 排序 with the word on screen. 今日 has no row for any of this, by the user's decision. See `docs/superpowers/specs/2026-11-11-recall-debt-design.md`, which also says what would show the halving is too strong.

The manual 回想 rating (`ProgressEntry.recallRating`, 太简单 / 要多考) is **not** a second door. It is read only by `generateRecallSession`, as a third multiplier on the draw beside `difficultyWeight` and `recallWeight`, and reaches nothing in `srs.ts`. Its two levels are 0.05 and 6 and both numbers were measured — re-measure before changing either.

**Untangling a confusion is practice too, and never demotes.** A lapse in the scheduled review asks 怎么忘的？, and naming a partner opens a tangle (`Progress.tangles`): 今天混过的词 on 复习完成 that day, then 拆开缠在一起的词 on 今日 (`/untangle`) from the next. 今天混过的词's question writes through `recordPractice(id, correct, { settle: false })` as each answer lands; `/untangle`'s clozes write once, through `recordTangle`, when the session's last answer lands, so a session left early writes nothing and is still owed. A miss in either stamps `missedAt` and nothing else — `due`, `intervalDays`, `ease`, `lapses` and `state` stay the scheduler's, and there is no `demoteWord` on this path. A right answer settles a tangle member, not the word: it leaves `missedAt` for a scheduled review to clear. The sense-group questions `/untangle` offers on its end screen, after the verdict and never in front of it, are 回想's view with its writes cut down: `recordRecall` (the production record) as each answer lands and, on a miss, the same `recordPractice` plus `recallRating` set back to none when it was 太简单, as a miss does in 回想; the reveal also lets the user rate the word by hand (`rateRecall`). Never `recordQuiz`, which demotes, and never 巩固, whose `consolidateWord` writes `lapses`. They come after `recordTangle` and settle nothing. The question itself is asked after the 重来 has been graded, so `recordForget` writes only the forget log and the tangle. See `docs/superpowers/specs/2026-10-20-forget-moment-design.md` §4.

**A review carried over from an earlier day takes a new word's place, one for one** (`newQuota` in `queue.ts`), and a day carrying more than `newPerDay` is review only. Measured 2026-11-04: 61.6 steady-state reviews a day plus 12 new words (~36 cards) was the whole of a ~100-card day, so a missed day had nowhere to go but on top of the next. The count must be frozen, because the session serves overdue cards first and a live count reaches zero just before the new words. It lives in `DailyStat.carriedOver`. The first `grade` of a 复习 session stamps it, on that session's own day, so a session running past midnight stamps nothing. The session must also have been built after this device's first pull of the day (`progressPulledOn`, `gradeSession`). A phone resumed in the morning still sees last night's laptop reviews as overdue, and with no other stamp that day, merging to the smaller value has nothing to correct against. The spec's first draft relied on the merge and the final review caught it. Nothing in `srs.ts` moves. See `docs/superpowers/specs/2026-11-04-carried-over-reviews-design.md`.

**A day serves at most 88 review-phase words, and a day that holds any back learns no new words** (`reviewCap`, `heldBack` in `queue.ts`; 设置's 每日复习上限). Asked for on 2026-11-05. The carried-over rule kept new words off a backlog, but the already-scheduled reviews alone reached 124 by the third day of a two-day gap and 290 within a week. The cut takes the review block after spacing, and never the learning block. Simulated on the live progress at 92.6% retention, two missed days take one capped day and are cleared on the second day back. Seven take five capped days, are cleared on the sixth, and get the full 12 new words again on the seventh. A capped day was 94–108 cards. **The counter is `DailyStat.reviewWords`, not `reviewPhase`.** 困难 brings a word back to confirm while it is still in the review phase, and 重来 there grades it again. So `reviewPhase` counts one word twice, which is enough to start the cap binding mid-day and take the new words with it. `grade` counts a review-phase card only when it was due by that day. Every recompute gives the same answer, on 今日 and on each mount of 复习, because spent plus remaining is constant all day. New words go to zero whenever anything is held back. `carriedOver` counts `due < today` and the review block counts `due <= today`, so on a day of 5 carried plus 85 due, the carried-over rule alone would have served 7 new words after the 88. See `docs/superpowers/specs/2026-11-05-daily-review-cap-design.md`.

**No interval is longer than 21 days unless the user says so (`MAX_INTERVAL_DAYS`, 设置's 最长间隔), and how long the gap is matters where how the schedule got there does not** (2026-11-12). Asked as "what can our data tell us". On 5,647 due review-phase grades, by the real gap since the previous review: 95.5% remembered at 4–7 days, 92.2% at 8–14, 88.1% at 15–30, 68.9% at 31–60, 43.1% past 60. A fitted curve, `(1 − 0.043) · exp(−(t / 67.3)^2.33)`, gives the gap a word last survived an exponent of 0.024: at the same 15–30 day gap, words whose previous gap was 4–14 days kept 88.6% and words whose previous gap was 15 or more kept 87.0%. The first reading, "growth is too fast at long intervals", was that fact seen through a ratio, and the fix it suggested (taper the growth) was a slower road to the same long gaps. Three things follow. **`intervalModifier` is the wrong lever for retention**: at 1.0 it slows the 1-to-7-day intervals, where the 4.3% of misses are confusions and not decay, for 30% more minutes a day. **Below 21 days the gain stops**: per 1,000 words the ceiling at 21 costs 19.5 minutes a day against 17.5 at 100 and takes "recallable at a random moment" from 79.9% to 94.2%, and at 14 it costs 24.9 for 95.1%. **21 is also `MATURE_INTERVAL_DAYS`**, so a word at the ceiling must land on exactly 21, never 20, and the setting (`settings.maxIntervalDays`, 21 to 100, read through `clampMaxInterval`) has 21 as its floor as well as its default. Lowering the setting does not move words already scheduled past it; `scripts/pull-back-intervals.ts` does. The weak point is the 0.024: hard words get short intervals, which hides strengthening, and 110 days cannot show a fifth pass at three weeks. The spec says what measurement would move the number (`docs/superpowers/specs/2026-11-12-interval-ceiling-design.md`). At a 21-day ceiling the default cap of 88 carries about 1,340 words, so the user's `reviewCap` has been 120 since that day.

**The review log exists: it is the data repo's commit history.** `progress.json` holds only each word's current state, which is why "what interval was this lost at" could not be answered until the forget log. But the app syncs after every sitting, and 3,011 commits to `progress.json`, diffed pair by pair on `lastReviewedAt`, give every grade with the entry as it stood before and after: the grade (from `lapses` and `ease`), the real gap, the interval it replaced. Check any such reconstruction against the app's own counters before trusting it (91.8% retention against `reviewPhase`'s 91.4% here), and **back-test a simulator on the last 30 real days before reading its forecast**: the first one gave each word its own decay rate from its ease and predicted 231 lapses where there were 171.

See `docs/superpowers/specs/2026-08-09-quiz-demotion-design.md` and `docs/superpowers/specs/2026-08-25-recall-rating-design.md`.

## Content rules

`docs/word-entry-spec.md` is authoritative for the shape of an entry. These are the rules that cost something to rediscover:

**Five example sentences per word, always.** The cloze prompt is drawn at random from them, so fewer means repeating the same prompt for the same word sooner. They must carry a concrete scene — textbook-flat filler is the one thing the user reliably rejects.

**Render only the sense `meanings[0]` describes.** `buildSentenceQuestion` sets `hint` to `meanings[0].en` and nothing else, so a rendering of a secondary sense tells the learner the answer is a different word than the one being asked. This bites because a word's five examples are written to *cover* its senses — an instruction like "pick two examples showing different situations" walks straight into the secondary sense on the 236-of-843 words that have one. It is a content rule and not a validator rule because nothing in the data tags which sense an example illustrates. Measured: handing each authoring agent an `ONLY_THIS_SENSE` gloss plus an `other_senses_DO_NOT_RENDER` list took the drift rate from **15% (9 of 60) to 0.09% (1 of 1,119, itself a false positive)** — from one paragraph in the brief.

**An antonym hangs off a word, not off a sense, and 发散's 反面 axis is where that shows.** A concept prompt names one sense; a member carrying two brings the antonyms of both. 一路不松劲,压力再大也不改口 drew `relentless` through its 坚定 sense and then accepted `intermittent` and `sporadic`, which answer its 持续不断 one — two of three answers about a sense the prompt never named. Read over all 31 opposite questions: **9 had at least one stray and 4 were mostly strays**, and the culprits are a handful of double-life words (`relentless`, `reactive`, `callous`, `ostentatious`, `agreeable`, `inert`), not badly authored concepts. `Concept.excludeOpposites` bans *answers* on that axis only — not members, because `relentless` is a fine 近义 for 不松劲. **A quorum ("two members must name it") was measured and rejected: 24 of 31 questions have a single-member answer and most are right.** Re-read with `npm run validate-concepts -- --opposites`, which prints every question with the member behind each answer; the validator gates staleness but the sense judgement is human.

**A synonym joins every word that lists it, so it has to mean the same thing on each.** It is the antonym rule above, pointed at `synonyms`: the contrast-pair graph and 发散 membership are both built from shared synonym strings, so one homograph manufactures pairs between unrelated words and walks words into answer sets — `deliberate` on `premeditated` (adj.) and on `ponder` (v.), `still` on `that-said` and on `motionless`, `stubborn` putting `dogged` into 认死了自己那套. Measured 2026-10-01: 24 cut by hand from 116 new words, then a Jev pass over the 716 older pairs joined only by a shared synonym (calibrated on those 24 cuts: 86% precision, 42% recall — it finds the pure noise, not the near-misses) led to 58 more cuts and 1588 → 1459 pairs. Twelve concept `exclude`s had been patching these same synonyms one symptom at a time. **Check the concept a synonym anchors before cutting it**: `commensurate`'s concept is built on `equivalent` alone, and four concepts (intrinsic, thwart, precarious, fickle) reached three members only through a member that did not fit. They were retired rather than kept standing on a stray (82 → 78).

**A card's 近义词 row is derived, so a partner missing from it is not a data gap.** `cardSynonyms` shows the entry's own list, the words that list it, and the words that share one of its synonym strings *and* a gloss term under the same part of speech (applaud and acclaim, both on `laud`, both 称赞 — a user report, 2026-11-09: 223 such pairs, 330 cards). Don't write a headword into `synonyms` just to make it appear on a card; that string joins every other word listing it. `check-links` covers the other case, pairs the graph does not join at all.

**A 发散 prompt is the members' intersection, never their union.** Same disease as the antonym rule above, pointed at the prompt instead of the answers — and it costs more, because a stretched prompt is read on every play of the question while a stray answer is only met by whoever produces it. 对眼下的处境和上头攒着一肚子意见 ran 16 characters against a median of 12 and the user's verdict on reveal was "其实就是不满意的意思": 上头 was carried by `disaffection` alone (离心,对当权者失去拥护) and 处境 by `discontent`, while `dissatisfaction` has neither. The three share 不满 and nothing else. **Also name what the axis asks for, not the operation it looks like** — the label 〔加否定〕 read as "now give me the opposite" beside 〔反面〕 in the same round, when every answer on that axis *means* the prompt and merely carries a prefix. It is 〔否定前缀〕, and the instruction leads with 同样的意思.

**形近 pairs are computed from spelling, and the gloss rule is what makes that safe.** `buildLookalikePairs` (src/lib/lookalike.ts) needs no curation because a loosely alike pair only costs targeting: no gloss term may be shared across either word's meanings, so the partner's meaning is always a wrong answer. Extend that rule to every option on the card, not just the pair — the first round played offered presage's 预示;预兆 as the trap and another word's 预示,预兆 as a filler, and two options meaning one thing eliminate each other. The frame test (opening plus ending covering two thirds of the longer word) is what separates `allude`/`elude` from rhymes like `devious`/`tedious`; it also runs before the edit-distance table, which took round generation from 1,150 ms to 47 ms over 1,549 words. See `docs/superpowers/specs/2026-10-29-lookalike-quiz-design.md`.

**Verb forms: spelling rules spell, `src/data/verbForms.json` decides, and the IPA is not a stress source.** The entry page's 动词变形 (collapsed by default) shows past and past participle for single-word verbs only; the user cut the -ing and -s forms and the phrases on first sight. Whether a word of two or more syllables doubles its last consonant turns on stress, and reading stress from `phonetic` got 5 of 37 wrong (syllabic /n/ in `hearten`, /aʊɚ/ in `empower`, the compound `deadpan`). So those 33 decisions and the 4 irregular verbs are authored, and a verb that needs judgment and has no entry shows nothing. `validate-verb-forms` checks every -ed/-ing occurrence in a verb's own examples against its forms (793 across 284 verbs), and that is what catches a wrong `double`. See `docs/superpowers/specs/2026-11-06-verb-forms-design.md`.

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

**Do the Chinese yourself.** Two rounds of sharpening the brief never got the register — the output stays translationese. It is the half the user reads every session and the half no validator sees. Budget for editing it, not for prompting it. That was measured on Gemini. Since 2026-10-01 the word-content skill tries Sonnet drafting the Chinese with the orchestrator rewording it line by line, on probation: the commit records the reword rate per category, and above 1 in 4 that category comes back to the orchestrator. The first batch (30 words, 2026-10-01) reworded 3–10% per category, so the split stands; what still needs a person is the synonyms — six homographs got through a rules file that warned against them.

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

Mobile-first; **375px is the design width** and layouts must not overflow it. The look is **朱批** (since 2026-09-23; `src/styles/tokens.css`, spec `docs/superpowers/specs/2026-09-23-zhupi-redesign-design.md`): the marks a Chinese reader makes in a book, on 月白 paper in 墨 ink. **Cinnabar (`--accent`) is for marks only** — 勾 / 叉 / 圈, the 波浪线 under a headword in its example, 着重号 on the active tab, the 旁批 usage note, and destructive actions — never a heading color or a decorative fill. Correct is 石青 blue, not green.

The ink-and-paper look it replaced had drifted into the generic default: cream ground, serif-plus-vermilion, identical rounded shadowed cards, tracked all-caps English eyebrows, monospace digits, ` · `-joined meta. **Don't reintroduce those** — they read as template on sight.

**Pages are built from the vocabulary in `components.css`, not from cards** (round 2, spec `docs/superpowers/specs/2026-09-23-zhupi-round2-design.md`): `.section` + `.section-head` (a ruled head), `.ledger` (ruled rows: main/value or label/value), `.readout` / `.readouts` (a number over its label; 界栏 hairlines between cells, never around), `.key` (a printed shortcut), `.ruled-row` (复习's grade row, shared by 练习 and 回想), `.margin-note` (the 旁批), `.mark-tick` (勾), and `StateDot`'s shapes — hollow ring 未学, half ring 学习中, solid dot 已掌握 (the two solid dots told state by color alone until then). Quiz result pages use `QuizResult.tsx`'s `ResultScore` and `MissedWords`. **A `.card` survives only as the flip target, a self-contained prompt, or something that floats**, and says which in a comment.

**Every `var(--accent)` in `src/pages/*.css` and `src/styles/*.css` carries a `/* mark: … */` comment naming the mark it draws.** `grep -n "var(--accent)" src/pages/*.css src/styles/*.css | grep -v "mark:"` must print nothing (33 hits, 0 unnamed, 2026-11-06).

**Charts take `--chart-1` 黛紫 then `--chart-2` 赭石, never cinnabar and never a status color.** Both passed the dataviz skill's `validate_palette.js` on all four grounds — `#ECF0EF`, `#F7F9F8` light, `#15181B`, `#1C2024` dark; worst CVD pair ΔE 25.1 light / 23.5 dark. Change either value and re-run all four. A state breakdown (掌握分布) is status and keeps `--state-*` with text labels. The one cinnabar thing a chart carries is the today tick on its time axis.

**UI text is Chinese punctuation.** No ` · ` joins (0 left in UI code, from 39), and , : ? ! ; ( ) beside a CJK character are full-width (172 commas and 88 others converted on 2026-09-23; `「」` quotes a term). Two exceptions are deliberate: AddWord's `[,，、]` split regex, and the etymology example `ab-(离开) + rogare(提议) → 废除`, which shows the data's own format. A label and its key is the label plus a `.key`, not `提交 · Enter`. Study content (`meanings[].zh`, `wordNotes.json`, …) still uses half-width punctuation — changing it is content work, a separate decision.

**Light and dark are a 设置 choice (外观: 跟随系统 / 浅色 / 深色), per device.** The dark palette is `:root[data-theme='dark']`, not a media query; `src/lib/theme.ts` decides the attribute, and `index.html` makes the same decision inline before first paint — change the two together. The choice lives in `localStorage` `volcab.theme`, outside `storage.ts`'s `KEYS`, so logout does not reset it.

**Both serif faces are bundled** (fontsource, `src/main.tsx`) because the user reads on Windows and Android, which ship no usable Song face. They load as `unicode-range` slices and are runtime-cached, never precached: a cold 今日 costs 1,358 KB of the CJK face's 6 MB. Latin glyphs come from Source Serif 4, CJK falls through to Noto Serif SC; `:where(p, li)[lang='en']` gets `--lh-latin`, because Song's 1.75 leading reads double-spaced on English.

**A page stylesheet ties with `components.css` on specificity and wins by load order.** `.quiz-q__prompt` quietly overrode `.word`'s size for the word2meaning headline until 2026-09-23. When a page class and a component class share an element, restate the property on the compound selector.

Correctness must never be conveyed by color alone — quiz options carry a text tag as well as a color, for colorblind users and screenshots.

Keyboard shortcuts must be printed on the control they trigger. An undocumented shortcut does not exist.

## Gotchas

- **vitest excludes `.claude/worktrees/`** (see `vite.config.ts`). Background tasks check out the whole repo there; without the exclusion the suite runs twice and another branch's failures are attributed to yours.
- `tsconfig.app.json` enables `strict` (measured clean on 2026-09-01) but **not** `noUncheckedIndexedAccess` (503 errors on the same day). Indexed access is typed as present; guard it by hand.
- `noUnusedLocals` is on: an unused import fails the build, including a type-only one.
- Chinese full-width punctuation inside a PowerShell here-string is fine, but double quotes in a commit message body will break `git commit -m @'...'@`.
- **`Volcab.enex` is a personal note file and this repo is public.** It is gitignored and has never been tracked. Never `git add` it.
- **A commit id that does not resolve is probably from before 2026-11-13.** Six commits carried a personal email address in this public repo, so the 197 commits from 2026-09-12 on were rewritten that day (same trees, dates and messages; only the identity changed) and force-pushed. The ids cited in tracked files were updated; 11 commit messages on master still cite the old ones. Match by date and subject. Commit only under the GitHub noreply address: `git config user.email` must not print a real mailbox.

### Browser and UI debugging

- **Handling a key on keydown and moving focus in the same handler is the dangerous combination.** Chrome activates a focused button on the **keypress**, delivered to whatever holds focus when it is dispatched — not to the element that got the keydown. 组句 submitted on keydown, disabled the input and focused 下一题 in that same handler, so the rest of the press clicked 下一题 and the verdict lived 0.7ms. The fix is one `e.preventDefault()` on the keydown. 拼写 is safe because it submits through the form's *implicit submission*, which **is** the keypress's default action; 回想 is safe because each auto-focused button consumes its own keypress before handing focus on.
- **`mcp__Claude_Browser__computer` cannot activate a button by keyboard at all** — its synthesized key events carry no default action, so a focused button scores zero clicks on Enter and on Space. Every negative result it gives about keyboard activation is an artifact. `mcp__chrome-devtools__press_key` dispatches the real thing. **Prove the tool can reproduce a mechanism before trusting it to disprove one.**
- **HMR lies.** When behavior does not change after an edit, force-refresh before concluding the fix did nothing.
- **For screenshots, use `mcp__chrome-devtools__take_screenshot`, not the Browser pane's.** Measured 2026-09-23: the pane's screenshots time out, come back stale after a hash navigation, or tile 2×2 after a scroll. chrome-devtools is reliable and can save to a file. Its `emulate` resets whatever you omit — pass `viewport` *and* `colorScheme` every call, or a color switch drops you to 1440px and reloads the page.
- **`:not()` counts its argument's specificity.** `.chip:not(.chip--static):not([aria-disabled]):hover` is four classes and beat `.chip[aria-pressed='true']`'s two, so a pressed chip under the pointer — or after a tap on Android, which keeps `:hover` — drew ink text on its ink slab. The first fix, restating the pressed rule with `:hover`, is three and still lost; it shipped in a commit as fixed and a reviewer caught it. Exclude the state from the hover rule instead (`:not([aria-pressed='true'])`), and verify with a real pointer: chrome-devtools `hover`, then read the computed `color` — no screenshot at rest can show this bug.
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
- **Play a scenario in 演示模式, not on the live library.** The dev build's login page has a demo mode. It loads the bundled `data/words.json` and boots whatever `volcab.progress` holds in localStorage, and it never touches the network. In an isolated chrome-devtools context (`new_page` with `isolatedContext`), seed `volcab.progress` by script with the state you need, then click 演示模式. 120 review words due was how the review cap was played on 2026-11-05 without one real grade. The plan for that change had said there was no mock mode, and it would have asked the user for permission to grade their real words.
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

Commit in small, self-contained steps, with a message that leads with the finding or the reason — not just the change. **Every number in a commit message comes from a command run for it, not from memory**: twice on 2026-10-01 a count written from recollection was wrong in a pushed commit (0.73M Jev tokens for 0.43M, 166 excludes for 137) and needed a correction in the next one.
