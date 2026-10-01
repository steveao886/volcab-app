---
name: word-content
description: Use when adding words to the volcab library, or when topping up authored study content (contrast notes, word notes, sense groups, passages) — covers the full sync checklist a new word obligates and the periodic content-refresh procedure. Trigger phrases; 加词, 添加单词, 补题, refresh content, top up notes, monthly refresh.
---

# Word & content maintenance

Two jobs, one procedure. **Adding a word** creates holes in the authored
content files; the **periodic refresh** finds and fills the same holes plus
grows the question pools. Evidence for every rule: `docs/word-add-checklist.md`.

## The map (memorize this table)

| File | Keyed by | On a new word | Gate |
|---|---|---|---|
| `data/words.json` (repo copy) | — | **required, FIRST** — every validator reads this path hardcoded | `npm run validate-words` |
| `volcab-data/words.json` (live) | — | **required** — what the app reads; merge onto a fresh pull, never overwrite | — |
| `src/data/contrastNotes.json` | `idA\|idB` sorted | **required**: median 1, up to 11 new pair keys | `npm run validate-contrast-notes` |
| `src/data/wordNotes.json` | word id | **required**: 1 + up to 3 for partners newly confusable | `npm run validate-word-notes` |
| `src/data/senseGroups.json` | scenario `zh` | **required, one of two legs**: a word with ≥2 same-POS partners is covered by the group it joins | `npm run validate-sense-groups` |
| `src/data/recallSentences.json` | word id + example `i` | **required, the other leg**: 5 Chinese renderings for any word no group covers | `npm run validate-recall-sentences` |
| `src/data/sentenceChunks.json` | `(src, id, i)` | optional coverage, no floor | `npm run validate-sentence-chunks` |
| `src/data/passages.json` | `{{id}}` markers | optional coverage | `npm run validate-passages` |
| `src/data/concepts.json` | derived from `synonyms` | **nothing to author** — but the word joins existing 发散 answer sets silently; diff and vet | `npm run validate-concepts` |
| `src/data/suggestions.json` | — | nothing — self-filters at runtime | `npm run validate-suggestions` |
| `data/wordlist.json` | — | dead file, referenced by nothing. Do not touch | — |

All these gates run in CI (`npm run validate` chains all nine;
`.github/workflows/deploy.yml` runs it, plus `npm run lint`, on every push to
`master`). Coverage lines are still printed text, not exit codes — read them
yourself.

**`concepts.json` is the odd one and the easy one to forget.** A concept does
not list its members: it lists synonym *keys*, and the members are whatever
words currently carry them. So a word added today walks into existing 发散
questions with nothing re-authored — which is the design working, right up
until it drags in a word that does not belong in that answer set. That
judgment is what the concept's `exclude` array records, no validator can make
it, and nothing prompts for it unless the membership is diffed across the
batch (step 2–3 below).

## Adding words

1. **Author entries** per `docs/word-entry-spec.md` (authoritative): 5
   examples each containing a locatable headword form, `usageScore` 1–10,
   `share` only when polysemous, `etymology` omitted rather than guessed.
2. **Snapshot 发散 membership first, then write the repo copy.** Before
   touching `data/words.json`:
   `npx tsx scripts/content-staleness.ts --concepts > before.txt`. Then write
   `data/words.json`, run `validate-words`, then `npm test` (full-library
   regression). If a headword can't be located in its example, rewrite the
   sentence — never loosen `headword.ts`.
3. **Diff the concept membership** (发散, whole batch at once — two words
   added together can join the same concept; per-word passes miss it):
   `npx tsx scripts/content-staleness.ts --concepts | diff before.txt -`.
   **Read every `>` line.** Each is a word this batch put into an existing
   answer set; if it does not belong there, add it to that concept's
   `exclude` and re-run `validate-concepts`. Usually the answer is "it
   belongs" and there is nothing to do — the cost of the check is reading a
   handful of lines, the cost of skipping it is a 发散 question that marks a
   correct answer wrong, or accepts a wrong one.

   **Then read every pair the batch joins through a shared synonym** (not
   a direct one) before authoring notes for it — `npm run check-synonyms
   -- --ids <id,id,…>` asks Jev about each and prints the suspicious ones
   grouped by synonym; it finds the pure noise (86% precision) but not all
   of it (42% recall), so it orders the reading, it does not replace it. A synonym connects every
   word that lists it, so a homograph — `perceptive` on `observant` (sees
   details) and on `sentient` (can perceive at all) — manufactures a pair
   of unrelated words and walks words into 发散 answer sets they don't
   belong in. Cut the synonym from the entry where it means something
   else. 2026-10-01: 24 cut across 116 new words (0.26 per word before the
   rules file quoted the cuts back at the drafter, 0.16 after — never
   zero). **Before cutting, check the concept the synonym anchors**: some
   concepts are built on one synonym, and cutting it can take a word out
   of its own concept (`commensurate` via `equivalent`).
4. **Ask what the batch owes**, naming its ids:
   `npx tsx scripts/content-staleness.ts --batch <id,id,…>`. It exits 1 while
   anything required is missing, and reports 反义 without blocking. Then
   author the two note files: contrast notes (Chinese, ≤160 chars, states
   what separates the two), word notes (Chinese, ≤80 chars, **never names
   another library headword**). Run both validators; coverage must read X/X.
5. **回想 is required, and has two legs — either clears it.**

   **A sense group**, when the word has ≥2 same-POS confusable partners: one
   scenario sentence (Chinese only — a single Latin letter is a leak, the
   validator rejects it), a `target` (the chunk of the sentence being asked
   — must appear in `zh` exactly once, ≤16 chars, no Latin; without it the
   learner cannot tell which part of the sentence to express), the ranked
   `order`, a `why` naming the deciding dimension. Adapt the scenario from a
   member's real example sentence; **if no sentence makes one member clearly
   best, skip the group** — an arguable key is worse than no question.

   **Or five renderings** in `recallSentences.json`, one per example index:
   `{ "id": …, "i": 0, "zh": …, "target": … }`, `zh` with **zero Latin
   letters** (proper nouns carried over from the English — Slack, Q4, CEO —
   are the usual leak), `target` Chinese, ≤16 chars, appearing in `zh`
   exactly once. Five, not one: the draw repeats a word, and a repeated
   sentence tests the sentence.

   A skipped group does **not** excuse the word — it falls back to
   renderings like any other. The legs are alternatives, not a choice
   between doing the work and not.

   **Then check the `sense` tags**: `npm run check-senses -- --ids
   <id,id,…>`. A rendering about a secondary sense needs `sense`, or its
   hint describes a different meaning; the tag is easy to get wrong by
   part of speech (`harangued` tagged as the noun), and 40 of 904 were,
   2026-10-01. The script asks Jev which sense each English example uses
   and prints three bands. A *confident disagreement* was a wrong tag 33
   times in 34; a *doubtful disagreement* was Jev wrong most of the time
   — a tag just corrected from noun to verb can land here, so leave it;
   an *unsure agreement* was a wrong tag 3 times in 93, every one a noun
   tagged as its verb or adjective. Read every line, fix only what is
   clearly wrong, and don't re-run to make a line disappear — the
   doubtful bands move between runs. Needs
   `TYPESAFE_API_KEY` in `.env.local`; without it, say so and read the
   tags on polysemous words by hand.
6. **Live library**: `npm run check-live` to pull and diff against the repo
   copy, apply additions on top of the live file (never overwrite it with
   the repo copy — resurrecting deleted words is a real recorded failure,
   commit `f53adb9`), trim promoted entries from `staging.json` by headword,
   then `npm run check-live` again to confirm the two agree. (`--write` runs
   the opposite direction — repo copy from live — and is the repair for a
   stale repo copy, not for pushing new additions.)
7. **Ship**: re-run `--batch` with the same ids and see `nothing owed`, then
   `npm test && npm run build && npx oxlint`, and commit the word list with
   its notes and renderings — they are one change.

## Who writes what

Drafting goes to Sonnet; judgment and every line of Chinese stay with the
orchestrator (run the session on Opus). The split follows where a mistake
can hide: structure has a gate that has caught every error across 420
markers, while the Chinese register and an answer key have none.

| Work | Who | Why |
|---|---|---|
| Entry drafts (examples + `meanings[].zh`) | Sonnet subagent | the locate pre-check and `validate-words` gate the structure |
| Contrast notes, word notes | Sonnet subagent | given both words' full definitions, as before |
| 回想 renderings (5 per word) | Sonnet subagent | the largest volume of Chinese in a batch |
| Reading and editing **all** of the above Chinese | orchestrator | the half the user reads every session; no validator sees it |
| Screening shared-synonym pairs for homographs | Jev, via `npm run check-synonyms` | the orchestrator reads the flagged hubs and decides each cut |
| Screening renderings' `sense` tags | Jev, via `npm run check-senses` | an English one-of-N judgment — its shape exactly; the orchestrator reads ~17% instead of all |
| Sense groups | orchestrator | an answer key; small volume, fail-closed judgment |
| Concept membership diff (step 3) | orchestrator | a handful of lines of pure judgment |
| Validators, tests, build, live merge | orchestrator, by script | mechanical — no model work to move |

**The split is on probation, and the edit rate decides it.** CLAUDE.md's
"do the Chinese yourself" was measured on Gemini; Sonnet drafting Chinese
for review is untested. While reviewing, count per category how many
drafted items you changed in wording (punctuation-only fixes don't count)
and put the counts in the commit message, e.g. `Sonnet drafts: renderings
40, reworded 6; notes 22, reworded 3`. **A category reworded at more than
1 in 4 goes back to the orchestrator** — edit this table, with the numbers.

First batch, 2026-10-01 (30 words, `2e3d3e7`): entry zh 3 of 45, contrast
notes 4 of 62, 要点 3 of 30, renderings 4 of 150 — 3–10%, every category
far under the line. The next two (43 + 43 words, `ad632d3`, `bc2addf`)
held it: entry zh 3 of 120, notes 3 of 142, 要点 1 of 72, renderings 13
of 430 — under 4% everywhere. What was reworded: translationese in renderings, a
collocation parked behind the wrong sense in notes, one false usage claim
(`hasty` "never" of plain speed, against its own *a hasty retreat*), and a
gloss narrowed by connotation (`enchanting` as 妩媚, said of women only).
What review caught that no reworded count shows: six homograph synonyms
that the rules file had warned against.

Spend tokens on authoring, not on reading files:

- **Never read `data/words.json` whole** (1.68 MB, 2026-10-01), nor the
  large `src/data/*.json` (`recallSentences` 578 KB, `contrastNotes`
  296 KB). One read costs more than a batch's authoring. Pull the fields
  you need by id with `node -e`.
- **A subagent reads everything it needs from scratch files, and only
  those** — one rules file per kind of work (the rule excerpt, one sample
  of the output shape), written once and shared by every agent, plus one
  input file per chunk with that chunk's definitions. It writes its JSON
  to an output file and replies with one line, so drafts never pass
  through the orchestrator's context twice.
- **Size chunks by the agent's fixed cost, not by parallelism.** A
  Sonnet subagent costs ~80k tokens before it writes a line — its system
  prompt and this repo's CLAUDE.md — and the work is small beside it.
  Measured 2026-10-01: entry agents given 6 words used 79–84k with 2–4
  tool calls; note agents given 20–21 pairs and rendering agents given 10
  words used 82–85k. Doubling the work moved the cost by ~3%, and that
  round reworded the least (3–10%). Every extra chunk is another ~80k.

## Batches of 6+ words: fan out the authoring

Measured on the 24-word batch of 2026-08-14: ~25 minutes end to end, and
the two *authoring* stretches (entries ~8 min, notes ~7 min) were the bulk
of it. Both are embarrassingly parallel — entries never reference each
other, and each note depends only on its own pair — so for a batch of 6 or
more words, dispatch authoring to parallel subagents:

1. **Fan out entry authoring.** Split the staged headwords into chunks of
   ~10 and launch one general-purpose subagent per chunk with
   `model: "sonnet"`, in a single message so they run concurrently. The
   rules file carries the entry rules from `docs/word-entry-spec.md` (5
   located examples, 12–30 words each, usageScore, share rules,
   etymology-or-omit), the exact JSON shape of one recent entry, the
   no-homograph-synonym rule (`unqualified` under both 不够格 and 无保留),
   and no Latin-script proper nouns a rendering can't carry (Slack, CEO).
   Each agent writes a JSON array; the orchestrator concatenates.
2. **Pre-check centrally, never per-agent.** Run the merged array through
   the locate/mismark/word-count pre-check (headwordPattern +
   isInflectionOf over every example) *before* touching `data/words.json`.
   Send any failing entry back to a fresh agent with the specific failure;
   do not let an agent self-certify.
3. **The pair diff is the one barrier.** It needs the *whole* batch in
   `data/words.json` first (batch members can pair with each other), so it
   cannot overlap with step 1. Run it once, centrally.
4. **Fan out note authoring.** Partition the new pair keys into chunks
   (~20 pairs each), and give every `model: "sonnet"` agent the full
   zh/en definitions of both words in each of its pairs — the note must
   state a real distinction, and an agent without the definitions will
   invent one. Word notes ride along in the same chunks. Merge, sort keys,
   validate centrally.
5. **Fan out the 回想 renderings** in the same message as the notes, for
   every word no sense group will cover: chunks of ~10 words, each agent
   given the five examples, **every** sense (it tags `sense` per example,
   part of speech first) and the rendering rules of step 5 above (zero
   Latin letters — transliterate names; `target` 2–6 chars appearing
   exactly once). Sense groups are not fanned out — the orchestrator
   writes them.
6. **Review every Chinese line before it lands**, counting rewordings per
   category (see *Who writes what*). Contrast notes are read against both
   definitions — is the stated distinction real? Then run `check-senses`
   over the batch (step 5 above) — the drafting agent's `sense` tags are
   the easiest thing in its output to get wrong without looking wrong.
7. **Expect the merge to break content nobody touched**, and fix it by
   reading, not by moving things until the validator is quiet. Every batch
   today did: a sense group carrying a new word as `extra` (move it into
   `order` last only if its `why` already ranks it there and its
   meanings[0] matches the slot's part of speech — `censure` is a noun in
   a verb group and was dropped instead), a 要点 illustrated with a word
   that is now a headword. **Read the scenario before ranking a promoted
   word last**: group 264 asked 小到可以忽略 — which *is* `negligible` —
   with `infinitesimal` as the answer; promoting `negligible` behind it
   would have marked the best fit second.
8. **Everything after the review stays serial**: validators, `npm test`,
   build, live-library merge (sha-guarded), staging trim, one commit.
   These were ~7 min of the 25 and are gates, not authoring — parallelism
   has nothing to win there.

Below ~6 words the subagent spin-up and prompt duplication cost more than
they save; author inline.

## Periodic content refresh (the automated entry point)

Run the staleness scan first; **author only what it names**. The scan is
`scripts/content-staleness.ts`:

```bash
npx tsx scripts/content-staleness.ts
```

It reports, in priority order: contrastNotes coverage gaps, wordNotes
coverage gaps, sense-group anchors not yet covered, words with no 回想
question at all, then 组句, 发散 and passage lines that are printed and never
hold the verdict. Exit code 0 with `FRESH` means nothing is owed — stop
there, do not invent work.

Since 2026-09-21 the 回想 line is **backlog only**: a new word's 回想 hole is
the add flow's to fill before it ships (step 5 above), so this number should
only ever fall. If it rises, a batch shipped without running `--batch`.

For each gap it names, author under the same rules as steps 4–5 above, run
the matching validator, and commit with a message that leads with the
measured gap (e.g. "12 candidate triples had no sense group"). Sense-group
authoring at scale: mine candidates with the triple logic in
`scripts/content-staleness.ts`, draft from members' real examples, fail
closed on any group whose second place is not defensible.

Once per refresh, also run `npm run check-senses` and `npm run
check-synonyms` with no ids — the whole library, ~340k Jev input tokens
each, under two cents each. Neither is in the scan because they need a key
and the network; read their output like steps 3 and 5. After the
2026-10-01 cleanup a full synonym run still flags ~70 pairs — mostly
close words read and kept that day; cut only what reads two ways.

**Never** pad content to hit a number. A skipped group costs nothing; a
wrong answer key or an invented etymology poisons the mode that shows it.
