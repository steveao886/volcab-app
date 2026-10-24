# 近义词: words that share a Chinese meaning, side by side

## Revision 2 (2026-10-23, after the first version shipped)

Four changes, decided with the user after using the page. Where they
contradict a section below, this one wins; the sections below are marked.

### R1. Groups span the whole library (decided with the user)

§2's rule 2 ("only studied words are shown") is gone: a group is a gloss term
shared by two or more library words, studied or not. The user: 剧透没学过的词
没事儿, 没学过的也可以提前写进去.

- **Why it is also the better data shape:** under the studied-only rule a
  group's members changed every time the user studied one of its words, and
  each change made its paragraph stale. 12 of 329 paragraphs were already
  stale a few hours after they were written. Over the whole library, a group
  changes only when the library does.
- **Measured** on the live library, 2026-10-23 (1,411 words): 519 groups,
  against 329 studied-only. Only 186 of them matched a current paragraph, so
  333 paragraphs had to be written or rewritten.
- `studiedIds` goes, and `buildSynonymGroups` takes the word list alone.

### R2. A word alone in its part of speech brings its base word (decided with the user)

The user's example: 逐渐减少 holds `diminishing` (adj.) and `dwindle` (v.),
so nothing compares like with like. `diminish` (v.) is the word to set
beside `dwindle`. The user: 要把原词带上.

- **A member is lone** when none of its carrying meanings shares a part of
  speech with any carrying meaning of another member.
- **Its base word** is the first of its own `relatedForms` whose `pos` some
  other member has, and whose form is not already a member. At most one per
  lone member.
- **Lone members are taken in member order, and a part of speech an earlier
  base word brought counts as present.** In 逐渐减少 both words are lone, and
  bringing one base word for each (diminish and dwindling) doubled the rows.
  Once diminish stands beside dwindle, dwindle has its pair. *(My call.)*
- **Four guards, from the review of this revision** *(my call)*. "First
  matching related form" alone brought 123 base words, and the review read
  10–15 as wrong-sense (适时 took untimely, 简洁 chastity, 宽容 charity, 轻蔑
  dismissal); since the gate makes a paragraph name its base words, those
  would have been written into the content.
  - A member in the group through a later meaning brings none: related forms
    describe the first sense.
  - A member whose own family form is already a member brings none: it has
    its counterpart (timeliness beside timely).
  - A form is brought at most once per group.
  - The form's `zh` must share a run of two Chinese characters with the
    member's carrying meaning. This drops grief's grievous (严重的) under 悲痛,
    and costs about five right ones worded differently. It fails closed: a
    missing base word leaves the part of speech to the paragraph.
- **Measured** on `data/words.json` (519 groups): 213 mix parts of speech,
  and 77 bring a base word, 78 in all, 31 of them library words.
- **Shown** as a 同根 row under that member: the form, the related form's
  part of speech and `zh`. When the form is itself a library word, its usage
  line is shown as well. *(My call.)*
- **The paragraph compares it too**: the gate (R4) requires a group's
  paragraph to name each base word as well as each member. The runtime still
  shows a paragraph that does not; the gate is what keeps them complete.
- It comes from the lone word's own entry, so it can be any word; R1 already
  dropped the studied-only rule.

### R3. Opposites (decided with the user)

The user's observation was that an opposite is really another synonym
group (反义其实也就是另一组近义词). Asked what the opposite side should give,
they said 反义词也分清: the opposites' own differences, not just their names.

- **An opposite pair** is two members of different groups, both
  first-meaning members, one listing the other in `antonyms` (headwords
  matched case-insensitively). Restricting to first-meaning members is
  CLAUDE.md's antonym rule: an antonym hangs off a word, not a sense, so a
  word in a group through its other sense brings opposites of that sense.
- **A group's opposite group** is the group with the most opposite pairs to
  it, when that count is at least 2 and strictly greater than any other
  group's count. Otherwise the group has none.
  - Measured on the 519 groups, by the module that implements this rule:
    **149 have an opposite group**, 68 of them in pairs that pick each other.
    (A rough count before implementation said 136; it counted pairs found
    from one side only.)
  - Examples: 朴素↔奢华, 减轻↔使恶化, 安抚↔激怒, 审慎↔轻率, 疏忽↔留心,
    犹豫不决↔坚决, 贬低↔颂扬, 简洁↔冗词、啰嗦.
- **Shown** as a 反面 section after 差别在哪: the opposite group's title, its
  members (headword, part of speech, carrying meaning), and its own paragraph
  as a 辨析 note when current.
  - Every group owes a paragraph anyway (R4), so the opposite side costs no
    extra writing.
  - The opposite group is not stamped as seen: it keeps its own turn in the
    rotation. *(My call.)*
- **Every first-meaning member also gets a 反义 line**: its `antonyms`,
  joined with 、, including words not in the library. 838 of 899
  first-meaning members carry at least one. The line hides on later-meaning
  members, for the usage line's reason.

### R4. Every group has a paragraph, and adding a word keeps it so (decided with the user)

The user: 以后加新词的流程也要改一下, 确保也加到这里.

- **Groups no longer depend on progress (R1),** so the write side can compute
  every group from `data/words.json`. `validate-synonym-notes` now fails (CI
  included) when:
  - a group has no current paragraph;
  - a paragraph is current for no group (orphaned by an edit or a deletion);
  - a group's paragraph does not name each of its base words.
- **This supersedes §4's "coverage is not enforced".** A word that creates or
  changes a group cannot be committed until the paragraph is written.
- **`content-staleness --batch` reports the same debt per word**, and the
  word-content skill's map and add-word steps name `synonymNotes.json` as
  required.
- **The runtime stays lenient.** The live library can be ahead of the repo
  copy (a deletion in the app), and a group whose paragraph no longer
  matches falls back to the pieces, as before.

## Intent

The user wants a page that groups the words they have studied by a shared
Chinese meaning. Several English words often carry the same 中文 gloss, and
the page shows each one and explains the fine differences between them,
**including where they differ in part of speech** (the user's words: 甚至连他们的
不同词性的也带上).

It is a reading surface, not a quiz. The user's picture of it: like review,
something to open now and then and look at a few groups (时不时打开看看). Each
visit shows a few groups, and over time every group gets its turn.

## What exists today (surveyed 2026-10-23)

- **No page browses groups of any kind.** `/untangle`'s 并排看 + 差别在哪
  (`src/pages/Untangle.tsx`) is the closest layout. It shows up to 5 words
  with `meanings[0].zh` and the word note, then every pairwise contrast note
  among them.
- **Grouping by shared gloss can be computed today.** `glossTerms`
  (`src/lib/forget.ts`) cuts brackets, splits on `;；,，、` and strips a
  trailing 的/地. Under it, 716 terms in `data/words.json` (1,411 words) are
  shared by 2 or more words.
- **The explanations are mostly missing for this shape.**
  - `contrastNotes.json` (2,089 notes) is pairs only; no note explains a
    group of three or more.
  - Pairs that differ in part of speech, the thing the user asked for, have a
    note 4.7–11% of the time, depending on the split rule.
  - `wordNotes.json` covers 1,204 words, but a word note is written alone and
    may never name another library word
    (`docs/superpowers/specs/2026-08-06-word-notes-design.md`). It describes
    one word; it does not compare.
- **Existing content can disagree with itself.** `antipathy`'s word note says
  its object is 常是事物, while its contrast note with `aversion` says it is
  更针对人或立场. Recorded here because a page that sets them side by side
  makes it visible. Fixing it is content work, not this spec.
- **Every word has `collocations`**: 1,411 of 1,411, median 3, e.g. `averse`:
  averse to risk, not averse to, risk-averse. They are per word, not per
  sense.

## Decisions

### 1. Where it lives (decided with the user)

- A second link under 随便练练 on 今日, in the same `today-practice` style.
  - Label **看几组近义词**, meta line **按中文意思分组，并排看差别，不计入复习**.
    *(Wording is my call.)*
  - **Not a 今日安排 row.** Today.tsx's own comment gives the rule: the plan
    holds only what the scheduler asks for and what can be finished. This page
    can never be finished and counts for nothing, the same as 随便练练.
    Putting it in the list would make it read as one more chore. The user
    chose this over a plan row when both were laid out.
- Route `/synonyms`, page title **近义词**.
- It never becomes the hero card, and it adds nothing to `buildDayPlan` or
  `nextAction`.

### 2. Which groups exist (my calls, played back and not objected to)

A group is a gloss term shared by at least two **studied** words. Studied
means the word has a progress entry past `new`.

1. **Terms come from `glossTerms`**, run over **every** meaning of every
   word, not only `meanings[0]`. Stripping 的 is what puts 不安的 (adj.) and
   不安 (n.) in one group, and that is what makes part-of-speech differences
   appear at all.
2. *(Superseded by R1: groups span the whole library.)* **Only studied words are shown.** A group needs 2 or more of them, and an
   unstudied member is left out, so the page never spoils a word before its
   first review.
3. **A group that is only one word family is dropped.** If every displayed
   member is connected to every other through `relatedForms` (either
   direction, matched by headword), the whole difference is the part of
   speech: promulgate / promulgation. A family pair *inside* a larger group
   stays, and the paragraph (§3) can say so in a clause.
4. **Identical member sets merge.** Two terms with the same displayed members
   are one group, titled with both terms joined by 、 (反感、厌恶).
5. **A group whose members are a strict subset of another group's is
   dropped.** The same words are met in the larger group.
6. **A member shows its carrying meanings**: every meaning of the word that
   carries one of the group's terms, in meaning order, not `meanings[0]` by
   default. `blunt` is in 减轻 as v. 使变钝;削弱;减轻, not as 钝的.
   - In a multi-term group a member can carry the terms in different
     meanings. `grouse` and `grumble` in 抱怨、牢骚 carry 抱怨 in the verb and
     牢骚 in the noun, so both show, since part of speech is what the user
     asked to see. 6 member slots across the 17 multi-term groups are like
     this (builder check, 2026-10-23). *(My call.)*
   - A member is a **first-meaning member** when `meanings[0]` is among its
     carrying meanings, and a **later-meaning member** otherwise. §3 hides
     per-word content on later-meaning members.

**Measured on these rules as written** (live progress fetched 2026-10-23,
996 of 1,411 words studied):

| Step | Groups |
|---|---|
| Shared terms with 2+ studied members | 436 |
| After dropping single-family groups | 378 |
| After merging identical sets | 359 |
| After dropping strict subsets | **324** |

- Sizes: 206 have 2 words, 82 have 3, 25 have 4, 11 have 5 or more.
- 17 groups carry two or more terms. Titles run to a median of 2 and a
  maximum of 10 characters.
- 126 of the 815 member slots (15%) come from a word's later meaning.
- Inside the 324 groups, 406 of 722 pairs (56%) have a contrast note, and 167
  groups have a note for every pair.

The set grows as the user studies, and it is recomputed from `words` and
`progress` on every visit. Nothing about group membership is stored.

### 3. What a group shows (decided with the user, from three mockups)

The user saw three versions of one real group and chose **B as the goal,
with A wherever B is not written yet, and C's usage line kept in both.**

**Every group, either version:**

- The head: the term(s), large, and **N 个词** under it.
- **并排看**: one ruled row per displayed member:
  - the headword (`.ledger__word`, `lang="en"`) and its part of speech
    (`.pos`);
  - its carrying meanings (§2.6), each with its part of speech, as written in
    `zh`;
  - **the usage line**: the word's `collocations` joined with full-width
    、 (UI punctuation, the strings themselves are English). **First-meaning
    members only.** Collocations are per word, and on a later-meaning member
    they describe the wrong sense: `blunt`'s are blunt instrument and a blunt
    reply, in a group about 减轻. It is the same reason
    `buildSentenceQuestion` renders only `meanings[0]`. A member without the
    line simply has none. *(My call.)*

**B: the group has a current paragraph** (§4):

- **差别在哪**: the paragraph, as a 辨析 `.margin-note`. It covers the parts
  of speech and the fine differences in one text.
- No per-word 要点. The paragraph already compares, and four red notes above
  it made the page long in the mockup.
- Members are listed in the order the paragraph lists them (`members` in
  §4), so an author who orders by intensity gets a scale for free.

**A: no current paragraph:**

- Under each **first-meaning** member, its word note as the 要点
  `.margin-note`, when it has one.
- **差别在哪**: the contrast note of every pair whose **two members are both
  first-meaning members**, each under its pair (`A 和 B`, the `/untangle`
  markup). Then one faint line, **其余 N 对还没有辨析**, when N > 0, with N
  counting every other pair. With no notes shown the section is that line
  alone. *(My call: the honest count is what tells the user this group is
  unfinished, and it is the list B fills in.)*
- **Why word notes and pair notes follow the usage line's rule** *(my call,
  from the builder check)*: they are per word and per pair, not per sense,
  just like collocations.
  - 125 of the 128 later-meaning slots have a word note, and some describe
    another sense: `assuage` in 满足 would show 宾语是情绪本身——恐惧、内疚、
    疑虑, which is about 缓和.
  - 87 of the 407 pair notes A would show involve a later-meaning member.
    `appease|assuage` inside 满足 compares 安抚.
  - Failing closed throws away the ones that happen to cover every sense
    (`blunt`, `troubled`, `repel`), which B replaces anyway. A note about the
    wrong sense is a false anchor, the same reasoning as CLAUDE.md's rule on
    rendering only `meanings[0]`.
- Member order: first-meaning members first, then the others, each by
  headword. *(My call.)*

**The page around the groups:**

- The page header's lead says **第 n 组，共 m 组**.
- The bottom button is **下一组**, or **看完了** on the last group. It is
  primary and block, with a printed `.key` Enter.
- Enter triggers it on **keydown with `preventDefault()`**. CLAUDE.md's
  组句 bug was exactly a keydown handler that moved focus and let the
  keypress click the next button.
- The end screen says **看完 m 组**, with **再看 m 组** (Enter) and **回今日**.
- No links from headwords and no speech, in this version.
- Built from `.section`, `.section-head`, `.ledger` and `.margin-note`, no
  cards. Cinnabar appears only in the margin notes, which are marks.
  Screenshot it at 375px.

### 4. The paragraphs (B)

Bundled, read-only study content, like `contrastNotes.json`:
`src/data/synonymNotes.json`.

```json
{ "notes": { "反感": { "members": ["averse", "aversion", "antipathy"], "text": "…" } } }
```

- **Keyed by a term** of the group it was written for. `members` lists the
  word ids it was written about, in display order.
- **Current means the set of `members` equals the group's displayed set.**
  The runtime looks for a current note under any of the group's terms and
  shows B if it finds one, A otherwise.
  - A paragraph is never shown over a group whose members differ from what it
    discusses: it could name a word the list does not show (an unstudied
    word: a spoiler), or say nothing about one it does show.
  - When the user studies a new member, that group goes back to A until the
    paragraph is rewritten. That is the fail-closed direction.
- **Paragraphs are written for groups as they are displayed** against live
  progress, in the order the page would show them (§5), so the first ones
  written are the first ones read.
- **Study-content punctuation**: half-width, like `contrastNotes.json` and
  `wordNotes.json` (CLAUDE.md, *UI text is Chinese punctuation*).
- **Production follows CLAUDE.md's division of labour**, under the
  word-content skill's probation rule: Sonnet drafts the Chinese, the
  orchestrator rewords it line by line, and the user reads.
  - The first batch is 30 groups. Its commit records the reword rate.
  - The length cap is set from that batch: re-measure, then write it into the
    validator.
- **Not part of the page build.** The page ships first, with every group on
  A. Paragraphs land in content rounds afterwards.

**Validator** `scripts/validate-synonym-notes.ts`, added to `npm run
validate`, which then runs ten gates (update CLAUDE.md's "nine"). It runs over
`data/words.json`:

- every key is a `glossTerms` term of a carrying meaning of every listed
  member;
- `members` has 2 or more ids, all exist, and none repeats;
- `text` is non-empty, within the cap, and names every member's headword.
  Match a whole word or one of its inflections, not a substring:
  `averse` must not pass on aversion. Reuse `src/lib/headword.ts` if it fits.
- It cannot know which words are studied (that lives in `volcab-data`), so
  staleness against live progress is checked by the listing script below,
  not by the gate.

**Listing script** `scripts/synonym-todo.ts` (`npm run synonym-todo`), the
content round's to-do list. It reads live progress through `gh`, the way
`check-live` does, then prints the groups without a current paragraph in
page order (§5). Each entry gives its term(s), displayed member ids, and
whether a stale paragraph exists. Never in CI.

### 5. Which groups a visit shows (decided with the user)

- **5 groups a visit** *(my guess, accepted)*, or all of them when fewer
  exist.
- **Fairness: least recently seen first.** Never-seen groups come first, then
  the oldest last-seen.
- **Ties break by a stable hash of the group's key** (its terms, sorted and
  joined), not at random *(my call, from the builder check)*.
  - Each group is stamped at its own moment, so in practice only never-seen
    groups tie. At ship time that is every group, and the first pass takes at
    least 65 visits.
  - With random ties, `synonym-todo`'s head (§4) would be a guess at what the
    page shows next, and "first written, first read" would fail for that
    whole first pass. A hash looks arbitrary to the reader and lets the
    script and the page compute the same order from the same live progress.
  - So picking a visit takes no `rng`.
  - *Why not random:* drawing 5 at random from the 324 groups, after 65
    visits (enough to see each once), leaves 36.3% never seen while the
    luckiest group has been seen 4.8 times on average. Simulated on
    2026-10-23. The fraction is about 1/e at any library size.
- **Recently forgotten words jump the queue, capped at 2 of the 5.**
  - A group is **boosted** when any displayed member has a forget record
    (`ProgressEntry.forgot`, any kind) newer than the group's last-seen
    time. A never-seen group counts as older than any record.
  - Boosted groups are ordered by their newest such record, and at most 2 go
    in. The rest of the visit comes from the rotation.
  - Once seen, a boosted group goes to the back like any other, because its
    last-seen is now newer than the record.
  - *Why the cap:* at the live library's 5.85 lapses a day, with 625 of 996
    studied words sitting in some group (1.67 groups each), a day's
    forgetting boosts about 6.1 groups. Uncapped, that fills every visit and
    the rotation never moves. *(My call, told to the user.)* 其实没忘 writes
    no record, so it boosts nothing.
- **What counts as seen**: a group is stamped when the user leaves it with
  下一组 / 看完了, one write per group as it is left. A group open when the
  page is closed is not stamped; that fails toward showing it again.
- **再看 m 组** picks again with the stamps just written, so it continues
  the rotation.

### 6. The seen record (synced)

`Progress.synonymSeen?: Record<string, string>`: term → ISO timestamp of the
last time a group carrying that term was left.

- **Synced, not localStorage** *(my call, accepted)*: the user reads on
  Windows and Android, and the rotation should be one rotation.
- **Stamping a group stamps every one of its terms.** A group's last-seen is
  the latest of its terms' stamps. Keying by term keeps the record valid as
  merges and subsets shift with what is studied.
- **Optional**, like every added synced field: an older build pushes progress
  without it.
- **Merged per key, later timestamp wins**, the `mergeDiverge` pattern, in
  `mergeProgress`. Both values come from `toISOString()`, so a string compare
  orders them.
- **Size, and the next limit.** The map is bounded by the number of shared
  terms in the library, not by time. With all 716 stamped it is 23,303 UTF-16
  units, 0.89% of the 2,621,440-unit localStorage quota the progress cache
  lives under (WebKit's 5 MiB, as `Progress.tangles` records it; 0.88% in an
  earlier draft divided by an estimate). The quota itself stays the nearer
  ceiling, and the forget log and tangles are what move it (CLAUDE.md).
- **It writes nothing the scheduler owns**: `due`, `intervalDays`, `ease`,
  `lapses`, `state`, `missedAt` and `lastReviewedAt` are untouched. The write
  goes through the store like `recordForget`. `src/state/` is data-safety
  logic, so read `store.test.tsx`'s header first.

## Goals, non-goals, anti-goals

- **Goals**
  - Every displayed group can be reached, and the rotation is fair: no group
    is seen a second time by rotation before every group has been seen once.
  - A group shows its members' parts of speech, their carrying meaning and
    usage, and whatever explanation exists, honestly marked when it is
    incomplete.
- **Non-goals, for this version**
  - a question or quiz on the page;
  - scheduling groups by spaced repetition, or any self-rating;
  - a 今日安排 row or the hero card;
  - editing paragraphs in the app;
  - unstudied words;
  - links from headwords, speech;
  - fixing existing contradictions between word notes and contrast notes;
  - writing the paragraphs (content rounds after the page ships).
- **Anti-goals.** It has failed even if it works when:
  - it writes anything the scheduler owns;
  - a paragraph is shown over a member set it was not written for;
  - a usage line, 要点 or 辨析 describes a sense other than the one the group
    is about;
  - boosted groups starve the rotation: a visit with fewer than 3 rotation
    picks while rotation groups remain.

## Success and failure conditions

- **Fairness, testable in `src/lib`**: simulate visits with no forget
  records. Every group must be seen once before any group is seen twice, and
  with the cap at 2 the same must hold for the rotation picks when boosts are
  injected.
- **Failure: the order is not fair.** If any group is seen twice before
  another is seen once in that simulation, the order is wrong. It is not a
  tuning question.
- **Failure: size.** If `synonymSeen` ever holds more keys than the
  library's shared terms, something is stamping wrongly.
- **Content probation**: as in §4. A reword rate above 1 in 4 brings the
  paragraphs back to the orchestrator.

## Constraints (from CLAUDE.md)

- Pure logic in `src/lib/*.ts` with colocated tests:
  - building groups;
  - picking a visit;
  - choosing A or B and assembling the content;
  - the merge.
  UI gets no component tests. The visit order is deterministic (§5), so it
  needs no `rng`; anything random added later takes an injected one.
- Read side lenient: a malformed `synonymSeen` value, a note whose members
  are unknown, or a word deleted mid-visit is skipped, never thrown on.
- 375px is the design width. Screenshot the page there, in both themes.
- Correctness by color alone does not apply (nothing is graded), but every
  shortcut is printed on its control.
- `noUncheckedIndexedAccess` is off: guard indexed access by hand.

## Left to the builder

- Module names and how the lib splits, e.g. `src/lib/synonymGroups.ts`.
- Exact store action shape (e.g. `markSynonymsSeen(terms)`).
- Pair-note order in A (pair score, or member order).
- Empty state when fewer than one group exists (a new library): the link
  stays and the page says so.
