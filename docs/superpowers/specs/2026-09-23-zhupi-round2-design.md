# 朱批 redesign, round 2: every remaining screen

Round 1 (`2026-09-23-zhupi-redesign-design.md`, live since commit `3e2fa85`)
built the system — tokens, bundled fonts, the page shell — and redrew 今日,
复习 and the shared multiple-choice question. Every other screen picked up the
new colors and type on its old layout, so today the app is two apps: a ruled
paper 今日 next to a 测试 hub of rounded cards, a 数据 page drawing its bars in
cinnabar, and state dots that tell 学习中 from 已掌握 by color alone.

Round 2 finishes the job. It adds no features and changes no behavior except
where this spec says so explicitly.

**Read round 1's spec and CLAUDE.md's "Design language" section first.** This
document assumes both and does not repeat their rules.

---

## 1. Executing this spec (read before touching code)

The user asked for the whole round to be built without check-ins and to be
called when it is done. Build it, verify it, commit it in the phases of §8,
then report. **Do not push or deploy** — the user decides that after looking.
(Round 1 was pushed only on the user's word.)

### Setup

1. Work on a branch off current `master`. `npm run check-live` is not
   needed: this round touches no content.
2. Start the dev server with `preview_start` `{name: "volcab-dev"}`. Never
   from a shell (CLAUDE.md).
3. Log in with **演示模式(仅开发)** on the login screen.
4. **Load real progress, or half the screens are empty.** Demo mode starts
   with none, which leaves 数据 blank and hides the review card's front face
   (new cards open on the back). In a shell:
   `gh api -H "Accept: application/vnd.github.raw" repos/steveao886/volcab-data/contents/progress.json > scripts/out/live-progress.json`
   (`scripts/out` is gitignored; the file may already be there from
   2026-09-23 — re-fetch it anyway, progress moves daily). Then in the page:
   `localStorage.setItem('volcab.progress', await fetch('/volcab-app/scripts/out/live-progress.json').then(r => r.text()))`
   and **`location.reload()`** — a hash navigation does not reload the store,
   so without the reload nothing changes. Measured 2026-09-23: 811 word
   entries, 60 days of `dailyStats`.

### Browser-pane quirks measured in round 1

- The first `screenshot` after a `navigate` often times out. Take it in its
  own call, not batched behind the navigate.
- After scrolling, screenshots sometimes come back blank. Use `get_page_text`
  / `read_page` for structure and screenshot the viewport at the top, or
  scroll with `javascript_tool` (`scrollTo`) and retry.
- `zoom` returns the full screenshot, not a crop.
- A screenshot can look cropped on the right when the pane is narrower than
  the emulated viewport. Before concluding a page overflows, measure:
  `document.documentElement.scrollWidth` vs `clientWidth`.
- Dark mode: `resize_window` with `colorScheme: "dark"`.

### Verification loop, per screen

375px light → 375px dark → overflow check (`scrollWidth === clientWidth`) →
one wrong answer played through (CLAUDE.md "Play the thing, with a wrong
answer") → keyboard shortcuts still printed. Then 1280px light once per phase.

---

## 2. Shared vocabulary

Build these once, in `src/styles/components.css` (or a component where
behavior is involved), before touching any page. Every page below is
described in terms of them.

### 2.1 Section head — `.section-head`

Heading text with a hairline running out to the right edge. It is
`.today-plan__title` today; lift that rule out of `Today.css` into a shared
class and switch 今日 to it. Song, `--fs-base`, weight 700, letter-spacing
0.04em. This is what replaces "a card with a title in it" everywhere.

### 2.2 Ruled list — `.ledger`

Rows divided by `--rule` hairlines, no box around the list, a
`--rule-strong` rule on top. A row is ≥ 48px and, when it is a link, the whole
row is the hit area and gets `--surface-sunken` on hover. Variants:

- `.ledger__row` — primary text left, secondary text under it, a value or
  chevron right.
- `.ledger__value` — tabular Source Serif numerals, right-aligned.

Replaces: the 词库 word list, the 测试 hub's card grid, 数据's row lists, the
设置 account block, the quiz result's wrong-answer list, 推荐's entries.

### 2.3 Readout — `.readout`

One number and its label: the number in `.num` at `--fs-xl` weight 600, ink;
the label `--fs-sm` muted, **under** it. No box, no accent color. A row of
readouts is a grid with `--rule` hairlines between cells (界栏), never three
tinted tiles. Replaces `.stat`, `.stats-tiles`, and the hero numbers on 数据.
`.stat__value--accent` (the cinnabar streak) goes: a streak is not a mark.

### 2.4 Cards: when a box survives

`.card` remains **only** where the box is itself the object:

- the review/practice card (it is the flip target),
- a question card that holds a self-contained prompt inside a larger page
  (回想's sentence, 短文's passage) — and only if removing it leaves the prompt
  indistinguishable from the controls around it; try without first,
- dialogs and the update prompt (they float).

Everywhere else a card becomes a `.section-head` + content on the paper.
**Measured before this round: `Card`/`.card` appears in 16 page files**
(`grep -c "<Card\|className=\"card"`); each remaining use after this round
gets a one-line comment saying which of the three reasons it is.

### 2.5 State marks — `StateDot`

The dot for a word's state (词库, 词条详情) tells 学习中 from 已掌握 by color
alone: both are solid dots, one 藤黄, one 石青. That violates the rule CLAUDE.md
states outright. Give each state its own **shape**, in the 圈点 family:

| state | mark | color |
|---|---|---|
| 未学 `new` | hollow ring | `--state-new` |
| 学习中 `learning` | half-filled ring (left half) | `--state-learning` |
| 已掌握 `review` | filled dot | `--state-review` |

9px, same as today. The `aria-label`/`title` stay.

### 2.6 Chart palette

Cinnabar is for marks, so it cannot be a data color — and every mineral
pigment in the palette is already a status color (石青 = correct/已掌握, 藤黄 =
学习中, 石绿 = info). Charts get two tokens of their own, **validated with the
dataviz skill's `validate_palette.js`** (all checks pass: lightness band,
chroma floor, CVD separation ΔE ≥ 20, normal-vision floor, ≥ 3:1 contrast):

| token | light | dark | name |
|---|---|---|---|
| `--chart-1` | `#6450AE` | `#8A78D6` | 黛紫 |
| `--chart-2` | `#B7722F` | `#C4843F` | 赭石 |

Measured: light passes on both `#ECF0EF` and `#F7F9F8`; dark passes on both
`#15181B` and `#1C2024`. Worst CVD pair ΔE 25.1 light / 23.5 dark. Any change
to either value must re-run the validator on all four grounds.

- One series → `--chart-1`. Two series → `--chart-1`, `--chart-2`, in that
  fixed order.
- A state breakdown (掌握分布) is status, not categorical: it keeps
  `--state-*` and must carry text labels.
- Text never takes a series color. Values and legend labels are ink/muted.
- **The one cinnabar thing a chart may carry is a mark**: the "today" tick on
  a time axis. Nothing else.
- Follow the skill's mark specs (thin marks, 2px gaps between adjacent fills,
  recessive grid). Load the `dataviz` skill before editing `statsCharts.tsx`.

### 2.7 Progress

`ProgressMarks` (round 1) replaces every remaining `.progress` bar in a
session: `Practice.tsx`, `QuizCompose.tsx`, `QuizPassage.tsx`,
`QuizRecall.tsx`. It already falls back to the bar past 28 items.

### 2.8 Keys printed on controls

Round 1's key cap (`.review-grade__key`) becomes a shared `.key` class:
hairline border, `--r-sm`, `--fs-xs`, Source Serif numerals. Replace every
"label · Enter" string with the label plus a `.key` (组句's `提交 · Enter` is
one). An undocumented shortcut does not exist, and a shortcut written as
prose next to a middle dot barely does.

---

## 3. Screens

Each entry says what changes. Anything not named keeps its layout and only
picks up §2.

### 词库 `Library.tsx` / `Library.css`

- The word list's card becomes a `.ledger`. Row: headword in the headword
  face at 18px/600, the Chinese gloss muted under it, the §2.5 state mark at
  the right.
- `练这 N 个 →` loses the arrow (a `→` appended to a label is a template
  tell). It stays a secondary button.
- Filter chips and the range chips keep their behavior. The range row's
  horizontal scroll must show that it scrolls (a cut-off chip at the edge
  already does; keep it).

### 词条详情 `WordDetail.tsx` / `WordDetail.css`

The entry itself is the same content as the back of a review card, and must
read the same:

- 要点 as the cinnabar 旁批 with a vertical label (reuse `.review-tags--note`
  or move it to a shared class — don't copy the CSS).
- Example headwords get the 波浪线 already (`.example-hit` is global).
- The stat cells (学习状态 / 到期日 / 复习次数 / 失误次数 / 遇见概率 / 回想说出)
  become a two-column `.ledger` (label left, value right), not a grid of
  centered numbers. 学习状态 shows the §2.5 mark beside its text.
- 回想出题 (太简单 / 默认 / 要多考) stays a chip group.
- `来源笔记:50-53 · 添加于 2026-07-24` → two items, no dot.
- 删除此词 stays a danger action, set apart below a rule.

### 测试首页 `Quiz.tsx` (`QuizHub`) / `Quiz.css`

A 目录 (table of contents), not a card grid:

- A `.ledger`: mode name (Song 700, `--fs-md`) with its description muted
  under it; right side, the stat (`num`) over the "ago" label.
- Order stays `orderByRecency`. The first row is no longer double-width; the
  grid reason for that (nine cards, odd count) is gone with the grid. Update
  the comment that explains it.
- 推荐 is an annotation — the reader's note on which mode to play — so it is
  cinnabar: a small `推荐` text mark beside the name. The low stat keeps its
  current emphasis rule but in ink weight, not color.
- **The hub is a tab root and should have the slip header.** It passes
  `back="/"` today. Check `git log -S 'title="测试" back="/"'` for a reason
  before removing it; if none is recorded, drop `back` so it renders like 词库
  and 数据.

### 测试结果页 (`QuizSession` results in `Quiz.tsx`)

- Score as a `.readout`, not `quiz-result__score-num` at `--fs-2xl`.
- 错题 list inside its card → `.section-head` + `.ledger`.
- The two buttons stay (primary 再测一轮, secondary 返回今日).

### 回想 `QuizRecall.tsx`

- Range and count selectors stay chips.
- `ProgressMarks` (§2.7).
- The sentence with the marked span: keep the mark on the concept as a
  cinnabar 波浪线 if it is currently a different emphasis — it is the same
  gesture as `.example-hit`, "this is the part to notice". Check what the
  mark encodes before changing it; if it carries information beyond
  "notice this", leave the encoding and only restyle.
- Reveal/grade controls (我想好了 / 想不起来 / the rating) follow the grade
  row of 复习: ruled, 界栏 dividers, keys printed.
- 6 ` · ` strings to rewrite (§4).

### 组句 `QuizCompose.tsx`

- Token chips stay chips. Blank slots and their right/wrong states follow
  round 1's marks: a correct slot 石青 with its text, a wrong one struck in
  cinnabar with the right answer shown — never color alone.
- `ProgressMarks`. `提交 · Enter` → label + `.key` (§2.8).
- **Do not touch the keydown handling.** CLAUDE.md "Browser and UI
  debugging" documents why its `preventDefault` is load-bearing.

### 发散 `QuizDiverge.tsx`

- The axis label 〔近义〕 already reads as a bracketed marginal label; keep
  it, set it in `--text-muted` Song, not accent.
- Answer slots (the `•••` hint masks) and found answers: found ones in ink
  with a cinnabar 勾 mark; the hint dots stay muted.
- One ` · ` string (§4).

### 短文 `QuizPassage.tsx`

- The passage reads as a printed page: Source Serif at `--fs-md`,
  `--lh-latin`; blanks as ruled gaps (round 1's `.quiz-blank` treatment).
- Word bank chips stay chips. `ProgressMarks` counts filled blanks.
- Answered blanks: same marks as 组句.

### 极速 `QuizSprint.tsx`

- Its options should look like round 1's choice rows (ruled, key printed,
  circle/cross marks). If it renders its own option markup, make it use the
  same classes rather than restyling a copy.
- The timer is the one live number on the screen: `.num`, ink, large; when
  under 10s it may take `--accent` — that is a mark (warning), not décor.
- `'新纪录 🎉'` → `新纪录`: no emoji (round 1 removed 今日's for the same reason).

### 辨析 / 听音 / 反义 / 猜词

Built on `ChoiceQuestion` (done in round 1) plus detail cards:

- `ContrastCard` / `AntonymCard`: two sides stacked, divided by a rule, no
  nested cards. The `本题答案` tag stays.
- 猜词's spelling input and clue purchase follow `.field` / `.input`; the
  bought-clue count reads as a `.readout` if it is a number with a label.

### 随便练练 / 顽固词 `Practice.tsx`

It reuses the review card. `ProgressMarks`; its note lines and done page
follow 复习's round-1 treatment. 13 half-width commas (§4).

### 数据 `Stats.tsx` / `statsCharts.tsx` / `Stats.css`

The largest page, and the one whose current look most contradicts the
system: cinnabar bars.

- Every section's card → `.section-head` + content.
- Headline numbers (2781, 90%, 91% …) → `.readout`, ink.
- Charts recolored per §2.6. The 7-day forecast and the per-mode accuracy
  bars are single-series → `--chart-1`. 复习旧词 / 学习新词 → `--chart-1` /
  `--chart-2` with the legend kept. The accuracy line → `--chart-1`; its
  min/max callouts stay text.
- The "today" position on the x-axis gets the cinnabar tick (the one mark).
- 掌握分布 keeps `--state-*` and its labels.
- The 7-tile block at the end (总复习次数 …) → a readout grid with 界栏 rules.
- 4 ` · ` strings + 1 in `statsCharts.tsx` (§4).

### 设置 `Settings.tsx`

- Sections (每日新词数, 间隔系数, 音效, 账号, 备份, 版本) → `.section-head` +
  content, no cards.
- Account → a two-row `.ledger` (label / value).
- The recommendation sentences under 每日新词数 and 间隔系数 stay; they
  contain `——` dashes, keep those (they are prose, not template chrome).
- The footer `Volcab · 开发预览版` → two words without the dot.

### 加词 `AddWord.tsx` / `WordEditForm.tsx`

- 快速收词 and 完整添加 → two sections under `.section-head`s, not two cards.
- Repeating groups (释义, 例句, 同根变形) → rows separated by rules, with the
  删除 action at the row's right; `+ 添加释义` stays a ghost button.
- Hint `词性 · 英文释义 · 中文释义均需填写` → `词性、英文释义、中文释义均需填写`.
- 20 half-width commas (§4).

### 推荐 `Discover.tsx`

- Each suggestion is an entry, not a card: headword (headword face) with its
  score, category label, Chinese gloss, English gloss, example (with the
  wavy headword if the example uses `ExampleSentence`; if it doesn't, don't
  add it), usage note as a 旁批 if it is the same kind of note as 要点.
  Entries divided by `--rule-strong`.
- 加入 / 不要 stay as a button pair, right-aligned under the entry.

### 登录 `Login.tsx` / `LoginGuide.tsx`

- The brand: the seal stays cinnabar — a seal is a mark by definition.
  Wordmark in Source Serif.
- The guide disclosure keeps `.disclosure`.
- `Login.css`'s one `--accent` use: justify it in a comment or remove it.

### `DevGallery.tsx`

Dev-only. Update it so it renders the new vocabulary (it is how the next
person checks a component in isolation); its 13 ` · ` strings are in scope.

---

## 4. Strings pass

Two mechanical but judged passes, over **UI strings only** (JSX text,
string literals rendered on screen, `aria-label`s) in `src/pages`,
`src/components`, and any `src/lib` module that builds UI text
(`wordIssueText.ts`, `dictionaryApi.ts` error text, sync error messages in
`src/state`). Comments are untouched.

1. **` · `: 35 occurrences** outside comments (measured 2026-09-23:
   DevGallery 13, QuizRecall 6, Stats 4, QuizCompose 3, AddWord 2,
   WordDetail 2, and one each in Quiz, QuizDiverge, QuizSprint, Settings,
   statsCharts). Each gets rewritten for what it joins: two facts → `，` or
   two elements; a list → `、`; a label and a key → §2.8. Not a blind
   replace.
2. **Half-width `,` next to a CJK character: 162 occurrences** (Settings 18,
   AddWord 20, Quiz 14, Practice 13, QuizRecall 11, QuizCompose 10, and
   others). In Song these render as a Latin comma and read cramped. Convert
   to `，` — but only where the comma sits in Chinese text. A comma inside
   English, inside a regex, or in an `en` string stays.

   A script may find candidates; a person (you) decides each one. After the
   pass, re-run the count; the expected residue is commas inside English.
3. **Tests that assert strings** will fail; update them to the new wording in
   the same commit, and say so in the message.

**Out of scope: study content.** `meanings[].zh`, `wordNotes.json`, and the
other content files also use half-width commas, and they render in the same
Song face. Changing content is content work (CLAUDE.md: apply on top of the
live copy, never overwrite it) and belongs to a separate decision by the
user. Note it in the report; don't do it.

---

## 5. App icon and favicon

`public/favicon.svg` fills `#be3c24` (the old vermilion) with `#fdfbf7`
text; `public/icon-192.png` / `icon-512.png` come from
`scripts/generate-icons.ps1`. Recolor both to `--accent` light `#b3362b` with
the glyph in `#f7f9f8`. The glyph face may move to a Song face only if a
TTF/OTF of Noto Serif SC is already on the machine — fontsource ships woff2,
which System.Drawing cannot read; don't download fonts for this. Re-measure
the safe-zone numbers the script's header asks for if the glyph changes.

---

## 6. Out of scope

- Behavior of any quiz, the scheduler, sync. `src/state/**` is data-safety
  logic (CLAUDE.md) — nothing in this round needs it except UI strings.
- Content files (see §4).
- New features, new screens, new settings.
- The desktop rail beyond what the vocabulary gives it for free.

---

## 7. Failure conditions

Any of these means the round is not done:

- A screen overflows 375px (`scrollWidth > clientWidth`).
- A state or a verdict still told apart by color alone (the 学习中/已掌握 dot
  was the known one).
- `--accent` used as a fill or text color that is not a mark. **Gate:**
  `grep -n "var(--accent)" src/pages/*.css src/styles/*.css` — every hit has
  a comment naming the mark it draws.
- A chart color that did not pass the validator on all four grounds.
- A keyboard shortcut that was printed before and isn't now.
- `npm test`, `npm run lint`, `npm run build`, `npm run validate` not green.
- A ` · ` left in a UI string (re-run the count from §4).

---

## 8. Phases and commits

Commit per phase, message leading with the finding (CLAUDE.md).

1. **Vocabulary**: §2 in components.css / StateDot / ProgressMarks adoption /
   `.key` / chart tokens in tokens.css; 今日 moved onto `.section-head`.
2. **词库, 词条详情.**
3. **测试**: hub, results, 回想, 组句, 发散, 短文, 极速, detail cards, 猜词.
4. **数据** (load the dataviz skill first).
5. **设置, 加词, 推荐, 登录, 练习, DevGallery.**
6. **Strings pass** (§4) + icon (§5).
7. **Docs**: CLAUDE.md's design section gains the vocabulary names and the
   chart tokens (rules and numbers only, no inventory); this spec's §9 filled
   in.

After phase 7: full verification (§1 loop on every screen in both themes),
then report to the user with screenshots of 词库, 测试首页, 数据 and one quiz
mode, and the list of anything left undone with the reason.

---

## 9. Measured after build

Built 2026-09-23 on branch `zhupi-round2`, one commit per §8 phase plus
two the user asked for mid-round (below). Not pushed.

### The §7 failure conditions

- **Overflow at 375px: none.** 22 routes (今日, 词库, 词条详情, the 测试 hub
  and all nine modes, 复习 and its lapses drill, both 练习 picks, 数据,
  设置, 加词, 推荐, /dev) measured `scrollWidth === clientWidth` in light
  and again in dark; the result pages of 综合, 回想, 组句, 发散, 短文, 极速
  and 练习 were checked as they were played.
- **State or verdict by color alone: none found.** The state marks are
  three shapes; 掌握分布's legend prints each mark beside its name; every
  verdict carries a word (正确答案 / 你的选择, 顺序 正确 / 错误, 没答出, 拼写差一点).
- **`var(--accent)` gate: 28 hits in `src/pages/*.css` and
  `src/styles/*.css`, 0 without a `/* mark: … */` comment.**
- **Chart colors:** `--chart-1` / `--chart-2` re-run through
  `validate_palette.js` before use — all five checks pass on all four
  grounds, worst CVD pair ΔE 25.1 light / 23.5 dark, as §2.6 measured.
- **Shortcuts:** every key printed before is printed now — 复习 1–4, 练习
  1–2 and its batch-size digits, choice options 1–4 (综合, 极速, 回想 plus
  回想's escape key), 组句's chunk digits and Enter (now a `.key` cap, not
  `· Enter`). Played with real key presses (chrome-devtools `press_key`):
  综合 1, 回想 Enter then 2, 组句 Enter — the verdict stayed on screen, so
  the load-bearing `preventDefault` still holds — 练习 1 and Space.
- **Gates:** `npm test` 1292 passed, `npm run lint` clean, `npm run build`
  clean, `npm run validate` clean.
- **` · ` in UI strings: 0.** The comment-aware scanner counted 39 at
  `master` (§4's grep counted 35).

### Other numbers

- **Cards:** `Card`/`.card` was in 16 page files. In the product it is left
  in 2 — the flip card in 复习 and in 练习, each with its one-line reason —
  plus the /dev gallery's demo of the variant.
- **Half-width commas beside CJK in UI code:** 181 by the scanner at
  `master` (§4 counted 162); 172 converted in the strings pass, the rest
  went with rewritten strings. Residue 2: AddWord's `split(/[,，、\n]/)`,
  which must keep its half-width comma, and an English comment the scanner
  misreads. One test asserted the old wording (`errors.test.ts`). A comma
  after a half-width `)` was missed (the scanner saw no CJK neighbour); the
  next pass caught it.
- **The rest of the punctuation, at the user's request after §4:** 88
  more `: ? ! ; ( )` beside CJK went full-width, four half-converted pairs
  finished by hand, github.ts's ` (HTTP …)` included (errors.ts parses
  only `HTTP \d{3}` and `rate-limited`, so the brackets are free), and 「」
  for the 词库 search term. The etymology example keeps the data's
  half-width format on purpose.
- **Icon:** `#b3362b` with the glyph in `#f7f9f8`, drawn in Noto Serif SC
  SemiBold (installed here as `NotoSerifSC-VF.ttf`; the named 600 instance,
  not a synthesized bold). Safe zone from `icon-512.png`'s pixels: glyph
  247×245 of 512 (48% × 48%), circumscribed circle 62.8% — inside
  maskable's 80%. YaHei Bold measured 69%.

### Found while building

- **A pressed chip under the pointer drew ink text on its ink slab.** The
  hover rule is four classes by way of two `:not()`s and beat
  `[aria-pressed]`'s two; Android keeps `:hover` after a tap. The first fix
  (restating the pressed rule with `:hover`, three) still lost — the final
  review caught it; the hover rule now excludes a pressed chip. Measured
  with a real pointer: color and background both `rgb(30, 34, 38)` before,
  paper on ink after.
- **An explanation on 数据 said 已掌握 takes until the next day.** It takes
  the same session (`LEARNING_STEPS`, 1 and 10 minutes); caught in review.
- **回想 and 极速 never drew the strike through a wrong pick.** Round 1's
  rule targets `.quiz-option__text`, and those two modes rendered the
  option as a bare string.
- **短文's empty blank drew two lines**: the `___` text on top of the rule.
- **词条详情 set its English definition at Song leading**: its class tied
  with base.css's `[lang='en']` rule and won on load order.
- **已掌握 counted 811 of 811 studied words** on the live library, because
  a word becomes `review` after its learning steps. See 记牢程度 below.

### Beyond the spec, at the user's request mid-round

- **答题正确率趋势 removed** from 数据, with `AccuracyTrend` and
  `accuracyStats`; `accuracySeries` stays for 今日's footer.
- **Two metrics added, both on thresholds the app already owns**, measured
  on the live progress first: **记牢程度** — studied words past
  `MATURE_INTERVAL_DAYS` (21): 525 of 811; **回想说出** — words 回想 has
  asked (456), on a streak of `RECALL_STEADY_STREAK` (3, now one constant
  shared with the draw weighting and 词条详情) or more (78), last answer
  missed (45).
- **外观: 跟随系统 / 浅色 / 深色 in 设置**, per device. This reverses round
  1's constraint "dark mode follows the system" at the user's word; the
  system still decides under 跟随系统, the default. The dark palette moved
  from a media query to `:root[data-theme='dark']`; `lib/theme.ts` and an
  inline script in `index.html` decide it, the latter before first paint
  (checked: `<html>` carried the chosen theme at the end of parsing, before
  React rendered).

### Not done

- **猜词** has no screen to redraw — the mode was retired and `/guess`
  redirects into the hub. Its stats line and record on 数据 remain.
- **Study content's half-width commas** — out of scope by §4.
- The review card front's 新词 badge keeps its tinted cinnabar fill (round
  1's); it is commented as a mark, not redrawn.
