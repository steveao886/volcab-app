---
sketch: 003
name: review-grading
question: "Should grading show its consequences, and how fast can it feel?"
winner: "A"
tags: [interaction, review, srs]
---

# Sketch 003: Review Card — Grading Feel

## Design Question

The four grade buttons ask for a judgment call with no visible consequence.
Can grading be more informed (show the resulting interval), or simpler
(fewer choices), or faster (gesture-based)?

## How to View

Open `.planning/sketches/003-review-grading/index.html` in a browser.
Tap a card to flip it, then grade. In variant C, drag the flipped card
left or right.

## Variants

- **A: 间隔预览** — keep 4 grades, print the resulting interval under each button (Anki-style "10 分钟 / 2 天 / 5 天 / 9 天").
- **B: 两键评分** — one binary choice per card (忘了 / 记得), with 轻松 demoted to a small text link.
- **C: 滑动评分** — after flipping, drag the card left (忘了) or right (记得); buttons remain as fallback.

## What to Look For

- Do interval numbers (A) make grading feel more honest, or add reading load ×23 cards?
- Is losing the 困难 grade (B, C) an acceptable trade for speed? (SRS
  scheduler currently uses all four grades — B/C would need srs.ts changes.)
- Does the drag gesture (C) feel decisive or fidgety at phone size?
