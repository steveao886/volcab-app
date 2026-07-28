# Sense Share and Usage-Frequency Score on the Review Card — Design

Date: 2026-07-26
Status: confirmed with user
Prerequisite: v1.1 is live, `usageScore` already covers all 476 words in the list

## 1. Background

While reviewing on a real device, the user raised two things:

1. **The usage-frequency score isn't shown on the review card.** This isn't a bug, it was simply never built — `usageScore` currently only appears on the entry detail page (the stats row in [`WordDetail.tsx`](../../../src/pages/WordDetail.tsx)); the back of the review card ([`ReviewCard.tsx`](../../../src/pages/ReviewCard.tsx)) has never referenced it.
2. **For polysemous words, there's no way to tell which sense is more common.** Of the 476 words in the list, 95 are polysemous (94 with two senses, 1 with three), and `Meaning` only has the three fields `pos / en / zh` — share information doesn't exist at the data layer at all.

The user then added a further requirement: **from now on, newly added words need to carry this metadata at intake time**, not have it backfilled afterward.

### 1.1 Data honesty (a preliminary note)

Sense share **has no corpus statistics behind it** — like `usageScore`, it's a magnitude estimate the AI produces in-session based on general knowledge of contemporary English usage. As a result:

- Share is **rounded to the nearest ten** (10–90). Writing `87% / 13%` would imply there's a corpus source like COCA behind it, which would be false precision.
- It's rendered in a muted color, sitting as a marginal annotation, not competing visually with the English definition.

## 2. Scope

| | Change | Surface area |
|---|---|---|
| A | Add `share?: number` to `Meaning` | `types.ts` |
| B | Backfill `share` for the 95 polysemous words and re-sort by share descending | `data/words.json` |
| C | Upgrade validation rules | `scripts/validate-words.ts` |
| D | Show likelihood-of-encounter + sense share on the review card back | `ReviewCard.tsx` / `Review.css` |
| E | Show sense share in the definition list on the entry detail page | `WordDetail.tsx` / `WordDetail.css` |
| F | Open up `usageScore` / `share` entry in both forms | `AddWord.tsx` / `WordEditForm.tsx` |
| G | Word-entry spec document | New `docs/word-entry-spec.md`, with `HANDOFF.md` updated to point to it |

**The sync pipeline (`src/state/sync.ts`) is untouched, not a single line** — see §7.4 for why.

---

## 3. A — schema

```ts
export interface Meaning {
  pos: string
  en: string
  zh: string
  /** This sense's approximate share of contemporary usage, rounded to the nearest ten (10–90).
      All senses of a word either all have it or none do; the total always sums to 100;
      monosemous words don't get one. An AI-estimated magnitude, not corpus statistics. */
  share?: number
}
```

`Word` is unchanged; `usageScore?: number` stays optional (see §7.4 for why).

## 4. B — data backfill

- Add `share` to the 95 polysemous words, rounded to the nearest ten, summing to 100 within each word.
- **At the same time, re-sort the `meanings` array by `share` descending.** With ordering baked in at the storage layer, all three rendering sites (review card, detail page, edit form) are naturally consistent, with no sorting logic needed anywhere. The index number in front of each definition (`review-meaning__idx`) incidentally becomes a commonness ranking.
- When two senses are evenly matched, `50/50` is allowed, in which case the original order is kept.
- The 381 monosemous words **never get a `share` field, uniformly**. Not even `100`: that would be noise, and it would break the rule that "having `share` at all means polysemous."

Values are produced word-by-word in-session; the user can spot-check and correct at any time afterward.

## 5. C — validation upgrade (`scripts/validate-words.ts`)

`usageScore` is upgraded from "optional, but must be a 1–10 integer if present" to **unconditionally required**. All 476 words in the list already have it, so the check is green immediately after the upgrade — no data backfill needed first.

New `share` rules, for each word:

- If any sense has `share`, **all** senses must have it;
- Each `share` is a multiple of ten between 10 and 90;
- The values within a word must sum to exactly 100;
- The array must be sorted by `share` **descending**;
- Sense count must be > 1 — a monosemous word with `share` is flagged as an error;
- When sense count > 1, `share` is **required**.

Validation logic is extracted into an importable pure function (`validateWord(word): string[]`), with vitest tests; the script itself only handles reading the file, aggregating errors, and setting the exit code.

## 6. D/E — UI presentation

**Review card back** ([`ReviewCard.tsx`](../../../src/pages/ReviewCard.tsx)):

- On the right end of the phonetics row, show "likelihood **6**/10". The score uses `.num`, the label uses `.faint`.
- For polysemous words, add the share after `pos` at the head of each definition: `① v. 90%`, styled one step further muted via `.faint`.

The score sits on the **back**, not the front: it's "a fact about the word," belonging with the definitions and examples on the answer side; the front stays a clean recall environment with "just the headword + pronunciation," with no hint like "low score → it's fine if you can't recall it."

**Entry detail page** ([`WordDetail.tsx`](../../../src/pages/WordDetail.tsx)): the definition list gets the same share annotation, consistent with the review card's presentation. The "contemporary likelihood of encounter 6 / 10" stat at the bottom is left as-is.

**Degradation**: words without `share` (old data, or words added on another device with an older app version) show no share; everything else is unaffected. Words without `usageScore` don't show that row at all.

## 7. F/G — guaranteeing this for newly added words

Three layers, all required.

### 7.1 Required in both forms

The `/add` full form and the entry-edit form share the same rules:

- **Likelihood of encounter**: a 1–10 picker, required.
- **Sense share**: only appears when there are ≥ 2 definitions, each a **10–90-in-tens-of-ten dropdown**. A dropdown rather than a text field — so the "multiple of ten" constraint becomes structurally impossible to violate, no need to catch it in validation.
- The form shows a running total live (e.g. "total 90%, needs to be 100%"); submission is **blocked with a prompt** when it's under or over, never silently discarded.
- The share rows grow/shrink as definitions are added/removed; deleting down to a single definition makes the whole share block disappear.
- **On save, `meanings` is re-sorted by `share` descending**, matching the storage invariant from §4, so the user doesn't have to sort it themselves.

This overturns the v1.1 design doc's decision "no manual entry UI for `usageScore`." The reasoning back then was to protect capture cost, but that cost constraint belongs to the **staging area** (a single input box); the `/add` full form already requires manually filling in part of speech, definitions, examples, synonyms/antonyms/collocations — two more fields is a marginal cost.

**The edit form must be opened up at the same time**: letting only `/add` fill these in while the edit page can't change them means there's no way to fix a mistake, and `share` would still get silently wiped out whenever [`WordEditForm.tsx`](../../../src/pages/WordEditForm.tsx) rebuilds `{pos, en, zh}`.

### 7.2 Validation enforcement

See §5. `validate-words.ts` is the repo-side admission gate; every entry going into `data/words.json` has to pass it.

### 7.3 Getting the generation spec down into one file

"What a complete entry must look like" is currently scattered across the v1.1 design doc and `HANDOFF.md`. Create **`docs/word-entry-spec.md`** as the single source of truth, listing every required field plus the value rules for `usageScore` / `share`; when batch-completing the staging area, the session reads this file. Update the relevant section in `HANDOFF.md` to point to it.

### 7.4 One deliberate spot left un-tightened

`src/types.ts`'s `usageScore?` and `share?` stay optional, and `src/state/sync.ts`'s `isWord` / `isMeaning` **do not add** checks for these two fields.

Strict on write (forms + validation script), lenient on read. When an older app version on another device pushes up a word missing a field, the correct outcome is "this word has no score, that UI slot doesn't render," not "the whole `words.json` gets judged corrupt and the merge is rejected." This existing fault-tolerance can't be lost just because the write side is being tightened.

## 8. Testing

- `validateWord` pure function: covers missing `usageScore`, partially-missing `share`, non-multiple-of-ten values, sums not equal to 100, not sorted descending, a monosemous word with `share`, a polysemous word missing `share`.
- The share-normalization/re-sort logic for both forms is extracted into a pure function (`normalizeMeanings`), with tests: total validation, descending re-sort, stripping `share` when monosemous.
- Run `npm run validate-words` across the whole list; all 476 words must pass.
- No component-test tradition for UI changes in this project — spin up the dev server and verify visually.

## 9. Explicitly out of scope (YAGNI)

- Showing score or share on the word-list page.
- Showing score or share on the quiz page.
- Annotating monosemous words with `share: 100`.
- Single-digit precision, confidence intervals, or corpus-source annotation for share.
- Any changes to the existing 381 monosemous words.
