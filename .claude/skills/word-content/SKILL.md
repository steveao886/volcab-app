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
| `src/data/senseGroups.json` | scenario `zh` | optional: word with ≥2 same-POS partners → candidate group | `npm run validate-sense-groups` |
| `src/data/passages.json` | `{{id}}` markers | optional coverage | `npm run validate-passages` |
| `src/data/suggestions.json` | — | nothing — self-filters at runtime | `npm run validate-suggestions` |
| `data/wordlist.json` | — | dead file, referenced by nothing. Do not touch | — |

All these gates run in CI (`npm run validate` chains all eight;
`.github/workflows/deploy.yml` runs it, plus `npm run lint`, on every push to
`master`). Coverage lines are still printed text, not exit codes — read them
yourself.

## Adding words

1. **Author entries** per `docs/word-entry-spec.md` (authoritative): 5
   examples each containing a locatable headword form, `usageScore` 1–10,
   `share` only when polysemous, `etymology` omitted rather than guessed.
2. **Repo copy first**: write `data/words.json`, run `validate-words`, then
   `npm test` (full-library regression). If a headword can't be located in
   its example, rewrite the sentence — never loosen `headword.ts`.
3. **Diff the pair set** (whole batch at once — two words added together can
   pair with *each other*; per-word passes miss it). The ready-made script
   is in `docs/word-add-checklist.md` §5 step 6: it prints the new
   contrastNote keys and the ids newly needing a 要点.
4. **Author the top-ups**: contrast notes (Chinese, ≤160 chars, states what
   separates the two), word notes (Chinese, ≤80 chars, **never names
   another library headword**). Run both validators; coverage must read X/X.
5. **Sense groups**, if the new word has ≥2 same-POS confusable partners:
   one scenario sentence (Chinese only — a single Latin letter is a leak,
   the validator rejects it), a `target` (the chunk of the sentence being
   asked — must appear in `zh` exactly once, ≤16 chars, no Latin; without
   it the learner cannot tell which part of the sentence to express), the
   ranked `order`, a `why` naming the deciding dimension. Adapt the
   scenario from a member's real example sentence; **if no sentence makes
   one member clearly best, skip the group** — an arguable key is worse
   than no question.
6. **Live library**: pull `volcab-data/words.json` fresh, apply additions on
   top (never overwrite — resurrecting deleted words is a real recorded
   failure, commit `f53adb9`), trim promoted entries from `staging.json` by
   headword.
7. **Ship**: `npm test && npm run build && npx oxlint`, commit the word list
   and its notes together — they are one change.

## Batches of 6+ words: fan out the authoring

Measured on the 24-word batch of 2026-08-14: ~25 minutes end to end, and
the two *authoring* stretches (entries ~8 min, notes ~7 min) were the bulk
of it. Both are embarrassingly parallel — entries never reference each
other, and each note depends only on its own pair — so for a batch of 6 or
more words, dispatch authoring to parallel subagents:

1. **Fan out entry authoring.** Split the staged headwords into chunks of
   ~6 and launch one general-purpose subagent per chunk, in a single
   message so they run concurrently. Each prompt must be self-contained:
   paste the entry rules from `docs/word-entry-spec.md` (5 located
   examples, 12–30 words each, usageScore, share rules, etymology-or-omit),
   the exact JSON shape of one recent entry, and the chunk's headwords.
   Have each agent return a JSON array; the orchestrator concatenates.
2. **Pre-check centrally, never per-agent.** Run the merged array through
   the locate/mismark/word-count pre-check (headwordPattern +
   isInflectionOf over every example) *before* touching `data/words.json`.
   Send any failing entry back to a fresh agent with the specific failure;
   do not let an agent self-certify.
3. **The pair diff is the one barrier.** It needs the *whole* batch in
   `data/words.json` first (batch members can pair with each other), so it
   cannot overlap with step 1. Run it once, centrally.
4. **Fan out note authoring.** Partition the new pair keys into chunks
   (~10 pairs each), and give every agent the full zh/en definitions of
   both words in each of its pairs — the note must state a real
   distinction, and an agent without the definitions will invent one. Word
   notes ride along in the same chunks. Merge, sort keys, validate
   centrally.
5. **Everything after the notes stays serial**: validators, `npm test`,
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
coverage gaps, same-POS candidate triples with no sense group, and the
passage corpus size. Exit code 0 with `FRESH` means nothing is owed — stop
there, do not invent work.

For each gap it names, author under the same rules as steps 4–5 above, run
the matching validator, and commit with a message that leads with the
measured gap (e.g. "12 candidate triples had no sense group"). Sense-group
authoring at scale: mine candidates with the triple logic in
`scripts/content-staleness.ts`, draft from members' real examples, fail
closed on any group whose second place is not defensible.

**Never** pad content to hit a number. A skipped group costs nothing; a
wrong answer key or an invented etymology poisons the mode that shows it.
