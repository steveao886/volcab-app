# 回想: renderings that point at one word, and the neighbours on a miss

Two user reports on 2026-11-13, both on sentence-sourced 回想 questions.

1. **cruel#4.** 造化弄人，这位马拉松选手离终点只剩半个街区，却在一个坑洼上崴了脚踝。
   with 造化弄人 marked, answer `cruel`. "翻译得很好，但是很难反着让我想到." The
   English is *Fate played a **cruel** trick*: the marked chunk renders fate,
   played, cruel and trick at once, so nothing in it points at cruel. The
   08-16 spec already says the target "is the answer word's Chinese
   rendering, not the clause around it". The validator cannot see meaning,
   so this got through.
2. **subside#4.** 她的怒气在回家的路上渐渐平息…, answer `subside`. The user
   thought of placate or assuage, took 我想的不是这几个, and the reveal named
   none of the words they had in mind. Two of them, placate and appease, have
   平息(怒气) in their own gloss, and neither fits here: both mean making
   *someone else* less angry, and here the anger dies down by itself. `abate`
   does fit. Sentence-sourced questions carry no 辨析 (`why` is absent by
   design), and subside sits in no 发散 concept, so 顺着这串练 was absent too.
   The reveal had nothing to say about the word the user actually produced.

## Goals

- A marked chunk renders the answer word and nothing around it, so the
  Chinese can be reversed back to that word.
- After a miss on a sentence-sourced question, the reveal names the words
  near the answer, each with a definition that shows how it differs.

## Non-goals

- **Saying whether each neighbour fits this particular sentence.** That
  needs a judgment per rendering × neighbour, authored or generated, over
  7,435 renderings. It is approach C below, deferred until the list alone
  turns out not to be enough.
- Changing how distractors are drawn. They are non-confusable on purpose
  (08-16 spec), so the four options stay answerable whatever the prompt
  evokes.
- Any write to progress. The new row only reads.

## Anti-goals

- A neighbour from a sense the sentence is not about: the cardSynonyms rule
  that keeps homographs off the card has to hold here too.
- A reveal so long at 375px that 下一题 drops out of reach.

## Approaches

- **A, content: re-mark the renderings that point past their word.** Chosen.
- **B, the reveal lists the answer's neighbours, with definitions.** Chosen.
- C, B plus a per-sentence "fits here / doesn't" verdict on each neighbour.
  Deferred: by far the most content, and B's English definition already
  carries the most common reason a neighbour does not fit, transitivity
  (placate: "to make someone less angry"; abate: "to become less intense").

The user picked A and B on 2026-11-13.

## A: the renderings

**Candidates, by a mechanical filter:** a target of 4 or more Han characters
that shares no character with any of its word's glosses. Measured
2026-11-13: **431 of 7,435** renderings (779 with no shared character at any
length). It is a reading list, not a verdict. 微乎其微 for infinitesimal is
fine. 造化弄人 for cruel is not. 一头雾水 serves perplexed, bewilderment and
perplexity alike, which is acceptable because the options cannot hold two of
them.

**The person reads every candidate**, as the content rules require for
Chinese, and for each one either:
- narrows `target` to a chunk that renders the word alone, if the `zh`
  already has one, or
- rewrites the `zh` so that such a chunk exists. For example, 命运跟这位马拉松选手开了个残酷的玩笑…
  with 残酷 marked.

A rendering that already points at its word stays as it is. The validator
keeps gating structure only (no Latin, target found exactly once, 16
characters or fewer), because a meaning check is not mechanical.

## B: 相近的词 on the reveal

**When:** a `recall` question with no `why` (sentence-sourced), revealed
after any miss: a wrong option, 我想的不是这几个, 想不起来, or a hint-tier
outcome. Sense-group questions are excluded, since their confusable members
are already the options and their 辨析 does this job.

**Which words, in this order:**
1. The answer's `cardSynonyms` that are in the library, in the card's own
   order. That way the row agrees with the word's card.
2. Then, same part of speech as the rendered sense: words sharing one of
   that sense's gloss terms (2+ characters) that **appears in the marked
   target**. This is the source of placate and appease for 渐渐平息. It keys
   on the Chinese the learner actually read, which is what led them to the
   word they produced.

The answer and anything printed as an option are excluded. The list is
capped at 6.

Measured over all 7,435 renderings: 1,154 get no row, the median is 2, p90
is 5 and the maximum is 11. The gloss path adds a word on 494 renderings.
For subside#4 the row is abate, ebb, then placate, appease, resolve, quash,
quell (7 before the cap).

**Each entry:** the headword, the Chinese gloss of its matching sense (same
part of speech as the answer's rendered sense, else `meanings[0]`), and that
sense's English definition beneath. The English is what shows the
difference. (Superseded by the amendment below: the English moves into the
expanded row.)

**Code:** the selection is a pure function in `src/lib/` with a colocated
test, covering the order, the exclusions, the cap, the part-of-speech
restriction, and that a gloss term absent from the target adds nothing. The
page renders the list.

## Amendment, 2026-11-14: tap any word on the reveal to read its meaning

A third report, mid-build, on a correct answer: 房东……赢得了我们的好感,
answer `goodwill`. "我没想到有好感的意思": the user wanted to read the
word's entry from the reveal. goodwill's entry is 善意;好意;友好 (80%) and
商誉;营业信誉 (20%), and 好感 is in neither as written, so reading the senses
is the whole fix. B's English-definition line and this request are the same
surface, and they were built as one.

Three ways were laid out. The user picked A.
- **A (picked): inline expand.** After the reveal, each of the four options
  and each 相近的词 row toggles a list of that word's senses beneath itself.
  It never leaves the question.
- B, a bottom sheet with the whole entry. It carries the most, but it covers
  the question, and the component would be new.
- C, the answer's senses printed and nothing else. Distractors like tyranny
  could not be looked up.

**Behaviour:**
- **Who expands.** On a revealed `recall` question, the four options do,
  whether the question is sentence-sourced or from a sense group. 排序 is
  unchanged.
- **One open at a time.** Tapping an open row closes it. A miss opens the
  answer's row, since that is the word to read; a correct answer opens
  nothing.
- **What it shows.** Every sense of the word, each as part of speech plus
  Chinese. The focus sense also carries its English definition. For the
  answer, the focus sense is the rendered sense. For any other word, it is
  its first sense of the answer's part of speech, else `meanings[0]`.
- **相近的词 rows** show the headword plus the focus sense's Chinese when
  closed, and every sense with the focus English when open: the same list
  the options open.
- **Keys.** Once revealed, 1–4 toggle the matching option. That is the
  number already printed on it, so nothing new needs printing. Toggling
  moves no focus: Enter stays with 下一题, and the keydown-plus-focus hazard
  in `.claude/rules/ui.md` cannot arise.
- **No write to progress** from opening or closing.
- `RecallQuestionView` takes the glosses as optional props. `/untangle`
  passes none and is unchanged.

## Left to the builder

- The row's markup, from `components.css` (a `.ledger` is the likely fit),
  screenshotted at 375px in both themes, and played with a wrong answer in
  演示模式.
- Whether the cap is 6 or 5, decided by what fits above 下一题 at 375px.
- Batching for A: by word id, committed per batch, with the count of
  re-marked and rewritten renderings in each message.

## What would show this is wrong

- The row is read past without being looked at (user report): drop it to
  the gloss path only, or to on demand.
- The user keeps asking "那 X 在这里能不能用": that is the signal for C.
