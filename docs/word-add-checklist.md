# Adding a word to volcab — the complete checklist

Evidence-backed. Every claim cites `file:line` against
`C:\Users\gaosi\repos\volcab` at commit `6eab211` (master, clean), audited
2026-08-07. The sense-group entries were added the same day, when
`src/data/senseGroups.json` landed (see
`docs/superpowers/specs/2026-08-07-recall-mode-design.md`).

The executable face of this document is the repo skill
**`.claude/skills/word-content/SKILL.md`** — a session adding words should
invoke that; this file is the evidence behind it.

Baseline measured while writing this (all validators green):

| | |
|---|---|
| `data/words.json` | **498** words |
| contrast pairs over that library | **325** pairs, covering **300** words; **198** words are in no pair |
| `src/data/contrastNotes.json` | 325 notes, coverage **325/325** |
| `src/data/wordNotes.json` | 300 notes, coverage **300/300** confusable words (= 60.2% of the library, matching `src/lib/guess.ts:110`) |
| `src/data/suggestions.json` | 201 items |
| `src/data/passages.json` | 34 passages, marking **236/498** distinct words |
| `src/data/senseGroups.json` | 59 groups, covering **121** words (of 156 same-POS candidate anchors) |

---

## 0. The one-paragraph version

A new word needs an entry in **`data/words.json`** (repo copy — this is what
every validator reads) **and** in the live `volcab-data/words.json` (what the
app reads). It then leaves a hole in exactly **two** authored, word-keyed
files: `src/data/contrastNotes.json` (**median 1, up to 11** new entries) and
`src/data/wordNotes.json` (**1** entry, plus **0–3** for partners that just
became confusable). `src/data/passages.json` and
`src/data/senseGroups.json` are optional coverage — a word joining two or
more same-POS confusable partners becomes a candidate for a new sense group
(scenario + ranked order + why), gated by `npm run validate-sense-groups`.
`src/data/suggestions.json` needs nothing — it self-filters at runtime.
Everything else the app shows for that word is computed from `words.json` at
runtime and needs no top-up.

---

## 1. Files that hold authored, word-keyed content

### 1.1 `src/data/contrastNotes.json` — **must be topped up**

- **Key shape**: `"<idA>|<idB>"`, the two ids **sorted** and joined with `|`
  (`src/lib/contrastNotes.ts:31`). Values are 1–2 sentence Chinese
  explanations, ≤ 160 chars (`scripts/validate-contrast-notes.ts:24`).
- **Coverage means**: one note per pair returned by `buildContrastPairs`
  (`src/lib/contrast.ts:53`) — **every** pair, not just those scoring ≥
  `CONTRAST_MIN_SCORE`. The validator's comment explains why:
  > "when a learner's studied words can't form enough high-scoring pairs,
  > generateContrastQuiz deliberately falls back to all pairs among learned
  > words — so any pair in the graph can be asked … the very first pair drawn
  > in verification (alleviate | assuage, score 2) had no note."
  > — `scripts/validate-contrast-notes.ts:57-64`
- **What the app does when missing**: nothing renders.
  `src/pages/QuizQuestion.tsx:139` reads `notes[contrastNoteKey(...)]` and
  `:144` guards with `{note !== undefined && ...}`. The side-by-side
  comparison card still draws; only the "what actually separates these two"
  line is absent. **Silent.**

### 1.2 `src/data/wordNotes.json` — **must be topped up**

- **Key shape**: word id → one Chinese sentence, ≤ 80 chars
  (`scripts/validate-word-notes.ts:27`).
- **Coverage means**: measured only over words that take part in ≥ 1 contrast
  pair, not the whole library — `scripts/validate-word-notes.ts:98-105`. A
  word with no confusable twin is **expected to stay blank**
  (`src/lib/wordNotes.ts:20-25`: "198 of 498 words have no confusable twin at
  all, and inventing 正式用语，多见于书面 for them would dilute the notes that
  carry real information").
- **Hard content rule**: the note **must not name another library headword**
  — that would make it a contrast note. `scripts/validate-word-notes.ts:79-90`
  enforces this and **fails the run** (it is an error, not a coverage report).
- **What the app does when missing**: `wordNote()` returns `undefined`
  (`src/lib/wordNotes.ts:38-43`, "Never throws"); `ReviewCard.tsx:32` and
  `WordDetail.tsx:104` render nothing. In 猜词 the `note` clue silently drops
  out of the shop — `src/lib/guess.ts:132`:
  `add('note', note === undefined ? null : maskHeadword(note, headword))`.
  The word still starts at 10 points but offers 5 clues instead of 6.
  **Silent.**

### 1.3 `src/data/passages.json` — **optional coverage**

- **Key shape**: not a map. Words appear as `{{wordId}}` / `{{wordId|surface}}`
  markers inside `en[]` sentences (`src/lib/passage.ts:77`).
- **Coverage means**: how many distinct library words are markable as cloze
  blanks somewhere. Currently 236/498 — reported by
  `scripts/validate-passages.ts:150-153`, never enforced.
- **What the app does when missing**: the new word is simply never a blank.
  It can still surface as a *distractor* through the fallback tiers
  (`src/lib/passage.ts:288-305`). **No error, no degradation** — adding a
  passage is a content decision, not a completion step.

### 1.4 `src/data/suggestions.json` — **needs nothing**

- It is the reverse direction: a pool of phrases the app proposes.
  `availableSuggestions` (`src/lib/suggestion.ts:72-78`) excludes any pool
  item whose id **or normalised headword** already exists in `words`,
  `staging`, or `progress.dismissed`. A newly added word that happened to be
  in the pool disappears from `/discover` automatically.
- `scripts/validate-suggestions.ts` never reads `words.json` — a now-redundant
  pool entry is harmless dead weight, not an error. Removing it is optional
  tidying.

### 1.5 `data/wordlist.json` — **dead; do not touch**

431 entries, the frozen Evernote-import manifest produced by
`scripts/parse-enex.ts:36-37`. **Referenced by nothing in `scripts/` or
`src/`** (verified by grep). It is 67 words behind the library and that is
fine.

---

## 2. Computed at runtime vs authored ahead of time

### 2.1 Computed from `words.json` — needs **nothing**

| Thing | Where |
|---|---|
| Confusable pair graph (contrast mode, passage distractors) | `src/lib/contrast.ts:53` |
| Shared-synonym exclusion set | `src/lib/quiz.ts:144` |
| All six mixed quiz types (cloze from `examples`, hints from `synonyms`) | `src/lib/quiz.ts:264` |
| Audio quiz (TTS reads `headword`) | `src/lib/quiz.ts:465` |
| 猜词 prompt + pos / collocation / etymology / example / initial clues | `src/lib/guess.ts:118-151` |
| Review-queue position for a new word (sorted by `usageScore` desc) | `src/lib/queue.ts:14` |
| Passage distractor pools | `src/lib/passage.ts:224` |
| Suggestion-pool filtering | `src/lib/suggestion.ts:72` |

### 2.2 Authored — needs a **top-up**

`contrastNotes.json` (required), `wordNotes.json` (required),
`passages.json` (optional).

### 2.3 How many NEW contrastNotes does one added word force?

**One word can create pairs with words already in the library.** Quantified by
leave-one-out over the live 498-word library — remove word W, recount pairs;
the delta is exactly the number of `contrastNoteKey`s W's arrival creates.
Verified against a direct per-word count on 5 sample words (abate → 4 = 4,
placate → 2 = 2, refute/concoct/raze → 0 = 0).

| statistic | new contrastNotes entries |
|---|---|
| min | 0 |
| p25 | 0 |
| **median** | **1** |
| p75 | 2 |
| p90 | 3 |
| max | **11** |
| mean | 1.31 |

Distribution across all 498 words:

- **198 (39.8%)** need **0** — the word has no confusable twin
- **224 (45.0%)** need **1–2**
- **65 (13.1%)** need **3–5**
- **11 (2.2%)** need **more than 5**

Driver is the size of the `synonyms` array (mean pairs by bucket): 1–2
synonyms → **0.00** (n=14); 3–4 → **1.25** (n=424); 5–6 → **1.98** (n=60).
A generously-synonymed entry costs more notes.

**Extra `wordNotes` forced on existing words**: if the new word is the *first*
confusable partner an existing word ever had, that existing word now enters
the coverage set and needs its own 要点. Measured over the 300 confusable
words: mean **0.45** extra per word; 181 force 0, **105 force 1**, 13 force 2,
1 forces 3.

> **wordNotes needed = (1 for the new word, if it has ≥ 1 pair) + (number of
> its partners that previously had 0 pairs).**

**Typical single word**: 1 wordNote + 1 contrastNote. **Budget for a
well-connected one**: 1 wordNote + up to 3 partner wordNotes + up to 11
contrastNotes.

---

## 3. Every validation gate

Five npm scripts (`package.json:12-16`). **None of them runs in CI** —
`.github/workflows/deploy.yml:48-50` runs only `npm ci`, `npm test`,
`npm run build`. These are manual gates.

| # | Script | Reads | Enforces (exit 1) | Merely reports |
|---|---|---|---|---|
| 1 | `npm run validate-words` | `argv[2] ?? data/words.json` (`validate-words.ts:6`) | id lowercase/no-whitespace + unique `:22-24`; headword `:25`; phonetic `/…/` `:26`; ≥1 meaning with pos/en/zh `:27-29`; per-meaning phonetic shape `:31`; **heteronym needs a per-sense phonetic** `:42-52`; share validity + descending order `:57-61`; **≥2 examples** `:62`; syn/ant/colloc are arrays not containing the headword `:63-66`; relatedForms `:67-70`; sourceNote `:71`; `addedAt` = `YYYY-MM-DD` `:72`; **`usageScore` required, integer 1–10** `:81-85`; etymology shape + ≤60 chars when present `:92-98` | entry count |
| 2 | `npm run validate-passages` | `data/words.json` **hardcoded** (`:37`) + `argv[2] ?? src/data/passages.json` (`:40`) | version/shape `:43-45`; id charset + uniqueness `:76-78`; en/zh 1:1 `:82`; malformed marker `:94`; **marker id must exist in the vocabulary** `:102-104`; surface must be an inflection `:106-108`; ≥6 distinct marks `:112`; **answer must not appear as plain text elsewhere** `:121-127` | word coverage `:150-153`; tier-1 distractor pool per passage `:156-165`; article-leak warnings `:168-171` (non-blocking) |
| 3 | `npm run validate-suggestions` | `argv[2] ?? src/data/suggestions.json` (`:21`); **never reads words.json** | id shape + uniqueness `:37-41`; headword + duplicate-headword `:43-51`; kind enum `:53`; zh/en non-empty `:54-56`; zh must contain Chinese `:59`; usageScore 1–10 `:64`; example 12–30 words `:72`; **`headwordPattern` must locate the headword in its own example** `:73-75` | item count |
| 4 | `npm run validate-contrast-notes` | `argv[2] ?? src/data/contrastNotes.json` (`:17`) + `data/words.json` **hardcoded** (`:19`) | key must be two ids joined by `\|` `:34`; **key must be sorted** `:38-40`; **both ids must exist in the vocabulary** `:42`; note non-empty `:44`; must contain Chinese `:47`; ≤160 chars `:48` | **coverage over quizzable pairs** `:65-72` — prints the missing keys |
| 5 | `npm run validate-word-notes` | `argv[2] ?? src/data/wordNotes.json` (`:15`) + `data/words.json` **hardcoded** (`:17`) | **id must exist in the vocabulary** `:50-52`; note non-empty `:54`; must contain Chinese `:58`; ≤80 chars `:59`; **must not name another library headword** `:79-90` | **coverage over confusable words** `:98-108` |

Plus a sixth, non-npm gate: **`npm test`** runs two full-library regression
tests in `src/lib/headword.test.ts:81-118` against `data/words.json` —
"every word has at least one example sentence where it can be located" and
"no word is mismarked across the full library". `src/state/sync.test.ts:411`
also parses the whole repo copy through `parseWords`.

**Note the asymmetry**: the three coverage validators (2, 4, 5) *hard-fail* on
a key pointing at a word that doesn't exist, but only *report* a word that
exists with no note. Missing content is safe; dangling content is not.

---

## 4. What breaks silently if a step is skipped

### 4.1 Word added to live `volcab-data` only, repo copy left stale — **worst case**

- The two full-library regression tests never see the word. A word whose
  example sentences can't locate the headword ships with **no cloze question
  and no highlighting**, and nothing reports it. The test's own comment says
  it is guarding exactly this:
  > "In practice this has never triggered on the current word list (the base
  > form is always present), but **a new word could hit it at any time**"
  > — `src/lib/headword.test.ts:88-90`
- Worse, it inverts the meaning of validator 4 and 5 failures: authoring a
  note for the new id yields
  `"<id>: not in the vocabulary — this note can never render"`
  (`scripts/validate-word-notes.ts:51`) — which reads as "your note is wrong"
  when the truth is "your word list is stale".
- Precedent, `docs/superpowers/HANDOFF.md:23`:
  > "the repo copy stayed frozen at the original 476-word import snapshot, and
  > the drift went unnoticed for months (the demo data having 5 extra words
  > throws no error)."

### 4.2 Word added to repo copy only, never pushed to `volcab-data`

The app never sees it at all. `src/state/store.tsx:342` loads
`data/words.json` **only in demo mode** (`import.meta.env.DEV` branch,
tree-shaken from production).

### 4.3 contrastNotes skipped

Silent by design. `scripts/validate-contrast-notes.ts:10-13`:
> "Coverage over the quizzable pair set is *reported*, not enforced: the pair
> set moves with the library, and a missing note degrades to 'no explanation
> shown', which is safe."

Cost: the contrast question the learner is most likely to get wrong is the one
with no explanation.

### 4.4 wordNotes skipped

Silent by design. `scripts/validate-word-notes.ts:8-12`:
> "Coverage is *reported*, not enforced … a missing note degrades to 'nothing
> shown', and most importantly a blank is often the correct answer."

Second-order cost, easy to miss: 猜词 loses a 2-point clue for that word
(`src/lib/guess.ts:132`).

### 4.5 `usageScore` omitted

**Not** silent at the repo gate — `scripts/validate-words.ts:81-85` fails with
"missing usageScore". But if the entry is pushed straight to `volcab-data`,
`isWord` in `src/state/sync.ts:70-80` **does not check `usageScore`**, so it
loads fine and then sorts last in the new-word queue forever:
`src/lib/queue.ts:6-14` — "**Unscored doesn't mean high-frequency**, so the
default has to sort last". This is HANDOFF known-issue #5 in reverse.

### 4.6 `staging.json` not trimmed after promotion

The headword stays in 待补全 forever, and `checkCapture`
(`src/pages/stagingCapture.ts:35-36`) keeps reporting it as staged. Remove
**exactly the promoted entries by headword** — `docs/word-entry-spec.md:114`:
> "don't clear the whole file, since the user may have added more words in the
> meantime."

### 4.7 Heteronym entered with a single phonetic

Blocked at the repo gate (`scripts/validate-words.ts:42-52`) — but only if the
word reaches `data/words.json`. See 4.1.

---

## 5. The ordered procedure

Steps marked **[BATCH]** should be done once for the whole batch, not per word.

### Phase A — author the entry

1. Read `docs/word-entry-spec.md`. It is authoritative over the phase design
   docs (`docs/word-entry-spec.md:3`). **5 example sentences** (`:73`), each
   containing a locatable form of the headword (`:77`); `usageScore` 1–10;
   `share` only when polysemous, multiples of 10 summing to 100, sorted
   descending; `etymology` **omitted** rather than guessed (`:94-96`).
2. If promoting from staging: read `staging.json` from `volcab-data` first
   (`docs/word-entry-spec.md:111`).

### Phase B — repo copy first (this is the ordering constraint)

3. **[BATCH]** Write the entries into `data/words.json`.
   *Must precede steps 5, 8, 9, 11* — validators 2, 4 and 5 read that path
   hardcoded and will reject any authored key naming an id it doesn't contain.
4. `npm run validate-words` → expect `OK: N entries passed validation`.
5. `npm test` → the two full-library regression tests now cover the new
   examples. **Do not loosen `src/lib/headword.ts` if one fails** — rewrite the
   sentence instead (`docs/superpowers/HANDOFF.md:64`).

### Phase C — top up the authored content

6. **[BATCH]** Recompute the pair set and diff it against the pre-add set to
   get the exact list of new keys. Run from the repo root, script in scratch
   (`.mts` — the repo is CJS-resolving for loose `.ts`):

   ```ts
   import { readFileSync } from 'node:fs'
   import { pathToFileURL } from 'node:url'
   const R = 'C:/Users/gaosi/repos/volcab'
   const { buildContrastPairs } = await import(pathToFileURL(`${R}/src/lib/contrast.ts`).href)
   const { contrastNoteKey } = await import(pathToFileURL(`${R}/src/lib/contrastNotes.ts`).href)
   const words = JSON.parse(readFileSync(`${R}/data/words.json`, 'utf8')).words
   const NEW = new Set(['<id1>', '<id2>'])            // the ids just added
   const before = new Set(buildContrastPairs(words.filter(w => !NEW.has(w.id)))
     .map(p => contrastNoteKey(p.a, p.b)))
   const after = buildContrastPairs(words)
   const cn = JSON.parse(readFileSync(`${R}/src/data/contrastNotes.json`, 'utf8')).notes
   const wn = JSON.parse(readFileSync(`${R}/src/data/wordNotes.json`, 'utf8')).notes
   const newKeys = after.map(p => contrastNoteKey(p.a, p.b)).filter(k => !before.has(k))
   console.log('new contrastNotes keys:', newKeys.filter(k => !(k in cn)))
   const confusable = new Set(after.flatMap(p => [p.a, p.b]))
   console.log('words now needing a 要点:', [...confusable].filter(id => !(id in wn)))
   ```

   **Batching matters here**: two words added in the same batch can pair with
   *each other* — that pair exists only when both are present
   (`src/lib/contrast.ts:59-95`). A per-word incremental pass would miss it.
7. **[BATCH]** Author one contrast note per new key. Sorted key, Chinese,
   ≤160 chars, states what separates the two.
8. `npm run validate-contrast-notes` → read the `coverage: X/Y` line; X must
   equal Y. Missing keys are printed (`:71-72`).
9. **[BATCH]** Author a 要点 for every id the script listed. Chinese, ≤80
   chars, **must not name any other library headword**.
10. `npm run validate-word-notes` → `coverage: X/Y`, X must equal Y.
11. *Optional*: mark the word in a passage → `npm run validate-passages`
    (≥6 distinct marks per passage; answer must not appear as plain text
    elsewhere). *Optional*: drop a now-redundant entry from
    `src/data/suggestions.json` → `npm run validate-suggestions`.

### Phase D — the live library

12. Pull the live copy fresh and **apply the additions on top of it** — never
    overwrite it with the repo copy (`docs/superpowers/HANDOFF.md:25-31`):
    ```bash
    gh api repos/steveao886/volcab-data/contents/words.json \
      -H "Accept: application/vnd.github.raw" > /tmp/live.json
    ```
    > "**apply the change on top of the live copy, rather than overwriting it
    > with the local copy** — the latter would resurrect words the user had
    > deleted … and it really did trigger once."
13. Remove **exactly the promoted entries** from `staging.json`, matched by
    headword.
14. Verify the repo copy and the live copy now agree on the added ids.

### Phase E — ship

15. `npm test && npx tsc -b --noEmit && npm run build && npx oxlint`
    (`docs/superpowers/HANDOFF.md:38`).
16. Commit `data/words.json` + the two `src/data/*.json` files together — the
    notes are meaningless without the word and the word is incomplete without
    the notes. Push; `deploy.yml` bundles `src/data/*` into the app.

### Ordering constraints, condensed

```
3 (data/words.json)  ──►  4, 5           validate-words + full-library tests
                     ──►  6              pair diff needs the new word present
6  ──►  7  ──►  8                        author then validate contrast notes
6  ──►  9  ──►  10                       author then validate word notes
3  ──►  11                               passage validator resolves marker ids
3, 7, 9  ──►  15, 16                     build and commit as one unit
12 is independent of 6–11 but must come AFTER a fresh pull, never before
```

**Safe to batch**: steps 3, 6, 7, 9, 12, 13 — and step 6 is *only* correct in
batch. **Not batchable**: nothing; there is no per-word step that must run
alone.

---

## 6. The three word lists, and which is authoritative for what

| File | What it is | Authoritative for |
|---|---|---|
| `volcab-data/words.json` (private repo) | **The live library.** What the app reads at runtime (`src/state/sync.ts:19`, `store.tsx:367`) | **The user's actual vocabulary.** Any question of "does this word exist / did the user delete it". |
| `data/words.json` (repo, 498 words, 803 KB) | Repo copy. Feeds dev demo mode (`src/state/store.tsx:342`, DEV-only) and the full-library regression tests (`src/lib/headword.test.ts:83,101`; `src/state/sync.test.ts:11`) | **Every validation gate.** Validators 2, 4 and 5 read this path *hardcoded* (`validate-passages.ts:37`, `validate-contrast-notes.ts:19`, `validate-word-notes.ts:17`). A note is judged against this file, not the live one. |
| `data/wordlist.json` (431 entries) | Frozen import manifest from `scripts/parse-enex.ts` | **Nothing.** Referenced by no code. Ignore it. |

**What the divergence means for this checklist**: the two copies serve
different masters, and the checklist has to write **both**.

- Write the repo copy **first** (step 3), or Phase C cannot run at all — the
  validators will call your new notes dangling references
  (`scripts/validate-contrast-notes.ts:42`,
  `scripts/validate-word-notes.ts:50-52`,
  `scripts/validate-passages.ts:103`).
- Write the live copy **by merging onto a fresh pull** (step 12), never by
  copying the repo file over it. `f53adb9` is the record of what happens
  otherwise: five words the user had deleted in-app
  (`ad-hoc / due-diligence / remorse / hypocrisy / status-quo`) survived only
  in the repo copy, undetected for months, because "两边分叉但没人发现 ——
  这份只喂开发模式的演示数据和一条全库回归测试，分叉不报错."
- Runtime code must stay tolerant of an id that isn't there
  (`CLAUDE.md:49`) — this is why `pickDistractors`
  (`src/lib/passage.ts:245-246`), `generateContrastQuiz`
  (`src/lib/quiz.ts:451`) and `wordNote` (`src/lib/wordNotes.ts:38-43`) all
  skip rather than throw.
- After a *deletion* the same logic runs in reverse: prune the repo copy, then
  re-run validators 4 and 5 — they will hard-fail on any note still keyed to
  the removed id. That failure is the feature.

---

## 7. Quick verification block

```bash
cd C:/Users/gaosi/repos/volcab
npm run validate-words            # exit 1 on any schema break
npm run validate-contrast-notes   # read the coverage line: must be X/X
npm run validate-word-notes       # read the coverage line: must be X/X
npm run validate-passages         # exit 1 on a dangling marker id
npm run validate-suggestions      # exit 1 on an unlocatable example
npm test && npx tsc -b --noEmit && npm run build && npx oxlint
```

Coverage lines are **not** exit codes. Reading them is a manual step and there
is no automation behind it — CI runs none of these
(`.github/workflows/deploy.yml:48-50`).
