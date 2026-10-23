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
| `src/data/passages.json` | `{{id}}` markers | optional coverage — **but the word joins tier-1 distractor pools silently; diff and vet** | `npm run validate-passages` |
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

**`passages.json` has the same shape of hazard, pointed at distractors.** A
passage's tier-1 distractors are the shared-synonym neighbours of its blanks
— derived, not listed — so a new word joins them with nothing authored, and
there it is worse than a stray 发散 answer: offered as a *wrong* option, a
word that also fits the blank marks the learner wrong for a right answer.
The passage's `exclude` array is where that judgment goes (step 3).

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

   **Then look for the links nobody wrote**: `npm run check-links --
   --ids <id,id,…>` lists same-part-of-speech pairs that share a Chinese
   gloss term but are joined by nothing, with Jev's guess at whether they
   are interchangeable — useful on adjectives (84% precision at 0.9),
   close to useless on verbs and nouns (2 of 7), where it is fooled by a
   shared secondary sense. It is the
   opposite failure to a homograph and costs the same thing: the contrast
   graph is what keeps a second right answer out of the options, so with
   `ravishing` and `captivating` unjoined, "the opposite of hideous" could
   offer one beside the other. Read every line; link only what a quiz
   would have to accept, by writing the partner's headword into one
   side's `synonyms` — **the side whose other listers belong with the new
   partner**, because the string joins all of them (`madden` onto
   aggravate, never `aggravate` onto madden, which joins it to
   exacerbate; `negligence` onto oversight, never `oversight` anywhere,
   because the string also means supervision). 2026-10-13, whole library:
   55 of 226 candidates linked (40 of 155 sharing a term of three
   characters, 15 of 71 sharing only two); of the first 40, 15 touched
   the 125-word batch before it, the rest were older gaps. Linking adds
   pairs, so it adds notes — run it before step 4.

   **Last, diff the passage distractor pools**, after the synonym cuts
   (each cut changes the pools): `npx tsx scripts/passage-pool-diff.ts`
   prints every word this batch adds to a passage's tier-1 pool, with the
   blank it neighbours and that blank's sentence. Ask of each line only
   whether the word, put in that blank, would also be correct; if so, add
   it to that passage's `exclude`. 2026-10-12: 65 new entries from 125
   words, and **47 would have been a second right answer** — *a common
   {{snag}}* for impediment, *began to {{madden}} everyone* for
   exasperate. The 18 kept could not fit their slot: a noun offered for an
   adjective blank, *for time {{immemorial}}*. Fail closed when unsure —
   an excluded word costs one distractor among many; a fitting one is a
   question that marks the right answer wrong.
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
| Sense groups | Sonnet drafts with a standing order to skip; orchestrator reads every key | an answer key. At backlog scale (136 candidates, 2026-10-01) Sonnet skipped 36 and review dropped 3 more — two repeated a scene already used, one ranked on a distinction the scene could not carry. Below ~10 groups, write them yourself |
| 组句 cuts | Sonnet drafts ~115 words a file in `chunk-append` shorthand, blank pre-located; orchestrator reads every line rendered as `a | b [word] | c` | 2026-10-01: 29 of 574 changed — mostly a phrase cut in half or an opening adverbial glued to the subject. The rules file must say **no two chunks may trade places**: `gradeOrder` is exact, so a movable time phrase marks a correct order wrong |
| Passages | Sonnet drafts, one setting **assigned** per group; orchestrator reads all and every distractor pool | given a list of suggested settings, six agents converged on it — 4 night markets, 3 glacier surveys in 29. Mark ~4 new words beside ~6 the learner has learned (live `progress.json`), or the passage sits behind the one-third unlearned gate. Say `en`/`zh` are **arrays** of sentences — unsaid, all six wrote paragraphs |
| 近义词 paragraphs (`synonymNotes.json`) | Opus drafts (`model: "opus"`), ~30 groups an agent, from a rules file that quotes the last round's reworded sentences back; orchestrator reads every paragraph against each member's carrying sense | Sonnet went over the probation line on the first batch (2026-10-23, 30 groups): 10 of 30 reworded, 22 of 93 clauses, 2 of 15 from one agent and 8 of 15 from the other — usage claims stronger than the examples (`notwithstanding` 多见于法律公文 with no legal example among five), wrong nuances (`officiate` as a wedding's 司仪, who is not the officiant), a collocation that misleads out of its sentence (*discourage students from camping*), translationese (被价值感填满). The other 296 went to ten Opus agents with those sentences quoted back: 9 reworded (3.0%), 10 of 983 clauses. Four of the nine pointed at the 例句 or 定义, which the page never shows — the brief must say so; three were evidence phrases that read wrong alone (*degraded women*). The drafters also flagged notes their own examples contradict (`rapturous` 几乎专配 applause; `antipathy`'s two notes), which is worth asking for by name |
| Concept membership and passage-pool diffs (step 3) | orchestrator | lines of pure judgment, each against one prompt or one sentence |
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
   cannot overlap with step 1. Run it once, centrally — and the 发散 and
   passage-pool diffs of *Adding words* step 3 with it, since all three
   read the same finished synonym lists. The pool diff can run while the
   note and rendering agents work; it touches only `passages.json`.
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
   would have marked the best fit second. **And check the target against
   the promoted word's own gloss**: an `extra` is offered as a wrong option
   long before it is a library word, so a target that *is* its gloss is
   already a live wrong answer. 2026-10-12 found two — 231 asked 值得称赞
   (praiseworthy's gloss) for `laudable`, 282 asked 诱人 (enticing's) for
   `tantalizing` — and one scene that fit the extra best outright (240,
   配件停产, `obsolete` behind `outmoded`); the first two were retargeted
   to their answer's own sense, the third reordered.
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

Once per refresh, also run `npm run check-senses`, `npm run
check-synonyms` and `npm run check-links` with no ids — the whole
library, ~340k Jev input tokens for the first two and ~80k for the third,
under two cents each. None is in the scan because they need a key and the
network; read their output like steps 3 and 5. After the 2026-10-01
cleanup a full synonym run still flags ~70 pairs (71 on 2026-10-13) —
mostly close words read and kept that day; cut only what reads two ways.
**When the string that reads two ways is itself a headword, move the edge
instead of cutting it**: `diaphanous` and `precipitous` both listed
`sheer`, one for the fabric and one for the cliff, and cutting it from
diaphanous alone would lose a real pair — so diaphanous dropped `sheer`
and sheer listed `diaphanous`.

**Never** pad content to hit a number. A skipped group costs nothing; a
wrong answer key or an invented etymology poisons the mode that shows it.
