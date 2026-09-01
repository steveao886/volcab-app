# Architecture hardening (2026-09-01): design

An architecture review on 2026-09-01 (three read-only sweeps over `src/lib`,
`src/pages` + `src/components`, and `scripts` + CI, plus direct measurement
of the live data repo and the browser storage footprint) produced eleven
items rated "must" or "should". This document records the decisions and
tradeoffs for the ones that involve a design choice. The plan that
implements them is `docs/superpowers/plans/2026-09-01-architecture-hardening.md`.

Two items were done directly on master before the plan and need no design:
the raw NUL byte in `antonym.ts` (git treated the file as binary since
`2d0a1de`) and enabling `strict` (measured at zero errors).

## 1. The nearest hard ceiling is localStorage, not GitHub

`docs/superpowers/specs/2026-08-22-contents-api-size-limits-design.md`
established that the GitHub Contents API stops accepting writes between
40 MB and 46 MB, about 24,000 words. CLAUDE.md calls that "the real
ceiling". It is not the nearest one. Measured 2026-09-01 on the live data:

| | |
|---|---|
| live `words.json` / `progress.json` | 1,179,748 / 207,275 bytes |
| the same two, compact-serialized as `storage.set` stores them | 840,626 + 136,998 = 977,624 UTF-16 code units |
| per word, words cache + progress entry | ~1,400 code units |
| Chromium localStorage quota (10 MiB, counted in UTF-16) | ~3,700 words |
| WebKit / Firefox quota (5 MiB) | ~1,900 words |
| growth | 471 words on 2026-07-27, 717 on 2026-09-01 |

At the recent pace the WebKit line is roughly six months out. The embedded
browser used for this review accepted 38 MiB without error, so the mobile
quota could not be measured here; the word counts above rest on the
documented limits, and the plan asks for the real number to be measured on
the user's phone once the guard below is in place.

The failure mode today is the worst available. `storage.set`
(`src/lib/storage.ts:65`) does not catch, `commitProgress` writes storage
before it updates state, so at quota every grade throws inside the click
handler and is lost. On a fresh device `login` writes the words cache inside
a `try` whose `catch` shows the raw exception text as the login error, so a
new phone cannot log in at all. `pronounce.ts:99` already catches quota for
its own cache, which shows the hazard was recognised in one place and not
generalised.

### Decision 1a: `storage.set` never throws; the store reports the condition

`storage.set` returns `boolean` and catches everything `setItem` can throw
(QuotaExceededError, and SecurityError in some private modes). Most call
sites ignore the result on purpose: recency lists, drill markers and the
pending-op queues are conveniences whose loss costs a repeat, not data. The
store checks it for the two writes that are data, `progress` and (until 1b
lands) `words`, and surfaces `STORAGE_FULL` through `syncError` the same way
a failed push is reported. A ref remembers the condition so `markSettled`
does not clear the notice on the next successful push while the device is
still full.

The small flag write is ordered before the large payload write in
`commitProgress`. Replacing an existing small key does not grow the store,
so when the payload write fails the `dirty` flag has already landed and
`flushProgress` still pushes the in-memory state. That is what turns "quota
reached" from silent loss into "this device cannot cache, the cloud still
has everything".

Rejected: making `storage.set` throw a typed error for callers to catch.
Twenty-odd call sites would each need a decision, and the ones that matter
are exactly the two the store already owns.

### Decision 1b: the words cache moves to IndexedDB

The words cache is 86% of the footprint and is the one payload that only
grows. Moving it to IndexedDB removes the ceiling for words entirely and
leaves progress alone in localStorage, where at ~215 code units per entry
the WebKit quota is reached around 12,000 words. GitHub's write limit is
then the next ceiling again, as the 08-22 spec assumed.

`src/lib/wordsCache.ts` exposes a three-method async interface (`read`,
`write`, `clear`) over one object store. When `indexedDB` is undefined or
`open` fails, it falls back to a module-level in-memory value: the app then
simply re-downloads words on every boot, which is the lenient reading of "no
cache" and is also what the test environment gets for free (happy-dom has no
IndexedDB). `AppProvider` takes the cache as an optional prop so
`store.test.tsx` can seed a memory cache exactly as it seeds the fake
remote.

Cost accepted: `bootSnapshot` can no longer return `phase: 'ready'` on the
first frame, because the words are behind an async read. A device with a
token now renders the existing `Booting` gate until the IndexedDB read
resolves, then becomes ready from cache while the network fetch continues as
before. This is tens of milliseconds for 717 words and replaces a hard
failure that would otherwise arrive within the year.

Rejected: the Cache API (same async shape, less natural for a single JSON
value); compressing the localStorage payload (buys maybe 3x, keeps the
ceiling); `idb-keyval` (600 bytes, but a fourth runtime dependency for a
sixty-line wrapper).

The legacy `volcab.words` key is removed from localStorage on the first boot
after this change so the space is actually reclaimed.

## 2. Boot downloads 1.4 MB it usually already has

Every cold start fetches all three files with `cache: 'no-store'`. Measured
against the live repo on 2026-09-01: a raw-media-type GET with
`If-None-Match: "<blob sha>"` returns `304 Not Modified`, and the CORS
preflight for `api.github.com` lists `If-None-Match` in
`access-control-allow-headers`, so the browser can send it. GitHub documents
that a 304 does not count against the rate limit.

### Decision 2: a separate `getFileIfChanged(path, sha)` method

The client already stores the blob sha of each file after every pull and
push (`wordsSha`, `progressSha`, `stagingSha`), and `blobShaFromETag`
established on 08-22 that the raw response's ETag is that sha. So the
conditional request needs no new bookkeeping.

It is a new method rather than an optional parameter on `getFile`, so that
`getFile`'s return type stays `RemoteFile | null` and the three conflict
paths in `sync.ts` that call it without a sha do not have to handle a
`'unchanged'` value they can never receive.

`boot()` uses the conditional form only for files this device holds a valid
cache of; a file with a stored sha but no cache (a fresh device after 1b, or
a lost IndexedDB) is fetched unconditionally. On `'unchanged'` the local
copy is kept as is: local words already include any pending ops (they were
applied at save time), and merging progress with a remote that equals what
it was last merged from is a no-op.

Not done here, noted for later: with a cheap 304 probe available, the
`visibilitychange` handler could pull as well as push, so a second device's
changes appear on resume instead of on reload. That is a behaviour change
and gets its own spec.

## 3. The write-side gate is not in CI, and the repo copy drifts by hand

`deploy.yml` runs `npm test` and `npm run build`. The eight `validate-*`
scripts and `oxlint` are listed in CLAUDE.md as gates and are run by whoever
remembers. `data/words.json` has 29 commits, six of which repair the same
drift ("the repo copy kept words the user deleted in-app"), each found by a
person diffing by eye.

### Decision 3: `npm run validate`, `npm run lint`, `npm run check-live`

`validate` chains the eight existing scripts; `lint` wraps `oxlint`; both
run in `deploy.yml` between test and build. Neither needs credentials.

`check-live` pulls the live `words.json` through the authenticated `gh` CLI
(the same call HANDOFF documents by hand), compares id sets and per-id
content against `data/words.json`, prints both directions, and exits 1 on
any difference. `--write` realigns the repo copy to the live file using the
app's own serialisation so the two are byte-identical. It does not run in
CI: that would require a PAT in a repo secret, which is standing
configuration this project has so far avoided, and the check belongs at the
moment content is authored, not at deploy time.

`scripts/` is also added to `tsc -b` through `tsconfig.scripts.json`. The
scripts import functions from `src/lib` and were checked by nothing; `tsx`
strips types without looking at them.

## 4. Three word validators, one of them already drifted

`AddWord.validate` (~70 lines), `WordEditForm.handleSubmit` (~90 lines) and
`scripts/validate-words.ts` each describe what a valid `Word` is.
`WordEditForm.tsx:166` records that the first two had already diverged. The
first two have no tests, because component code gets none.

### Decision 4: one rule set in `src/lib/wordValidate.ts`, messages mapped at the edge

The lib function takes a draft and returns structured issues, each with a
stable code and the field it belongs to. It carries no prose. The form
layer maps codes to the Chinese sentences the user sees; the script maps
the same codes to English lines. Both maps are typed as
`Record<WordIssueCode, string>` so adding a rule without a message is a
compile error.

Codes rather than sentences because of the language policy: the form output
is UI and must be Chinese, the script output is developer tooling and is
English, and a single function cannot return both. The rules that stay
outside the shared function are the ones about a *file* rather than a
*word* (duplicate ids, the version field) and the ones about *form state*
rather than the word (a field the user has not touched yet).

Where the three existing validators disagree, the strictest reading wins
and the choice is recorded in the module comment. The write side is where
strictness belongs.

## 5. Two small UI rules

The sprint's option buttons colour right and wrong with no text tag, the one
remaining violation of "correctness never by colour alone". The four
`import()` effects in `Quiz.tsx` have no failure branch, so a chunk that
fails to load leaves the page on "正在加载" forever. Both get the obvious
fix; the loader gains a retry button and one hook replaces four copies of
the same effect.
