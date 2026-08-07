---
sketch: 002
name: quiz-hub
question: "How should seven practice modes be presented — chips, cards, or an index?"
winner: "B"
tags: [layout, quiz, navigation]
---

# Sketch 002: Quiz Hub — Presenting Seven Modes

## Design Question

Seven modes live in one chip switcher. Chips scale poorly: no room for
descriptions, no per-mode stats, and nothing tells you which mode is
neglected. What replaces (or augments) them?

## How to View

Open `.planning/sketches/002-quiz-hub/index.html` in a browser.

## Variants

- **A: 智能推荐 + 胶囊** — keep the chips, add a data-driven "today's pick" card on top and a description panel below the active chip.
- **B: 模式卡片** — a 2-column card grid; every mode shows its own accuracy and last-practiced date, weakest gets a 推荐 badge.
- **C: 索引清单** — dictionary-index rows with dotted leaders and right-aligned stats, topped by a single 智能开始 button.

## What to Look For

- Per-mode accuracy already exists in the data (per-mode stats shipped in
  d4922ac) — which layout makes that data earn its keep?
- A is the least change; C is the most "ink and paper"; B is the most scannable.
- Does the smart-pick concept (A's card, C's button) feel trustworthy or bossy?
