# 朱批 redesign, round 1: the design system and the three daily screens

## Why

The ink-and-paper look shipped in July had drifted into the generic default
that generated interfaces converge on: a warm cream ground (`#f4f1ea`) under
a serif headword with a vermilion accent, identical rounded cards with the
same soft shadow, tracked all-caps English eyebrows over every page
(TODAY / REVIEW / QUIZ), monospace digits, and meta strings joined with
middle dots. None of it was wrong; none of it was *this* app's.

Three directions were mocked on 2026-09-23 (index cards, 朱批, full-bleed
type). The user chose **朱批**: the interface borrows the marks a Chinese
reader makes in a book — a 题签 title slip, 着重号 emphasis dots, a teacher's
red 勾 / 叉 / 圈, 波浪线 under a word worth noticing, and a 旁批 in the margin.
It fits the one person who uses this app, and it is the existing rule
("vermilion is reserved for annotation") taken all the way instead of
restated.

## Scope

**Round 1 (this spec)**
- Tokens: palette (light and dark), type, digits. Every page picks these up.
- Fonts: bundled Chinese and English serif faces.
- Shell: page header, tab bar, desktop rail.
- Three screens redrawn: 今日, 复习 (both faces of the card), and the shared
  multiple-choice question (综合 and every mode built on `ChoiceQuestion`).

**Round 2 (not this spec).** Layout passes on 词库, 词条详情, 数据, 设置, 加词,
推荐, and the mode-specific screens (回想, 组句, 发散, 短文, 极速); the 38 UI
strings still joined with ` · `; the app icon. Until then those pages wear the
new tokens on their old layouts.

## Constraints that came from the user

- **Devices: Windows desktop and Android.** Neither ships a usable Song face
  (Windows has SimSun, Android often has nothing), so the Chinese serif must
  be bundled. iPhone-only would have allowed the system Songti SC for free.
- **Dark mode follows the system**, as today.
- **The grade buttons stay above the review card.** They were a sticky bar
  under the card until the user reported still scrolling to grade and the bar
  covering the end of long entries (see `Review.tsx`, above `.review-actions`).
  The mocks put them back at the bottom; the user kept them where they are.

## Palette

Cinnabar (`--accent`) is for **marks**: ticks, crosses, circles, the wavy
underline, emphasis dots, the 旁批 usage note, and destructive actions. It is
never a fill for decoration or a heading color. Correct is 石青 (azurite
blue), not green: red/blue survives red-green color blindness, and every
right/wrong state still carries a text tag (正确答案 / 你的选择).

| token | light (月白) | dark (墨) |
|---|---|---|
| `--bg` | `#ECF0EF` | `#15181B` |
| `--surface` | `#F7F9F8` | `#1C2024` |
| `--surface-sunken` | `#E1E7E6` | `#101315` |
| `--text` | `#1E2226` | `#E4EAE9` |
| `--text-muted` | `#474E55` | `#AEB6BB` |
| `--text-faint` | `#5C636A` | `#949DA3` |
| `--rule-control` | `#7B838A` | `#6E777D` |
| `--accent` / `--danger` (朱) | `#B3362B` | `#E57A68` |
| `--success` (石青) | `#1D5A86` | `#7AB0DC` |
| `--warning` (藤黄) | `#855A0B` | `#D9AA4E` |
| `--info` (石绿) | `#2F6B57` | `#7DBBA3` |

Measured WCAG contrast, worst case across `--bg`, `--surface` and
`--surface-sunken`: every text token ≥ 4.82:1 in light and ≥ 5.71:1 in dark;
`--rule-control` ≥ 3.07:1 in light and ≥ 3.59:1 in dark. **Failure condition:
any text token under 4.5:1 on any of the three grounds invalidates the
palette.** Re-run the check when a value changes.

The paper-grain overlay and the vermilion tick motif (page header, tab bar)
are removed: 月白 is a flat paper, and the tick is replaced by 着重号.
Radii drop to 2px; `.card` loses its shadow and keeps a hairline.

## Type

| role | family | notes |
|---|---|---|
| UI | `Source Serif 4` → `Noto Serif SC` | Latin glyphs come from Source Serif, CJK falls through to Noto Serif SC |
| headword | `Source Serif 4` | optical-size axis on, so 48px headwords get the display cut |
| digits | `Source Serif 4`, `tabular-nums lining-nums` | replaces the monospace face; `--font-num` was left as the one knob for exactly this |
| IPA | unchanged stack | Source Serif 4's IPA coverage isn't needed to settle this round |

Source Serif 4 and Source Han Serif (= Noto Serif SC) were drawn as a pair,
which is why mixed lines like `遇见概率 7/10` sit on one baseline and one
color. The part-of-speech tag stops being tracked vermilion capitals and
becomes a muted italic `v.` — it is a label, not an annotation.

### Delivery

`@fontsource-variable/noto-serif-sc` (OFL, 6.4 MB unpacked across all
slices) and `@fontsource-variable/source-serif-4` (OFL). Both declare
`unicode-range` slices, so the browser fetches only the slices holding glyphs
actually on screen, from the app's own origin, not a third-party CDN. One
variable file per slice covers every weight.

The service worker does **not** precache them (workbox's default glob is
`js,css,html`, and precaching every slice would put megabytes on install).
A `CacheFirst` runtime route for same-origin `.woff2` keeps every slice once
fetched, so a screen seen online renders offline. A glyph whose slice was
never fetched falls back to the system face for that one character.

**Failure condition: a cold load of 今日 that downloads more than 2 MB of
fonts.** At that point the fixed-subset alternative (one precached file per
weight cut to UI strings + library text + the 3,500 common characters)
becomes worth its build-time toolchain.

## Shell

- **The English eyebrow goes.** `Page` loses the `eyebrow` prop.
- **Header, three variants**, chosen from props rather than a new flag:
  - `lead` given (only 今日 this round): a vertical 题签 — the title set
    top-to-bottom in a double-ruled slip — with the lead content beside it.
  - no `back`: the title in the same double-ruled slip, horizontal. A vertical
    slip with nothing beside it would spend 130px on 学习数据 for nothing.
  - `back`: a plain title beside the back button, sticky as today.
- **Tab bar: text only, the active item marked with 着重号**
  (`text-emphasis: filled circle` in cinnabar, under the characters). Five
  two-character labels read faster than five icons, and the dots are the one
  mark on the bar. The desktop rail keeps the seal and wordmark and marks the
  active row the same way.

## 今日

- The title slip stands at the left; beside it, the date in Chinese numerals
  (九月二十三日 星期三), the sync state, 现在该做 and the hero line
  (`12 张卡`). The explanation and the 开始复习 slab run full width below.
- The day plan drops its card and checkboxes. A todo row is an ink circle, a
  done row a cinnabar 勾, a pending row a dashed circle. Shape carries state,
  so the strikethrough goes. A reopenable done row stays a link.
- 随便练练 stays outside the plan (it cannot be finished, see `Today.tsx`), as
  a plain row with a chevron. The stats footer becomes a plain text line.
- The hero's meta drops its middle dot: `到期 12，新词 6`. The completed face
  drops its emoji.

## 复习

- Progress becomes 圈点: one dot per card, done dots filled cinnabar, the
  current one ring-heavy, the rest hollow ink. **Past 28 cards it falls back
  to the hairline bar**: 28 is what fits at 375px with 7px dots and 5px gaps,
  and a review queue often runs past that.
- The grade row stays put and is ruled like a page: four columns divided by
  界栏 hairlines, 重来 in cinnabar, the other three in ink, each with its key
  chip and interval.
- The card stays a card (it is the tap target for flipping) but flat.
- The usage note (要点) becomes a 旁批: cinnabar text with a vertical 要点
  label. It is the annotation layer by definition.
- The headword inside example sentences gets a cinnabar 波浪线 instead of a
  1px underline. This is the global `.example-hit`, so 词条详情 gets it too.

## 测试 (multiple choice)

- The question sits on the page, not in a card.
- Options are rows divided by hairlines, not boxes. The key number is printed
  on the row as before.
- Answered: the correct row turns 石青 and its key number is circled in
  cinnabar; the row you chose, if wrong, is struck through in cinnabar with
  a 叉 on its key. The mark goes on the key, not the word, because options
  include multi-line Chinese definitions that a hand-drawn loop cannot wrap.
  The 正确答案 / 你的选择 tags stay.
- Progress uses the same 圈点 marks as 复习.

## New code

- `src/lib/chineseDate.ts`: `chineseDate(d)` → `九月二十三日 星期三`.
- `src/lib/progressMarks.ts`: `progressMarks(done, total, max)` returns one
  `done | current | todo` per item, or `null` when there is nothing to show
  or more than `max` items (the caller draws the bar).
- `src/components/ProgressMarks.tsx`: renders either, and owns the
  `role="progressbar"` semantics the two call sites carry today.

## Verification

- Unit tests for both lib functions, each broken on purpose once to see it
  go red.
- `npm run build`, `npm run lint`, `npm test`.
- Screenshots of 今日, 复习 (front, back), and an answered question at 375px
  in light and dark, and at 1280px in light.
- The network panel on a cold load of 今日: which slices and how many bytes,
  written back into this spec against the 2 MB failure condition.

## Measured after build

(Filled in when the build lands.)
