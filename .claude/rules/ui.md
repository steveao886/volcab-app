---
paths:
  - "src/**/*.css"
  - "src/pages/**/*.tsx"
  - "src/components/**"
  - "src/styles/**"
  - "src/lib/theme.ts"
  - "src/main.tsx"
  - "index.html"
---

# UI rules: design language and browser debugging

Moved out of `CLAUDE.md` on 2026-11-13. Comments and specs written before that day cite "CLAUDE.md" for what is here (its "Design language" section, the 组句 keydown bug, the `.quiz-progress` and `.word` bugs). Root `CLAUDE.md` keeps the invariants; this file has the vocabulary and the evidence.

## Design language

Mobile-first; **375px is the design width** and layouts must not overflow it. The look is **朱批** (since 2026-09-23; `src/styles/tokens.css`, spec `docs/superpowers/specs/2026-09-23-zhupi-redesign-design.md`): the marks a Chinese reader makes in a book, on 月白 paper in 墨 ink. **Cinnabar (`--accent`) is for marks only** — 勾 / 叉 / 圈, the 波浪线 under a headword in its example, 着重号 on the active tab, the 旁批 usage note, and destructive actions — never a heading color or a decorative fill. Correct is 石青 blue, not green.

The ink-and-paper look it replaced had drifted into the generic default: cream ground, serif-plus-vermilion, identical rounded shadowed cards, tracked all-caps English eyebrows, monospace digits, ` · `-joined meta. **Don't reintroduce those** — they read as template on sight.

**Pages are built from the vocabulary in `components.css`, not from cards** (round 2, spec `docs/superpowers/specs/2026-09-23-zhupi-round2-design.md`): `.section` + `.section-head` (a ruled head), `.ledger` (ruled rows: main/value or label/value), `.readout` / `.readouts` (a number over its label; 界栏 hairlines between cells, never around), `.key` (a printed shortcut), `.ruled-row` (复习's grade row, shared by 练习 and 回想), `.margin-note` (the 旁批), `.mark-tick` (勾), and `StateDot`'s shapes — hollow ring 未学, half ring 学习中, solid dot 已掌握 (the two solid dots told state by color alone until then). Quiz result pages use `QuizResult.tsx`'s `ResultScore` and `MissedWords`. **A `.card` survives only as the flip target, a self-contained prompt, or something that floats**, and says which in a comment.

**Every `var(--accent)` in `src/pages/*.css` and `src/styles/*.css` carries a `/* mark: … */` comment naming the mark it draws.** `grep -n "var(--accent)" src/pages/*.css src/styles/*.css | grep -v "mark:"` must print nothing (33 hits, 0 unnamed, 2026-11-06).

**Charts take `--chart-1` 黛紫 then `--chart-2` 赭石, never cinnabar and never a status color.** Both passed the dataviz skill's `validate_palette.js` on all four grounds — `#ECF0EF`, `#F7F9F8` light, `#15181B`, `#1C2024` dark; worst CVD pair ΔE 25.1 light / 23.5 dark. Change either value and re-run all four. A state breakdown (掌握分布) is status and keeps `--state-*` with text labels. The one cinnabar thing a chart carries is the today tick on its time axis.

**UI text is Chinese punctuation.** No ` · ` joins (0 left in UI code, from 39), and , : ? ! ; ( ) beside a CJK character are full-width (172 commas and 88 others converted on 2026-09-23; `「」` quotes a term). Two exceptions are deliberate: AddWord's `[,，、]` split regex, and the etymology example `ab-(离开) + rogare(提议) → 废除`, which shows the data's own format. A label and its key is the label plus a `.key`, not `提交 · Enter`. Study content (`meanings[].zh`, `wordNotes.json`, …) still uses half-width punctuation — changing it is content work, a separate decision.

**Light and dark are a 设置 choice (外观: 跟随系统 / 浅色 / 深色), per device.** The dark palette is `:root[data-theme='dark']`, not a media query; `src/lib/theme.ts` decides the attribute, and `index.html` makes the same decision inline before first paint — change the two together. The choice lives in `localStorage` `volcab.theme`, outside `storage.ts`'s `KEYS`, so logout does not reset it.

**Both serif faces are bundled** (fontsource, `src/main.tsx`) because the user reads on Windows and Android, which ship no usable Song face. They load as `unicode-range` slices and are runtime-cached, never precached: a cold 今日 costs 1,358 KB of the CJK face's 6 MB. Latin glyphs come from Source Serif 4, CJK falls through to Noto Serif SC; `:where(p, li)[lang='en']` gets `--lh-latin`, because Song's 1.75 leading reads double-spaced on English.

**A page stylesheet ties with `components.css` on specificity and wins by load order.** `.quiz-q__prompt` quietly overrode `.word`'s size for the word2meaning headline until 2026-09-23. When a page class and a component class share an element, restate the property on the compound selector.

Correctness must never be conveyed by color alone — quiz options carry a text tag as well as a color, for colorblind users and screenshots.

Keyboard shortcuts must be printed on the control they trigger. An undocumented shortcut does not exist.

## Browser and UI debugging

- **Handling a key on keydown and moving focus in the same handler is the dangerous combination.** Chrome activates a focused button on the **keypress**, delivered to whatever holds focus when it is dispatched — not to the element that got the keydown. 组句 submitted on keydown, disabled the input and focused 下一题 in that same handler, so the rest of the press clicked 下一题 and the verdict lived 0.7ms. The fix is one `e.preventDefault()` on the keydown. 拼写 is safe because it submits through the form's *implicit submission*, which **is** the keypress's default action; 回想 is safe because each auto-focused button consumes its own keypress before handing focus on.
- **`mcp__Claude_Browser__computer` cannot activate a button by keyboard at all** — its synthesized key events carry no default action, so a focused button scores zero clicks on Enter and on Space. Every negative result it gives about keyboard activation is an artifact. `mcp__chrome-devtools__press_key` dispatches the real thing. **Prove the tool can reproduce a mechanism before trusting it to disprove one.**
- **HMR lies.** When behavior does not change after an edit, force-refresh before concluding the fix did nothing.
- **For screenshots, use `mcp__chrome-devtools__take_screenshot`, not the Browser pane's.** Measured 2026-09-23: the pane's screenshots time out, come back stale after a hash navigation, or tile 2×2 after a scroll. chrome-devtools is reliable and can save to a file. Its `emulate` resets whatever you omit — pass `viewport` *and* `colorScheme` every call, or a color switch drops you to 1440px and reloads the page.
- **`:not()` counts its argument's specificity.** `.chip:not(.chip--static):not([aria-disabled]):hover` is four classes and beat `.chip[aria-pressed='true']`'s two, so a pressed chip under the pointer — or after a tap on Android, which keeps `:hover` — drew ink text on its ink slab. The first fix, restating the pressed rule with `:hover`, is three and still lost; it shipped in a commit as fixed and a reviewer caught it. Exclude the state from the hover rule instead (`:not([aria-pressed='true'])`), and verify with a real pointer: chrome-devtools `hover`, then read the computed `color` — no screenshot at rest can show this bug.
- **A shared class name is a layout contract, not a look.** `.quiz-progress` is a
  grid container and reusing it for a one-line counter stacked 第 / 1 / 8 / 题 onto
  four lines; `.word` is the 34px headword face and reusing it for a list of
  answers clipped `apathetic` off the card at 375px. Both passed tsc, lint and
  the whole suite, and both were visible in the first screenshot. **Screenshot
  any new screen at 375px before calling it done** — no other check in this repo
  looks at layout.
- **Play the thing, with a wrong answer.** 发散's typo tolerance was measured,
  specified and unit-tested, and the first real typo typed into the finished
  screen was rejected: a swap of two adjacent letters is two edits under plain
  Levenshtein, and a swap is the commonest slip there is. Tests written from the
  same model as the code share the model's blind spot.
- **Play a scenario in 演示模式, not on the live library.** The dev build's login page has a demo mode. It loads the bundled `data/words.json` and boots whatever `volcab.progress` holds in localStorage, and it never touches the network. In an isolated chrome-devtools context (`new_page` with `isolatedContext`), seed `volcab.progress` by script with the state you need, then click 演示模式. 120 review words due was how the review cap was played on 2026-11-05 without one real grade. The plan for that change had said there was no mock mode, and it would have asked the user for permission to grade their real words.
