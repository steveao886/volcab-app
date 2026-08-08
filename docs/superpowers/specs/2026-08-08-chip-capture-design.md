# Capture from the card: tapping a synonym stages it

Date: 2026-08-08

## What this is

On the back of a review card and on the word detail page, the synonym,
antonym, collocation and related-form chips are static labels. This makes
them tappable: one tap drops that word into the staging area
(`staging.json`), the same place the `/add` capture box and `/discover`
write to.

The motivation is throughput on the capture end. Reading `culpable` and
seeing `blameworthy`, `at fault`, `culpability` is the moment you know you
want those words. Today that moment costs a trip to `/add` and typing the
word again, so it does not happen.

## What this is not

**Promoting a staged word into the library is out of scope.** That chain
already exists and lives outside the app: `.claude/skills/word-content/`,
`docs/word-add-checklist.md`, and `scripts/content-staleness.ts`. A new
word obligates contrast notes, a word note, possibly a sense group, and
passage coverage; none of that can happen in a browser with no model
behind it.

This is worth stating because the feature changes the economics. Capture
drops from "type a word" to "tap a chip", while the authoring cost per word
is unchanged: every promoted word requires a contrast note for each new pair
and a 要点, both gated. Measured on 2026-08-08, `content-staleness.ts`
reports the required gates clean over a 498-word library (325 pairs, 59
sense groups, 34 passages) and STALE only on pool growth — 46 words with no
sense-group anchor. Clean today; the point is that a faster capture end
compounds against a hand-authored back end.

The status model below is partly a response to that: it refuses to let
you re-stage what you already have, so the queue only grows with words that
are genuinely new.

## The state model

No new synced field. Each chip's text goes through the existing
`checkCapture` (`src/lib/stagingCapture.ts`), which already distinguishes
exactly the cases needed:

| Status | Renders as | Marker |
|---|---|---|
| `addable` | `<button>` | none |
| `in-staging` | `<span>` | 已加入 |
| `in-library` | `<span>` | 已有 |
| `inert` | `<span>` | none |

`inert` is the empty / whitespace-only chip — today's behaviour exactly, a
plain static label. It exists so the row never has to decide what a button
staging nothing should do.

`addStaging` (`src/state/store.tsx:850`) updates local state **before** it
awaits the push. So the chip flips from `addable` to `in-staging` on the
same render pass as the tap. **The state transition is the feedback** —
there is no toast and nothing to reconcile when the push later succeeds or
fails. If the push fails the word is still staged locally and still queued
(`appendPendingStaging`), so "已加入" remains true; this is the same
reasoning as the comment at `src/pages/AddWord.tsx:154`.

The row does hold one piece of local state, and it is not about feedback:
see Accessibility below, where a set of what this row staged keeps a tapped
chip from unmounting out from under the keyboard focus that is on it.

The markers are **text, not color**. CLAUDE.md: correctness must never be
conveyed by color alone.

### Why no undo

Rejected. `mergeStaging` (`src/state/sync.ts:197`) is a union, and
`pushStaging` resolves a conflict as `merge(remote, pending)` — a locally
removed item would be resurrected by the remote copy on the very next
conflicting push. There is no delete path for staging anywhere in the app;
removal happens during promotion, by editing `volcab-data/staging.json`
directly (checklist step 6). Adding one means changing `src/state/sync.ts`,
which CLAUDE.md classifies as data-safety logic rather than wiring.

The cost of the alternative is small and bounded: a mis-tap puts one extra
headword in a list you read at the start of the next enrichment session.
The grade buttons sit **above** the card (`src/pages/Review.tsx:405`
explains why), so the flow after flipping is "grade", not "tap the card
again" — the card is not re-tapped in the common path, and the mis-tap
window is narrower than it looks.

### Collocations are staged verbatim

`culpable negligence` stages as `culpable negligence`, not as `negligence`.
Extracting "the other word" from a collocation requires guessing which half
is the interesting one, and guessing wrong produces a staged entry that has
to be deleted by hand. Fail closed: stage the literal text of the chip.

## Components

**`src/lib/stagingCapture.ts`** — `chipCaptureStatus` joins `checkCapture`
here rather than in a module of its own: it is the same question about the
same two data sources, and splitting them would have left one concept in two
files. The module moves from `src/pages/` to `src/lib/` in the process — it
was already pure with a colocated test, and a second surface now asks it, so
`lib/` importing from `pages/` was the alternative.

**`src/components/CaptureChips.tsx`** (new) — reads `words`, `staging` and
`addStaging` from the store itself, so both call sites are one line.

```ts
interface CaptureChip { word: string; label?: ReactNode }
function CaptureChips(props: { items: CaptureChip[]; className?: string }): JSX.Element
```

`word` is what gets staged; `label` overrides the rendered content for
related forms, which show `form + pos + zh` rather than bare text.

**It renders the chips and nothing else.** The section heading and the row's
spacing stay with the page, passed in as `className`. The two pages lay their
tag blocks out differently (`.review-tags` vs `.worddetail-tag-group`, which
carries separator rules), and unifying that is not what this change is for.

**`src/components/Chip.tsx`** — gains one optional prop, `toggle` (default
`true`). When false, `aria-pressed` is omitted. An interactive chip today is
always a filter toggle, so `aria-pressed` is hardcoded; a capture chip is a
one-shot action and would be announced as "button, not pressed", which is
false. Making this a prop rather than relying on `{...rest}` overriding the
hardcoded attribute keeps the mechanism visible at the call site.

## Call sites

- `src/pages/ReviewCard.tsx` — `TagRow` now renders `CaptureChips`;
  the related-forms block uses it too.
- `src/pages/WordDetail.tsx` — the three chip rows are replaced. The
  related-forms block changes from a vertical `<ul>` (`.worddetail-related`)
  to the same chip row, so the four groups behave identically on both pages
  and the two pages stop diverging for no reason.

The click handler must call `stopPropagation`. The review card is itself a
`role="button"` that toggles the flip (`src/pages/Review.tsx:445`), so
without it every capture would also flip the card back. This is the same
guard the speak button already uses at `src/pages/Review.tsx:466`.

## The hit-area overlap this introduces

`.chip:not(.chip--static)::after` expands the hit area by 6px above and
below (`src/styles/components.css:377`), taking a 32px chip to the 44px
`--tap` minimum. Its comment justifies this with "filter rows lay out
horizontally, so vertical expansion won't overlap adjacent chips" — true of
the library filter row, which is one line.

Synonym rows wrap. `.review-tags__row` and `.worddetail-chiprow` both use
`gap: var(--sp-2)` = 8px. Two wrapped lines of capture chips put 12px of
expansion into an 8px gap: measuring from the lower edge of the upper line,
its hit area reaches +6px while the lower line's reaches back to +2px — a
**4px band where the two overlap**, and a tap landing there hits whichever
chip is later in DOM order. That is a wrong word staged, silently.

Fix: both rows go to `gap: var(--sp-3)` = 12px, exactly the expansion, so
the hit areas meet without overlapping. The comment on `.chip::after` is
updated — its stated premise (rows are single-line) is no longer true.

## Accessibility

The doc comment on `Chip` currently justifies static chips with "a review
card can show a dozen or more at once — making them all buttons would add a
dozen-plus pointless focus stops". That premise changes and the comment must
change with it. What preserves half of the original concern: **only
`addable` chips are buttons.** Words already in the library or already
staged stay `<span>` and stay out of the tab order, so focus stops exist
only where there is something to do.

Each button carries `aria-label={`把 ${word} 加入待补全`}` — the visible text
is the bare word, which does not say what tapping it does.

Status alone must not decide the element type, or keyboard focus breaks: a
tapped chip becomes `in-staging`, `in-staging` renders as `<span>`, and the
focused `<button>` would unmount under the cursor — focus falls to `<body>`
and the next Tab restarts from the top of the page. So a `captured` set records
what this row staged, and a chip in it stays a `<button>` for the life of the
row, gaining
`aria-disabled="true"` and the 已加入 marker instead of unmounting.
`aria-disabled` does not block activation the way `disabled` does — but
`disabled` blurs the focused element, which is the bug being avoided — so
the handler returns early when the chip is no longer `addable`. Chips
that were already staged or already in the library render as `<span>`. This
mirrors the local `settled` set in `src/pages/Discover.tsx:45`, and for the
same reason: the list must not reshape under the finger.

`stopPropagation` runs on a spent chip too, not just a live one — otherwise
a second tap on 已加入 would fall through to the card and flip it away.

## Testing

Per CLAUDE.md, logic goes to `src/lib/`, and the render layer gets no
component tests. `src/lib/chipCapture.test.ts` covers:

- empty string and whitespace-only → not `addable`
- case and internal-whitespace differences fold (`Put  Off` = `put off`)
- a headword whose library id hyphenates a space (`ad hoc` / `ad-hoc`) is
  recognised as `in-library` either way
- already in `staging` → `in-staging`
- library takes priority over staging when a word is in both
- a multi-word collocation with no match → `addable`

## Verification

`npm test && npm run build && npx oxlint` — 817 tests, clean build, clean
lint.

Measured in the dev preview at 375x812, dark theme, on `/word/imperious`
(two synonyms already in the library) and on a flipped `/review` card:

- `domineering` / `overbearing` render as `<span>` + 已有; the rest are
  `<button>` with `aria-label="把 X 加入待补全"` and no `aria-pressed`.
- Tapping stages: the chip becomes `<button aria-disabled="true">X已加入</button>`,
  `document.activeElement` is still that button, and `/add` then lists the
  word under 待补全 — the round trip the whole feature exists for.
- Tapping a chip on the review card leaves `aria-expanded="true"`: the card
  does not flip. Tapping a spent chip likewise.
- **Three rows wrap on that page, and all three measure a 12px line gap and
  0px hit-area overlap** — the wrapping is real, so the 8px gap really would
  have overlapped by 4px.
- `scrollWidth === clientWidth === 375`: no horizontal overflow.

One measurement trap worth recording: with the preview pane hidden the page
composites no frames, so a CSS transition never advances and
`getComputedStyle` keeps returning the *starting* value. The settled chip's
background read as `transparent` for that reason alone. Setting
`transition: none` before reading gives the true value
(`--surface-sunken`).
