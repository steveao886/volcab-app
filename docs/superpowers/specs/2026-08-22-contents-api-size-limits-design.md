# The Contents API size limits, measured

**What is being built**: one small change to `putFile`, plus the numbers
that say no larger change is needed.

`words.json` crossed 96.5% of 1 MiB on 2026-08-22 (commit `ee6d78b`, 619
words, 1,012,363 bytes), and the batch after it will cross the line. The
open question was what breaks when it does. **Measured answer: nothing on
the size axis. The one real defect found is unrelated to 1 MiB and would
have shown up as a lie in the UI.**

Measured 2026-08-22 against a throwaway repo (`steveao886/volcab-size-probe`),
using the exact request shapes `src/lib/github.ts` sends.

---

## 1. What the 1 MiB cap actually is

GitHub documents three tiers for **reading** repository content, and none
for writing:

> "1 MB or smaller: All features of this endpoint are supported."
> "Between 1-100 MB: Only the raw or object custom media types are supported."
> "Greater than 100 MB: This endpoint is not supported."
> — https://docs.github.com/en/rest/repos/contents

"Create or update file contents" states **no size limit at all**. That is
why this had to be measured rather than looked up.

## 2. What was measured

Each row is a real file created in the probe repo, read back, updated with
its sha, and then written again with a stale sha.

| file bytes | % of 1 MiB | PUT create | GET raw | ETag = blob sha | GET json (`getSha`) | PUT + sha | PUT stale sha |
|---|---|---|---|---|---|---|---|
| 1,000,000 | 95.4% | 201 | 200, complete | yes, CORS-exposed | 200, `content` present | 200 | 409 |
| 1,100,001 | 104.9% | 201 | 200, complete | yes, CORS-exposed | 200, **`content` blank** | 200 | 409 |
| 2,000,000 | 190.7% | 201 | 200, complete | yes, CORS-exposed | 200, `content` blank | 200 | 409 |
| 10,000,000 | 953.7% | 201 | 200, complete | yes, CORS-exposed | 200, `content` blank | 200 | 409 |
| 24,999,999 | 2384.2% | 201 | 200, complete | yes, CORS-exposed | 200, `content` blank | 200 | 409 |
| 30,000,053 | 2861.0% | 201 | — | — | — | — | — |
| 40,000,031 | 3814.7% | 201 | — | — | — | — | — |
| 46,000,028 | 4386.6% | **422** | — | — | — | — | — |
| 50,000,001 | 4768.4% | **422** | — | — | — | — | — |

**The write ceiling is between 40 MB and 46 MB.** The refusal reads:

> "Sorry, the file is too large to be processed. Consider creating/updating
> the file in a local clone and pushing it to GitHub."

The last three rows were driven through the shipped `GitHubClient.putFile`
against the live API rather than through a hand-rolled request, so the
message match in §4 is verified against what GitHub actually sends, not
against a transcription of it. At 46 MB that call throws
`写入 e2e-46mb.json 失败:文件已超过 GitHub 接口的体积上限,…(HTTP 422)`;
before the change it returned `'conflict'`.

### The three conclusions

**Writing is not capped at 1 MiB.** The PUT that sends base64 through the
Contents API works to 40 MB — a 53 MB request body. At the measured 1,635
bytes per word that is roughly **24,000 words**, against a library of 619.
The write ceiling is real but sits two orders of magnitude away, and it is
undocumented, so the bracket above is the only evidence there is.

**The `getSha` fallback survives above 1 MiB, which was the actual
risk.** `getFile` reads with the raw media type and recovers the blob sha
from the ETag; when the ETag is not a 40-hex sha it falls back to a JSON
request purely for the sha. The fear was that the JSON media type would
*error* above 1 MiB and take that fallback down with it. It does not: it
returns **200 with the correct `sha`** and simply blanks `content`. So both
the primary path and its backstop keep working, and login on a new device —
the failure the getFile comment warns about — is safe.

**Optimistic concurrency is unaffected.** A stale sha still returns 409 at
every size, and the PUT response still carries `content.sha`.

## 3. The defect this turned up

`putFile` maps **both** 409 and 422 to `'conflict'`
(`src/lib/github.ts:96`). Measured, those two codes are not the same thing,
and 422 is not one thing either:

| response | meaning | correct handling |
|---|---|---|
| 409 `"<path> does not match <sha>"` | someone else pushed first | conflict |
| 422 `Invalid request. "sha" wasn't supplied.` | we thought the file was new, it exists | conflict |
| 422 `Sorry, the file is too large to be processed.` | **the write can never succeed** | not a conflict |

The first two are why the 422 mapping exists and it is right for them. The
third is misread, and the consequence is not just a wrong label:

`pushWords` (`src/state/sync.ts:322-334`) reacts to `'conflict'` by
re-pulling the whole remote file, replaying the pending ops onto it, and
pushing again. On a too-large file that second push fails identically, so
the user pays **a full download and a second doomed upload** and is then
told:

> 云端刚被其他设备改写,已重试一次仍冲突;本次改动留在本地,稍后会自动重试。

Every clause of that is false. Nothing overwrote anything, the retry was
not a conflict, and the promised automatic retry can never succeed. This is
the same family as the failure the `getFile` comment already names — a size
problem wearing another problem's error message — and it is the one thing
here worth fixing in code.

## 4. What is being changed

**`putFile` distinguishes the two 422s by the response's `message`.** A 422
whose message says the file is too large throws, carrying a sentence that
says so; every other 409/422 keeps returning `'conflict'` exactly as today.
Throwing is the right shape because the sync layer's catch already returns
`{ ok: false, error }` without retrying — so the second doomed upload
disappears along with the wrong message.

If the body cannot be parsed, the call falls back to `'conflict'`, i.e. to
today's behaviour. A garbled 422 is not evidence of a size problem.

### Not doing

**No sharding, and no migration to the Git Data API.** Both were on the
table before the measurement and both are answers to a problem that does
not exist: the write path clears the current file by a factor of 40, and
sharding would trade a non-problem for a real one — `words.json` is
rewritten as one unit under a single sha, and splitting it means N shas, N
conflict windows, and a merge that can half-apply. Revisit only if the
library approaches five figures.

**No proactive size guard in the app.** A warning threshold would need a
number, the only number available is undocumented and measured once, and
the file would trip it after roughly 23,000 more words. The guard would be
noise for a decade and stale by the time it fired.

## 5. Where the numbers live, and how they go stale

Three places carry a size measurement and they must move together when the
library grows:

- `CLAUDE.md`, the "Data lives in three synced files" gotcha
- the comment on `getFile`, `src/lib/github.ts:50`
- `docs/word-add-checklist.md` §6, which is what a session adding words
  actually reads — the reason the number is there is so the question does
  not get re-opened from scratch by the next batch

All three were rewritten on 2026-08-22 with the figures above. The
percentage of 1 MiB is now **the least interesting number in any of them** —
it governs
only whether the JSON media type returns `content`, which this app stopped
reading. The number that would actually matter is the distance to the write
ceiling, and that is the 40 MB in this document.

## Addendum (2026-09-01): the nearer ceiling this document did not consider

The 40 MB write limit above was not the nearest ceiling. The words cache
also lived in localStorage, whose quota is 5 MiB on WebKit and Firefox
(10 MiB on Chromium), counted in UTF-16 code units; measured 2026-09-01 the
words + progress caches compact-serialised to 977,624 code units, 840,626 of
them words, growing ~1,400 per word — about 1,900 words on an iPhone against
717 in the library, roughly six months out at the recent pace. And the
failure mode was silent loss: `storage.set` threw inside the click handler
before setState. `docs/superpowers/specs/2026-09-01-architecture-hardening-design.md`
§1 records the measurement and the decisions: `storage.set` returns false
instead of throwing and the store reports a full device, and the words cache
moved to IndexedDB (`src/lib/wordsCache.ts`), leaving progress alone in
localStorage where at ~215 code units per entry the WebKit quota is reached
around 12,000 words. GitHub's write limit is then the next ceiling again, as
this document assumed all along.
