# 回想: the Chinese-to-English direction, without typing and without giving it away

**Date:** 2026-08-07
**Status:** approved

## Problem

The app's daily loop runs almost entirely in one direction. `/review` shows
the English word and asks for the Chinese; five of the six quiz modes are
recognition over English prompts; `/guess` is the one production mode and it
demands typed spelling. But the situation the user actually meets at work is
the reverse: **a Chinese meaning is in mind, and the English word has to
come out** — and often three near-synonyms could come out, of which one is
right for the sentence.

Two constraints, both stated by the user:

- **No typing.** `/guess` already tests spelling; requiring it again here
  would test the wrong thing twice.
- **No showing the options up front.** Four visible choices turn production
  back into recognition — "我本来想的就是这个" is unfalsifiable once the
  word is on screen.

The tension between those two is the whole design problem: without typing,
the app cannot know what word is in the user's head unless the user commits
to something *before* anything is revealed.

## Decision

A sixth `/quiz` mode, `?mode=recall`, chip label **回想** — not a separate
page. The interaction is tap-only and card-shaped, the same rhythm the quiz
page is built around (unlike `/guess`, which earned its own page by being a
text field with a shop).

Every question opens the same way: **one Chinese scenario sentence, alone on
the card**, with two buttons.

```
烧焦的爆米花味弥漫了整个办公室

[ 我想好了 ]        [ 想不起来 ]
```

The commit gate is the mechanism that replaces typing. You retrieve first,
in your head; only after declaring 我想好了 does the card reveal what it
wants next. 想不起来 is a first-class exit, not a give-up: it flips straight
to the answer and explanation and counts the question wrong. The mode's
subject is "can I produce it right now", so "no" must be sayable honestly —
the alternative is guessing through options and polluting the signal.

After 我想好了, one of two question types:

### 唤词 — did you retrieve the right word?

Four options appear: the group's members plus same-POS fillers from the
library. Tap the one you had in mind. Right means the retrieval was real;
wrong means the word in your head was one of its confusables — which is
exactly the finding worth having.

A fifth control, set apart from the options, says **我想的不是这几个**.
Added on user report the day after launch: a word often *does* come to
mind, just a simpler one that covers the meaning and isn't in the library
at all. Without this the only honest-looking exit was 想不起来, which is
false — the meaning was available, the word was not, and that is a
different diagnosis. It scores as a miss (the word is not in productive
vocabulary either way) but reports as 意思到了,词还没到, and the results
list tags it so the two kinds of miss stay distinguishable. 排序 has no
equivalent: ranking the three shown words stays answerable whatever you
happened to think of.

### 排序 — all three fit; which fits *best*?

The group's members appear unordered. Tap them in order, 最贴切 first; each
tap stamps ①②③ on the word, tapping a stamped word unstamps it. No
dragging — at 375px drag-to-reorder is miserable under a thumb, and
tap-in-sequence expresses the same ranking with an undo for free.

Exact match against the authored order counts as correct. Three items have
six permutations, so chance is 1/6 — partial credit would mostly reward
luck, and the second-versus-third call is precisely the judgment the mode
exists to train.

Both types settle the same way: reveal, then the group's `why` — one or two
sentences naming the dimension that decides (object taken, register,
connotation, grammar). The answer without the why would leave the user
exactly as able to argue with the card as before.

## The data: one authored file feeds both types

`src/data/senseGroups.json` — bundled, read-only, outside the synced schema,
exactly like `passages.json` / `wordNotes.json` / `contrastNotes.json`.
Types live in `src/lib/senseGroup.ts`, deliberately not in `src/types.ts`.

```json
{ "version": 1, "groups": [
  { "zh": "烧焦的爆米花味弥漫了整个办公室",
    "order": ["pervade", "permeate", "suffuse"],
    "why": "pervade 指气味、气氛充满整个空间；permeate 强调渗透进去；suffuse 几乎只用于光线、颜色与情绪。" }
]}
```

One entry is simultaneously a 唤词 question (answer `order[0]`, distractors
`order[1..]` + fillers) and a 排序 question (key = the whole `order`). Every
new group bought later widens both pools at once.

### Why the prompt is a scenario sentence, not the gloss

Measured over the library: of 325 confusable pairs, only 55 share a chunk of
their primary Chinese gloss — and the *tightest* groups are the worst case.
`suffuse` / `pervade` / `permeate` gloss as 弥漫;充满 / 弥漫;渗透;遍布 /
渗透;弥漫,遍布: near-identical strings, so a gloss-prompted ordering would
be a coin flip the user can argue with, and an arguable answer key poisons
the whole mode. A concrete scenario (burnt-popcorn smell filling an office)
makes one word clearly best. Prompts are drafted by translating one member's
own real example sentence — never an invented context.

### Authoring rules (enforced by `scripts/validate-sense-groups.ts`)

- Every id in `order` exists in the library; 2–4 members, no duplicates.
- `zh` non-empty, ≤40 characters, **contains no Latin letters at all** — it
  is on screen before the options, so any English is a leak. This is the
  masking rule from `/guess` in its strictest form.
- **`target`**: the chunk of `zh` being asked, required, ≤16 chars, no
  Latin, and locating in `zh` exactly once. Added the day the mode shipped,
  from user feedback: a scenario sentence carries half a dozen content
  words, and without a mark on the asked-for part the question was
  unanswerable ("我怎么知道表达用哪个词?"). Rendered as 着重号 (emphasis
  dots) — the traditional way to point at a run of characters, and unlike
  color it cannot be confused with the vermilion "wrong" annotation. Read
  leniently: a group whose target can't be located renders the plain
  sentence rather than being dropped.
- `why` non-empty. Distinct `zh` across groups (it doubles as the prompt
  key for rotation).
- Same-POS members only, per the contrast-mode finding: words with
  different parts of speech never compete inside one sentence.
- **Fail closed at authoring time.** The initial batch came from 108
  machine-generated candidate triples (same-POS confusable words with ≥2
  partners); 59 became groups and one was rejected because no sentence
  could make its second place defensible over its third
  (domineering/imperious/overbearing, whose glosses in this library are
  identical). A skipped group costs nothing; a wrong key costs the mode.

## Word pool and eligibility

**唤词 needs only the answer learned; 排序 needs all three.** The first
version required all three for both, and it strangled the mode: measured
over the library with learned words taken in review-queue order
(`usageScore` descending, per queue.ts), the all-learned rule leaves

| learned words | all-members | answer-only |
|---:|---:|---:|
| 150 | 1 | 19 |
| 250 | **11** | 34 |
| 300 | 13 | 38 |
| 400 | 26 | 52 |

— under a 10-question round at the realistic operating point, so every
round drew the same set and the recency rotation could only reorder it.
Reported as 做了好几轮 10 道题都没过呀,一直都是这 10 道题.

Answer-only is not a loosening of standards: the other members are
distractors, and "can you produce this word from this meaning" is a fair
question whether or not you know the words sitting next to it. 排序 keeps
the strict bar, because there all three *are* the answer and ranking a
stranger is meaningless. A group that can't be ranked is asked as 唤词
instead of being dropped.

Every member must still exist in the library, learned or not — a group
with a missing id is skipped whole rather than played with a hole in it.

Group selection weights by the *maximum* `difficultyWeight` among members:
a group containing one struggling word is worth surfacing even if its other
members are easy.

## Scoring and settlement

Settlement goes through the existing `recordQuiz(score, total, wrongIds)`
— due-date-forward only, never `ease`/`intervalDays`. Practice must not
reshape the review schedule.

`wrongIds` follows the contrast-mode precedent (a missed contrast question
marks both words): the confusion lives *between* words, so

- 唤词 wrong pick → the answer **and** the word picked.
- 唤词 想不起来 → the answer only; no second word was confused with it.
- 排序 wrong → every member whose position differs from the key. Swapping
  second and third marks those two and leaves the correctly-placed first
  alone.

## 巩固 — re-practise the direction, not just the word

**巩固 sits on the question, not on the results page.** It first shipped on
the results page and the user's verdict was immediate: 每道题直接选择比较好.
The moment you want it is the moment you just missed it, not ten questions
later when you're reconstructing which was which.

The harder correction was what it *does*. The first version only pulled the
word's `due` date forward — and `/review`'s card is headword on the front,
meanings on the back. **A meaning→headword failure was being answered with
headword→meaning practice**, which is the one direction the app was already
drowning in. Reported plainly: 那我也得是巩固从中到英的这个思维对吧？

So 巩固 now means "ask me this again, this way round", with three
consistent consequences:

1. **Immediately** — the question is appended after the scored round as a
   re-drill (`巩固 · 第 n / m 题`). Deliberately **not scored**: the score is
   out of the ten questions the round asked, and a re-drill that could raise
   it would make 巩固 a way to buy points. Settlement therefore fires when
   the scored ten end, not when the drill does — walking away mid-drill must
   not lose the round.
2. **Next session** — the prompt goes into a device-local `recallDebt` list,
   and `generateRecallSession` draws debt ahead of both unseen and seen
   prompts. Answering it right is the only thing that clears it.
3. **Bookkeeping** — `consolidateWord(id)` sets `due` to today, increments
   `lapses`, stamps `lastReviewedAt`, nothing else.

Why `consolidateWord` isn't `recordLapseDrill(id, 'again')`: `practiceGrade`
counts a `reviewed` card in dailyStats, because in the drills you actually
looked at a card and graded it. A button press is not a card viewed;
counting it would quietly drag the accuracy statistics down.

Why it does not force the word into 还没记牢: that list is defined by the
scheduler's own signals (`ease < 2.5`, interval < 21 days), and a button
that faked those signals would corrupt the definition the stats card and
drill queue both rely on. The word enters today's review queue, and if the
failure was real the review grade moves `ease` through the front door.

## Anti-repeat rotation

The user's complaint, verbatim: 有的重复的我都眼熟了，明显做过了. Nothing in
the app today remembers what it showed yesterday — `weightedShuffle` is
per-session, so the same prompt can recur on consecutive days while dozens
sit unseen.

The fix is a device-local record, **not synced data**: "which prompts these
eyes have seen" is per-device by nature, costs nothing to lose, and
progress.json sits under a 1 MB API ceiling that word-keyed timestamps
would erode for no benefit. The machinery already exists and is already
measured: passage mode's `recentPassages` key plus `pushRecent` /
`recentWindow` in `passage.ts` — the one surface the repetition audit
found at 0% repeats is the one surface that remembers. 回想 reuses those
exports under its own storage key rather than growing a parallel copy;
recently seen prompts are demoted behind unseen ones, so an exhausted
pool degrades to today's behaviour instead of an empty quiz.

回想 wires it from day one (prompt key = the group's `zh`). Wiring the
other modes happens against the repetition audit's numbers, as its own
piece of work; the mechanism is deliberately mode-agnostic.

## Content refresh: the pools must grow without being asked

A 59-group pool at 10 questions a session is eye-familiar within weeks, and
the same staleness already applies to passages and to coverage holes the
library's growth keeps opening (every added word can mint new confusable
pairs needing notes, new candidate groups, missing 要点). Two halves:

- **On-device**: rotation above — never repeat while unseen prompts remain.
- **On the desktop**: a local scheduled Claude Code task, monthly cadence
  with catch-up-on-next-boot semantics (the user's machine is not always
  on; a missed date must slide, not skip). It scans coverage — words
  missing notes, uncovered contrast pairs, candidate triples without a
  sense group — authors the top-ups under the same validators, and
  commits. The scan-then-author steps live in a repo skill so the
  scheduled task and a by-hand session run the identical procedure.

The add-a-word checklist (which files a new word obligates: contrastNotes,
wordNotes coverage, senseGroups candidates, validators to run) is that same
skill's other face; it is documented once, in the skill, not twice.

## Structure

| File | Responsibility |
|---|---|
| `src/lib/senseGroup.ts` (new) | Types, eligibility, question building for both types, verdicts, wrongIds — all pure |
| `src/lib/senseGroup.test.ts` (new) | Tests for the above |
| `src/lib/storage.ts` | Two keys: `recentRecall`, `recallDebt` (both reuse `pushRecent`/`recentWindow` from passage.ts) |
| `src/data/senseGroups.json` (new) | The authored groups |
| `scripts/validate-sense-groups.ts` (new) | Write-side gate, `npm run validate-sense-groups` |
| `src/pages/QuizRecall.tsx` (new) | Commit gate, both question views, settlement with 巩固 |
| `src/pages/Quiz.css` | `.recall-*` additions |
| `src/pages/Quiz.tsx` | Sixth MODES entry, EMPTY_HINT, lazy-load senseGroups.json like passages |
| `src/state/store.tsx` | `consolidateWord` action |
| `.claude/skills/word-content/SKILL.md` (new) | The add-a-word checklist + the refresh procedure, shared by hand-runs and the scheduled task |

## Not doing

- **Typing anything.** `/guess` owns spelling.
- **Free-recall verification by voice or fuzzy input.** The commit gate is
  the honest budget version; if it proves too gameable, revisit.
- **Partial credit on 排序.** Chance at 1/6 is high enough already.
- **Syncing the seen-prompt record.** Per-device staleness is the actual
  phenomenon; sync would spend schema budget to make rotation *worse* on
  whichever device is used less.
- **A 排序 question over gloss-prompts.** Measured unarguable-key rate was
  the reason scenarios exist; there is no cheap version of this mode.

## Testing

`senseGroup.test.ts`: eligibility excludes groups with any unlearned or
missing member; 唤词 building picks `order[0]` as answer and never leaks it
in fillers; 排序 verdict is exact-match; wrongIds marks pick+answer /
answer-only / misplaced-only per the three cases; debt-before-unseen-before-seen
ordering; a fully seen pool still yields questions; target carried through
and dropped when unlocatable; rng injected throughout. UI untested per repo
policy.
