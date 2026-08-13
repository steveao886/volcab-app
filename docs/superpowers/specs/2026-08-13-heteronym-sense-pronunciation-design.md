# Heteronym sense pronunciation: a second button needs a second sound to play

**Date:** 2026-08-13
**Status:** approved

## Problem

`presage` is /prɪˈseɪdʒ/ as a verb and /ˈprɛsɪdʒ/ as a noun. The word detail
page has known this since the `Meaning.phonetic` field landed — it prints both
IPA strings, one per sense. It offers **one** speaker button, and that button
plays one recording.

The user asked the obvious question: give the heteronyms more than one
pronunciation button.

The obvious implementation does not exist, and finding out why is most of this
design.

### There is no second recording to fetch

`pronounce()` (`src/lib/pronounce.ts`) descends a three-rung ladder:
a cached dictionaryapi.dev human recording, then the youdao server voice,
then local speech synthesis. **The first two rungs key on spelling alone.**

- youdao is `dictvoice?audio=presage&type=2` — one URL, one file, no sense
  parameter exists.
- dictionaryapi.dev, queried while writing this spec: `presage` returns a
  `phonetics` array of length **one**, and its single audio is
  `presage-uk.mp3`. `indurate` likewise returns one, `indurate-uk.mp3`.

So today's button plays a British recording of whichever sense that Wikimedia
volunteer happened to read, and the other pronunciation is not merely
unbuttoned — it is not obtainable from any source the app talks to.

The third rung cannot rescue this either. The module comment at the top of
`src/lib/pronounce.ts` already records why: the Web Speech API accepts no
phoneme input and browsers ignore SSML. `speak('presage')` produces whatever
the platform voice's dictionary says, which is one pronunciation, chosen by
the voice and not by us.

**A second button, implemented the direct way, would play the identical audio
as the first.** That is worse than the current state: two buttons that sound
the same actively teach that the two senses are homophones.

### Scale

Measured over the live 523-word library:

| | |
|---|---|
| words carrying any meaning-level `phonetic` | **2** — `presage`, `indurate` |
| of those, senses whose phonetic differs from the word-level one | 1 each |
| of those, senses whose phonetic *duplicates* the word-level one | 1 each |
| entries spanning more than one part of speech | 38 |

Two words. The design has to be worth building at that scale, which means it
has to cost nothing on the other 521 and nothing on the 36 multi-POS entries
that are not heteronyms.

## Decision

**Author an ASCII respelling per divergent sense and speak it with the local
synthesizer.** A new optional field:

```ts
presage  n.   phonetic: "/ˈprɛsɪdʒ/"   speakAs: "press-idge"
indurate adj. phonetic: "/ˈɪndʊrət/"   speakAs: "in-dew-rut"
```

`speak(m.speakAs)` reliably sounds different from the recording, because it is
a different string going into a different engine. This is the only option on
the table that produces a genuinely distinct sound without a new external
dependency.

The cost is honest and must stay visible: the minority sense is a robot voice
reading a hand-written approximation. See *Marking the synthesized button*.

### Why not derive the respelling from the IPA

There is no IPA-to-respelling converter in this repo, and writing one is its
own project — English orthography is not a function of its phonology. A
derivation that is 90% right is a machine that mispronounces one word in ten
with full confidence.

This is the same rule `Word.etymology` already follows
(`src/types.ts`): *making one up is far worse than leaving it blank*, because
a wrong pronunciation is not a missing fact, it is a false memory anchor
driven into the learner's head. Hand-authored, ear-checked, or absent.

### Why not Merriam-Webster

MW's dictionary API splits homographs into separate entries, each with its own
`prs` audio — the only route to a genuine second *human* recording. Rejected
for this iteration: it needs an API key pasted into settings the way the
GitHub PAT is, adds a network dependency to an offline-first PWA, and buys
real audio for two words. Revisit if the heteronym count grows past a handful.

### Why not leave it alone and just label the one button

Considered and rejected by the user: it answers the audit but not the request.
The learner still cannot hear /ˈprɛsɪdʒ/.

## The rule: `src/lib/sensePronounce.ts`

Pure, colocated test, per the repo's testing convention. Given a word and one
of its meanings, it returns how that sense should be voiced:

```
recording          → pronounce(word.headword)   (the real audio)
synth(text)        → speak(text)                (the respelling)
null               → render no button
```

The decision is made **per word, not per meaning**, and it is
all-or-nothing:

1. **No sense diverges** (no meaning's `phonetic` differs from
   `word.phonetic`) → `null` for every meaning. This is 521 of 523 words and
   36 of the 38 multi-POS entries. They render exactly as they do today; the
   header button is untouched.
2. **A sense diverges but has no `speakAs`** → `null` for every meaning,
   including the ones that would have worked. Fail closed, per CLAUDE.md.
3. **Otherwise**, per meaning: `phonetic` absent or equal to the word-level
   one → `recording`; different → `synth(speakAs)`.

Rule 2 is the load-bearing one. The tempting alternative — button on the verb,
nothing on the noun — renders a page where one sense has audio and the other
visibly does not, which reads as *"the noun has no pronunciation"* rather than
*"we haven't authored it yet."* Falling back to today's layout says nothing
false. The state should be rare regardless: the validator makes it an error on
the write side, and it can only reach the app from an older build on another
device.

## UI

Both surfaces already render an identical meaning-head row — `pos`, optional
IPA, optional share percentage. The button joins it after the IPA:

```
1  v.   /prɪˈseɪdʒ/  🔊              70%
2  n.   /ˈprɛsɪdʒ/   🔊 合成          30%
```

- **Word detail** — `src/pages/WordDetail.tsx`, the `.worddetail-meaning__head` row.
- **Review card back** — `src/pages/ReviewCard.tsx`, the `.review-meaning__head` row.
- Shared thin component `src/components/SenseSpeakButton.tsx`. No component
  test; the logic worth testing is in the lib above.
- The header `发音` button is unchanged everywhere, including on heteronyms.
  It is the word's default pronunciation and every other word has one.
- Must not overflow at 375px. The row already carries three items; this makes
  four on two words.

### Marking the synthesized button

The synthesized button carries a visible `合成` tag and an `aria-label` that
names both the sense and the source — `朗读 presage(名词,合成语音)` against
`朗读 presage(动词)`.

Not decoration. The learner is entitled to know that one of these two sounds
is a machine reading an approximation while the other is a person, because
that changes how much to trust it. Text and not color alone, following the
existing rule that quiz options carry a text tag beside their color.

### The duplicated IPA is now load-bearing

`presage`'s verb sense prints `/prɪˈseɪdʒ/`, identical to the word-level line
directly above it. That reads as a redundancy bug and was nearly filed as one.
It is not, once the buttons exist: the IPA is what tells you which sound each
button makes. **Leave it.**

## Two defects that block this

Both were found while mapping the feature; neither is optional.

**`WordEditForm` silently destroys `phonetic`.** `src/pages/WordEditForm.tsx`
rebuilds every meaning as `{ pos, en, zh }` plus an optional `share`. Word-level
fields survive via `{ ...word, ...editedFields }`, but `meanings` is rebuilt
wholesale, so **editing `presage` in the app once deletes both sense phonetics**
— and would delete `speakAs` with them. The fix is to carry both fields on the
form's row state as pass-through values, so they travel with a row through
reorder and delete. No new inputs: per-sense phonetics are not authored in the
app today (`AddWord` has no field for them either), and this design does not
change that.

**The validator's heteronym gate accepts a duplicate.**
`scripts/validate-words.ts` currently asks only that *some* meaning carry a
`phonetic`. `presage` satisfies it with the verb's copy of the word-level
string — the gate passes while recording zero second pronunciations. It should
require a phonetic that **differs**, and require `speakAs` on every differing
sense. Both existing entries will fail until their respellings are authored,
which is the point of a gate.

`speakAs` shape: non-empty, no `/` (an IPA string pasted into the wrong field
is the likely mistake), and only permitted on a meaning that already has a
`phonetic`.

## Verification

Unit tests cover the rule table in `sensePronounce.ts`: no divergence, a
divergence with `speakAs`, a divergence without, a sense with no phonetic at
all, and a three-sense word.

**The respellings themselves cannot be unit tested and must be listened to.**
Play both buttons on both words in the browser preview and confirm the
synthesized one is (a) audibly different from the recording and (b) actually
the pronunciation the IPA describes. A respelling that was reasoned about but
never heard is exactly the invented content this design refuses elsewhere. If
no spelling can be coaxed into the right sound, ship `speakAs` absent — rule 2
turns that into today's layout, which is honest.
