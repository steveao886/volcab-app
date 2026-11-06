# Verb forms on the entry page

Asked for on 2026-11-06, from the `overhaul` entry page: when a word has a verb
sense, show how it inflects, so the learner knows how the word changes before
using it. The request named four forms (past, past participle, present
participle, third person singular). The user cut it to two after seeing the
first build; see "Revised on first look" below.

## Why, in the user's words

The first framing was "only the forms that could be misread; a plain +ed is
not needed". Then, about `overhaul` itself: *"我就不确定，因为没见过，所以我以为会特殊呢"*.
That second remark sets the real requirement. A learner who has only met a
verb in its base form cannot tell "regular" from "special", so **a blank
answers nothing**. The page has to say both things:

1. **where a verb is special**, and mark the exact letters. The user chose
   three kinds: irregular forms, a doubled final consonant, and a consonant
   that looks as if it should double but does not;
2. **where it is not**, by saying 规则变化 and showing `overhauled`, so the
   question is settled instead of left open.

Not flagged as special, by the user's choice: y → ied (`ratify → ratified`,
7 verbs), e-dropping before -ing, `decree → decreeing`. They are still
spelled correctly; they just carry no mark.

### Revised on first look

The first build showed all four forms, phrases included, always open. On
seeing it at 375px the user made three cuts, all adopted:

- *"现在分词和第三人称单数有必要么"*: **past and past participle only.**
  A doubled consonant already shows in `concurred`. The -ing and -s
  spellings are rules the learner already knows (e-dropping, y → i).
- *"kick the can 都有，那个那么容易，而且还是词组"*: **single words
  only.** A phrase or hyphenated compound inflects on an everyday verb the
  learner already knows (kicked the can, fell through, rubber-stamped).
- *"collapse by default，只有我有需要的时候才会看"*: **collapsed by
  default.** The forms are looked up when wanted, not read on every visit.

## Measured on the live library (2026-11-06, 1,766 words; `check-live` clean)

Measured over every verb before the scope was cut. The counts that apply
after the cut follow in "What shows".

- **364 words have a verb sense** (`meanings[].pos` starting `v.`): 354 single
  words, 10 multi-word headwords, and 1 of the single words is hyphenated
  (`rubber-stamp`). For 36 of them the verb is not `meanings[0]`, and 116 have
  two or more verb senses.
- **Irregular: 9.** Single words `oversee`, `uphold`, `overthrow`,
  `backslide`. Phrases whose first word is irregular: `bite the bullet`,
  `bear the brunt`, `cast a long shadow`, `fall through`, `hold together`.
- **Ending consonant–vowel–consonant: 38.** 5 are one syllable (`snag`,
  `plot`, `trek`, `snub`, the `stem` of `stem from`) and always double. The
  other 33 double only when the last syllable is stressed: 7 do (`concur`,
  `manumit`, `extol`, `repel`, `abhor`, `deter`, and `deadpan`, a compound
  that doubles against its stress) and 26 do not. Of those 26, 4 tempt a
  doubled spelling (`fidget`, `covet`, `dispirit`, `quarrel`). Nobody writes
  `ponderred`, so the other 22 are plain.
- **The IPA is not a usable source of stress.** A first pass that read final
  stress from `phonetic` got 5 of the 37 single-word verbs ending
  consonant–vowel–consonant wrong. It doubled `hearten` and `dishearten`,
  whose syllabic /n/ has no vowel letter. It doubled `empower` and
  `overpower`, where /aʊɚ/ ran together as one vowel. It left `deadpan`
  single. Every mismatch against the forms the examples themselves use
  (11 of 965 inflected occurrences) came from four of those five words.
  `deadpan`'s examples never inflect it, so nothing caught that one.

### What shows, after the cut (as `validate-verb-forms` counts it)

- **353 single-word verbs show forms**; the 11 phrases and compounds show
  none.
- **19 carry a mark**: 4 irregular, 11 doubling (the 7 above plus `snag`,
  `plot`, `trek`, `snub`), 4 tempting singles. **334 say 规则变化.**
- Past and past participle are the same word on 351 of the 353, so they
  share one row. The exceptions are `oversee` and `overthrow`.

## Decisions

### Rules for spelling, a bundled file for judgment

`src/lib/verbForms.ts` spells the forms from deterministic spelling rules:
-d/-ed/-ied, -ing with e-dropping (but not after ee/ye/oe), ie → ying, and
doubling for a **one-syllable** word ending consonant–vowel–consonant (not
w/x/y; `qu` counts as one consonant). The -ing form is never shown. It is
spelled only so the gate can check a doubling decision against examples
that use it.

Anything those rules cannot decide from spelling is **judgment, and lives in
`src/data/verbForms.json`**, keyed by word id:

```json
{ "version": 1, "verbs": {
  "oversee": { "past": "oversaw", "pastParticiple": "overseen" },
  "concur":  { "double": true },
  "fidget":  { "double": false, "looksDoubled": true },
  "ponder":  { "double": false }
} }
```

A word needs judgment when it is:

- **an irregular verb, or one of them behind a prefix** (`over`, `up`, `with`,
  `be`, `re`, `un`, …). The entry must give `past` and `pastParticiple`.
  Prefix detection deliberately over-flags. In the library today that is
  `reprove`, read as re+prove because `prove` has `proven`; outside it,
  `belie` and `relay` would be flagged the same way. Their entries simply
  write the regular forms out. A prefixed irregular verb that also ends
  consonant–vowel–consonant (`forget`) gives `double` as well.
- **longer than one syllable and ending consonant–vowel–consonant**. The
  entry must give `double`, plus `looksDoubled: true` on a single consonant a
  learner would expect doubled.
- **ending vowel + c** (`panic → panicked`) or **consonant–vowel–s/z**
  (`quiz → quizzed`). The entry must give `past`, `pastParticiple` and
  `presentParticiple`. There are none in the library today. The rule
  exists so the first one fails closed instead of shipping `paniced`.

That is **38 entries** today: 4 irregular, the 33 doubling decisions, and
`reprove`.

**At runtime, a word that needs judgment and has no usable entry shows no
forms at all** (fail closed). A word added in the app before the next
content round shows nothing until its entry exists. A wrong spelling, shown
as a fact, would be a false anchor, the same reasoning that leaves an
etymology blank rather than guessed.

Rejected alternatives:

- **Rules alone, with stress taken from the IPA.** The measurement above
  rules it out: 5 of 37 doubling decisions wrong, and the errors are invisible
  without reading each word.
- **A new synced field on `Word`.** The forms would need a bulk write to the
  live `volcab-data` copy, a field on the edit form, and an optional-field
  migration story, all for 38 entries of editorial judgment. Bundled content
  keyed by id is the `wordNotes.json` precedent for exactly this.
- **Reusing `relatedForms`.** That field is 同根词: derived words with a
  Chinese gloss. It feeds 发散's 换词性 answers (`diverge.ts`) and the
  new-word spacing (`freshOrder.ts`), and each entry renders as a capture
  chip. An inflection there would become a 换词性 answer and a "new word" to
  capture. Inflections are not related words.
- **Reusing `headword.ts`.** It is a *recognizer*: `inflectableStems` tries
  every plausible base so that it can find a form in a sentence, and its
  `IRREGULAR_FORMS` lists forms without saying which is past and which is
  participle, and only for phrase heads. A generator has to commit to one
  spelling. The consonant–vowel–consonant condition is the same one, and
  the validator below uses `splitByHeadword` to check the generator against
  the examples.

### Display

- **One section per word**, not per sense. All 116 words with two or more
  verb senses inflect the same way in each sense, because the library has
  no `hang`/`lie`-style sense-split verb. It appears whenever any meaning is
  `v.`, including the 36 words whose verb sense is secondary. The head reads
  **动词变形** so that on a noun-first word it says whose forms these are.
- **Placed directly after the meanings block (and its 要点), before 例句.**
  Forms belong with the senses, as in a dictionary.
- **Collapsed by default: a `<details>` whose `<summary>` is the ruled
  section head**, with the rotating triangle `.disclosure` draws. It has no
  `.disclosure` box, because a page section is a ruled head, not a card.
  Closed, it takes one line. **The kind stays visible while closed**, so
  whether a word is worth opening is answered without opening it. Each word
  starts closed: the `<details>` is keyed by word id, because the page
  stays mounted from word to word and an uncontrolled `<details>` carried
  its open state across. That was observed in the browser and is fixed by
  the key.
- **Open, a `.ledger` row or two.** 过去式、过去分词 as one row when they
  are the same word, otherwise 过去式 and 过去分词.
- **The head's `__aside` names the kind**: 规则变化 / 不规则 / 双写 r /
  t 不双写. A final `l` that stays single reads `l 不双写（美式）`, because
  British spelling doubles it (`quarrelled`). The forms follow the
  library's American spelling, matching `phonetic`.
- **The 着重号 marks exactly what to look at**, as on the 形近 reveal card.
  On an irregular form it marks the whole word, wherever the form differs
  from what the rules would spell. On a doubled form it marks the doubled
  pair (`concu·rr·ed`). On a tempting single it marks the single consonant
  (`fidge·t·ed`). The meaning never rests on colour alone: the aside states
  the kind in words.

### Gate: `npm run validate-verb-forms`

Added to `npm run validate`, so it runs in CI. It fails on any of these:

1. an entry whose id is not in `data/words.json`, is not a verb, or is a
   phrase or compound. Such an entry can never render (the
   `validate-word-notes` precedent);
2. a malformed entry: forms must be one lowercase word, `double` and
   `looksDoubled` must be booleans, and `looksDoubled` is allowed only
   beside `double: false`;
3. a single-word verb that needs judgment and has no sufficient entry;
4. an entry on a verb that needs no judgment, where the entry changes no
   form either. That entry is noise, and it would hide a later rule fix;
5. **any -ed or -ing occurrence of the headword in the word's own examples,
   located by `splitByHeadword`, that is not a form the rules and the entry
   produce.** This check would have caught four of the five IPA errors
   above. It catches a wrong `double` on any word whose examples use an -ed
   or -ing form (284 of the 353 verbs, 793 occurrences, as the gate counts
   them), and only on those: `deadpan` shows the limit.

It prints the count of each kind, so a content round sees what it added.

## Failure conditions

- **Invalid if any displayed form disagrees with how the word's own examples
  spell it.** Gate check 5 makes this mechanical; a failure there means the
  entry, not the example, is suspect first.
- **Invalid if a verb that needs judgment renders forms without an entry.**
  Fail-closed is the contract. Showing nothing is a degradation; a guess is
  a bug.
- **Invalid if `overhaul` renders nothing.** The user's own example: a
  regular single-word verb must say 规则变化 on its closed head and show
  `overhauled` when opened.

## Out of scope

- Present participle and third person on the page; phrases and compounds.
  Both were cut by the user (above).
- Noun plurals, comparatives, and forms on the review card or in quizzes.
  This is the entry page only.
- Changing how `headword.ts` finds an inflected headword in examples. The
  examples already use only regular inflections, per
  `docs/word-entry-spec.md`.
- British spellings as a second form.

## Content workflow

The word-content skill's file map gains a row: `src/data/verbForms.json`,
keyed by word id, **required** for a new single-word verb that needs
judgment, gated by `validate-verb-forms`. Its failure message names the
field the entry is missing, so whoever adds the word does not have to
rediscover the rules.
