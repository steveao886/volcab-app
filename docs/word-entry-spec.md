# Word Entry Spec

**What a word entry must look like.** This is the single source of truth — when a session batch-completes staged new words, read this file, not the phase design docs. If you change this, update `scripts/validate-words.ts` in lockstep (it's the gate into the store).

Validate with:

```bash
npm run validate-words
```

---

## Fields

| Field | Type | Required | Rule |
|---|---|---|---|
| `id` | string | ✅ | Lowercase lemma, unique. Phrases with spaces use hyphens: `ad hoc` → `ad-hoc` |
| `headword` | string | ✅ | Written as-is, spaces preserved |
| `phonetic` | string | ✅ | American pronunciation, shaped like `/ˈæbrəɡeɪt/`, must be wrapped in slashes |
| `meanings` | Meaning[] | ✅ | At least 1 entry, see below |
| `examples` | string[] | ✅ | **5 sentences** (every existing entry has 5), set in modern life/work scenes, no textbook-flat filler. See below |
| `synonyms` | string[] | ✅ | May be an empty array; **must not include the headword itself** |
| `antonyms` | string[] | ✅ | Same as above |
| `collocations` | string[] | ✅ | Same as above |
| `relatedForms` | RelatedForm[] | ✅ | May be an empty array; each entry needs `form` / `pos` / `zh` |
| `sourceNote` | string | ✅ | Title of the source note; entries added manually in-app use `manual` |
| `addedAt` | string | ✅ | `YYYY-MM-DD` |
| `usageScore` | number | ✅ | **Integer, 1–10**, see below |
| `etymology` | string | ❌ | One-sentence etymology breakdown, ≤ 60 characters. **Only write it when the word actually has a breakable etymology** — see below |

### Meaning

| Field | Type | Required | Rule |
|---|---|---|---|
| `pos` | string | ✅ | `v.` / `n.` / `adj.` / `adv.` … |
| `en` | string | ✅ | English definition. After flipping the review card, the main goal is "understand English in English" — this needs to stand on its own |
| `zh` | string | ✅ | Chinese definition |
| `share` | number | ✅ when polysemous | **Multiple of 10, between 10 and 90**, see below |

---

## `usageScore` — likelihood of encountering it today

**1–10: how likely you are to run into this word in real-world context.** Shown on the back of the review card and on the entry detail page.

Reference anchors:

| Score | Rough meaning |
|---|---|
| 9–10 | High-frequency in everyday news and social media |
| 6–8 | Common when reading serious English content |
| 4–5 | Shows up in formal writing and specialist articles, rarely spoken |
| 1–3 | Rare, literary, or confined to a specific specialist context |

The existing word list skews 4–7 — the intake bar is already C1/C2, so there's no need to force a wider spread.

## `share` — sense proportion

**Only present when a word is polysemous (`meanings.length > 1`).** This is a hard constraint the validator enforces:

- Either every sense has it, or none does (polysemous words must all have it).
- Each value is a **multiple of 10, between 10 and 90**. 0 and 100 aren't allowed: 100% means the word is actually monosemous, 0% means that sense shouldn't be included at all.
- All the values for a given word **must sum to 100**.
- The `meanings` array must be **sorted by `share`, highest first**. When two shares tie (50/50), either order is fine.
- **Monosemous words don't get a `share`.** Writing `100` is noise, and it would break the rule that "having `share` at all means polysemous."

**Rounding to the nearest ten is deliberate.** These are magnitude estimates based on general knowledge of contemporary usage, not backed by any corpus statistics; writing `87%/13%` would imply a source like COCA, which would be false precision.

Estimate by "relative frequency of encountering this sense in contemporary English text," not by dictionary sense ordering — dictionaries often list the etymologically earlier sense first, which is a different thing from likelihood of encounter (e.g. for `rhetoric`, "the art of rhetoric" is the original sense, but in contemporary text the overwhelming majority of uses mean "empty, showy language").

## `examples` — example sentences

**Write 5 sentences.** This isn't padding: the cloze-quiz prompt is **randomly** picked from these 5 sentences among the ones where the headword can be located — the more sentences there are, the less likely you are to hit the same prompt for the same word twice in a row. The validation script's floor is still 2 sentences (to tolerate old entries pushed from other devices), but every newly written entry gets 5.

Every sentence must satisfy:

- **Contain the headword itself, preferably in its base form.** Where grammar forces inflection, use only regular inflections (-s/-es/-ed/-ing/-ly, etc.). A sentence that only contains a same-root word (headword `abrogate`, sentence only has `abrogation`) is wasted — the cloze can't locate it, and the review card won't highlight it either.
- **Concrete scene + vividness.** `The new CEO abrogated the remote-work policy over a single Slack message, and half the team started job-hunting that week.` is good; `The government decided to abrogate the treaty.` is bad — no scene, anyone could write it.
- **No two of the 5 sentences repeat the same scene**, don't just restate the same situation a different way.
- 12–30 words, and **after the headword is blanked out, the surrounding context still lets you infer what goes there**.
- For polysemous words, allocate by `share`: write more sentences for the dominant sense, and at least one for any secondary sense with a share of 30% or more.

---

## `etymology` — word origin

Shown on the back of the review card and on the entry detail page. One sentence, ≤ 60 characters, shaped like:

```
ab-(away) + rogare(to propose) → to abolish
mis-(bad) + anthrōpos(person) → hating humankind
```

**This is the one field where it's better to leave it out.** Not every word has a breakable etymology: common words of Germanic origin, words of uncertain origin, and words that do have an etymology but whose breakdown does nothing for memorability — **all of these should skip the field entirely**.

Reasoning: a wrong etymology isn't just a missing piece of information, it's a false memory anchor driven into your head. Folk etymology is far worse than a blank. If you're not sure, skip it.

When writing one:

- Give the **root's original meaning**, not another English synonym — `rogare (to propose)` is useful, `rogare (to ask)` explains English with English, forcing the reader to translate it a second time
- Break it down only as far as **needed to show where the meaning comes from**, not a full Indo-European derivation
- Annotate root meanings in Chinese, matching the app's interface language
- An empty string or whitespace-only value is dirty data and the validator will reject it — if you don't need the etymology, omit the key entirely

Validation only checks the shape when the field is present (non-empty, ≤ 60 characters); it does **not** check whether the field exists. This is the opposite of the "strict at write time" approach used for `usageScore`, deliberately: both ends here are lenient.

---

## Completing entries in the staging area

1. Read `staging.json` from `volcab-data`.
2. Batch-generate complete entries per this spec — **produce `usageScore` and `share` at this step**, don't add them after the fact once the entry is already in the store. Write `etymology` too if you're confident in it; skip it if not — it's the only field allowed to be absent.
3. Merge into `words.json`.
4. **Remove exactly the promoted entries from `staging.json`, matched by `headword`** — don't clear the whole file, since the user may have added more words in the meantime.
5. Run `npm run validate-words` and confirm it's all green.

## Manually added words

The full `/add` form forces `usageScore` to be filled in, and for polysemous words forces `share` to be filled in and validates that it sums to 100%, so entries coming through that path already satisfy this spec. The entry-edit form lets you change both.

**These two fields remain optional in `src/types.ts` and `src/state/sync.ts`**, deliberately: strict on write, lenient on read. If an older version of the app on another device pushes up a word missing a field, the correct outcome is "that one thing doesn't render," not "the whole `words.json` gets judged corrupt and the merge is rejected."
