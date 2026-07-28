import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppProvider, useApp } from './store'
import type { AppContextValue } from './store'
import { FORBIDDEN, RATE_LIMITED, TOKEN_REVOKED, logoutDiscarded, ownerSwitched } from './errors'
import { pendingOps, pendingStaging } from './session'
import type { SyncClient } from './sync'
import { GitHubClient } from '../lib/github'
import { storage } from '../lib/storage'
import { todayStr } from '../lib/srs'
import { emptyProgress } from '../types'
import type { Progress, StagingItem, Word } from '../types'

/**
 * **Sync orchestration** tests for store.tsx.
 *
 * [On the "no component tests for the UI itself" convention]
 * The plan says "the UI itself doesn't get component tests" -- logic is
 * tested in pure-function files, the interface gets behavioral contracts +
 * manual acceptance testing. **That convention still holds for pages and
 * components**; this is a deliberately authorized exception scoped only to
 * store.tsx. Reason: the 100-odd lines in this file aren't "wiring state up
 * to the interface" -- they're genuine data-safety logic: the mutex and
 * catch-up flag for each of the three push paths, session-invalidation
 * checks, reconciling a response against "local state right now", and
 * status settling. sync.ts / session.ts / errors.ts are watched by 150+
 * tests; the layer that wires them together had none before this, and the
 * cost of wiring it wrong is the user's review history, which can't be
 * regenerated. Don't take this file as precedent for adding component tests
 * to pages or components.
 *
 * [Approach]
 * No @testing-library: react-dom/client renders the Provider into a
 * detached container, a probe child component pulls the context value out,
 * paired with React 19's built-in act().
 * The remote always goes through a **plain-object fake client** (same
 * approach as sync.test.ts) -- no module mocking, no network touched;
 * GitHubClient's four methods are rewired to the fake client in beforeEach
 * and restored as-is in afterEach.
 */

// React's act() needs this global flag, or it warns "not inside an act environment"
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// --- Test double: remote ------------------------------------------------------
// Same approach as sync.test.ts, plus the ability to "leave a put hanging
// mid-air" -- the mutex, catch-up flag, and mid-flight changes can only be
// tested if the request genuinely stays pending.

type PutResult = { sha: string } | 'conflict'
interface PutCall { path: string; content: string; message: string; sha?: string }

function fakeRemote() {
  const putCalls: PutCall[] = []
  const getCalls: string[] = []
  const files: Record<string, { content: string; sha: string } | undefined> = {}
  const getThrows: Record<string, Error | undefined> = {}
  /** Preset put results queued per path; once exhausted, returns an auto-generated new sha */
  const scripted: Record<string, (PutResult | Error)[] | undefined> = {}
  /** Puts on these paths hang mid-air, released one at a time by the test via settleNext */
  const hold = new Set<string>()
  const held: Array<{ call: PutCall; settle: (r: PutResult | Error) => void }> = []
  let n = 0

  const nextResult = (path: string): PutResult | Error => {
    const q = scripted[path]
    return q && q.length > 0 ? q.shift()! : { sha: `${path}#${++n}` }
  }

  const client: SyncClient = {
    async getFile(path) {
      getCalls.push(path)
      const boom = getThrows[path]
      if (boom) throw boom
      return files[path] ?? null
    },
    putFile(path, content, message, sha) {
      const call: PutCall = { path, content, message, sha }
      putCalls.push(call)
      if (!hold.has(path)) {
        const r = nextResult(path)
        return r instanceof Error ? Promise.reject(r) : Promise.resolve(r)
      }
      return new Promise<PutResult>((res, rej) => {
        held.push({ call, settle: r => { if (r instanceof Error) rej(r); else res(r) } })
      })
    },
  }

  return {
    client, putCalls, getCalls, files, getThrows, scripted, hold, held,
    putsTo: (path: string) => putCalls.filter(c => c.path === path),
    /** Releases the earliest pending put (optionally for a specific path); uses the preset/auto sha if no result is given */
    release(result?: PutResult | Error, path?: string) {
      const i = path ? held.findIndex(h => h.call.path === path) : 0
      const h = held[i]
      if (!h) throw new Error(`no pending put${path ? ` (${path})` : ''}`)
      held.splice(i, 1)
      h.settle(result ?? nextResult(h.call.path))
    },
  }
}

type Remote = ReturnType<typeof fakeRemote>

// --- Test double: Provider mount ----------------------------------------------

let ctx: AppContextValue | null = null

function Probe() {
  ctx = useApp()
  return null
}

let root: Root | null = null
let container: HTMLDivElement | null = null

/** Lets React commit, and lets already-settled Promise chains advance a few more steps */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
}

async function mount(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  const r = createRoot(container)
  root = r
  await act(async () => { r.render(<AppProvider><Probe /></AppProvider>) })
  await flush()
}

/** The current context value. Re-fetched every time -- state fields get a new object on every re-render. */
function app(): AppContextValue {
  if (!ctx) throw new Error('Provider not mounted yet')
  return ctx
}

/** Triggers an action and runs the resulting render/microtasks to completion. Void async actions inside the callback. */
async function step(fn: () => void): Promise<void> {
  await act(async () => { fn() })
  await flush()
}

/** Releases a pending put, and runs whatever it triggers to completion */
async function release(result?: PutResult | Error, path?: string): Promise<void> {
  await act(async () => { remote.release(result, path) })
  await flush()
}

// --- Fixtures ------------------------------------------------------------------

const word = (id: string): Word => ({
  id, headword: id, phonetic: `/${id}/`,
  meanings: [{ pos: 'n.', en: id, zh: id }],
  examples: [], synonyms: [], antonyms: [], collocations: [], relatedForms: [],
  sourceNote: 'manual', addedAt: '2026-07-25',
})

const item = (headword: string, addedAt = '2026-07-25'): StagingItem => ({ headword, addedAt })
const wordsFile = (ids: string[]) => JSON.stringify({ version: 1, words: ids.map(word) })
const stagingFile = (items: StagingItem[]) => JSON.stringify({ version: 1, items })
const ids = (ws: Word[]) => ws.map(w => w.id)
const heads = (xs: StagingItem[]) => xs.map(x => x.headword)
const today = todayStr(new Date())

let remote: Remote
let identity: () => Promise<string>
let validate: () => Promise<void>

const original = {
  whoAmI: GitHubClient.whoAmI,
  validate: GitHubClient.prototype.validate,
  getFile: GitHubClient.prototype.getFile,
  putFile: GitHubClient.prototype.putFile,
}

beforeEach(() => {
  localStorage.clear()
  ctx = null
  remote = fakeRemote()
  identity = async () => 'alice'
  validate = async () => {}
  GitHubClient.whoAmI = () => identity()
  GitHubClient.prototype.validate = () => validate()
  GitHubClient.prototype.getFile = path => remote.client.getFile(path)
  GitHubClient.prototype.putFile = (path, content, message, sha) =>
    remote.client.putFile(path, content, message, sha)
})

afterEach(async () => {
  if (root) await act(async () => { root?.unmount() })
  container?.remove()
  root = null
  container = null
  GitHubClient.whoAmI = original.whoAmI
  GitHubClient.prototype.validate = original.validate
  GitHubClient.prototype.getFile = original.getFile
  GitHubClient.prototype.putFile = original.putFile
})

/** A normal boot where all three remote files exist and the device has a token */
async function bootAsAlice(opts: {
  words?: string[]
  progress?: Progress
  staging?: StagingItem[]
} = {}): Promise<void> {
  storage.set('token', 'tok-alice')
  storage.set('owner', 'alice')
  remote.files['words.json'] = { content: wordsFile(opts.words ?? ['alpha', 'beta']), sha: 'w-remote' }
  remote.files['progress.json'] = {
    content: JSON.stringify(opts.progress ?? emptyProgress()), sha: 'p-remote',
  }
  if (opts.staging) remote.files['staging.json'] = { content: stagingFile(opts.staging), sha: 's-remote' }
  await mount()
}

// === 0. First, prove this fixture setup actually works =======================

describe('the fixture setup itself', () => {
  it('act() really does flush effects -- after mounting, boot has run to completion and landed on ready', async () => {
    await bootAsAlice()
    // boot lives inside useEffect and still has three awaits to go; these two assertions together prove the effect ran and the async chain caught up
    expect(app().phase).toBe('ready')
    expect(ids(app().words)).toEqual(['alpha', 'beta'])
    expect(storage.get('wordsSha')).toBe('w-remote')

    // re-renders triggered by an action are visible too
    await step(() => { app().updateSettings({ newPerDay: 42 }) })
    expect(app().progress.settings.newPerDay).toBe(42)
  })
})

// === 1. Mutex + catch-up flag =================================================
// A second push that runs into the first one still in flight must set the
// catch-up flag and let the loop pick it up, rather than concurrently
// writing the same file. Verified one path at a time; progress / words
// haven't been tested since Phase 3.

describe('flushProgress: mutex and catch-up flag', () => {
  it('a second push while one is in flight doesn\'t run concurrently, but waits for the first to land and then catches up', async () => {
    await bootAsAlice()
    await step(() => { app().grade('alpha', 'good') })     // marks dirty (30s debounce, won't fly on its own)
    remote.hold.add('progress.json')

    await step(() => { void app().syncNow() })
    expect(remote.putsTo('progress.json')).toHaveLength(1)  // the first one is in flight

    // finished a quiz while mid-flight: marks dirty + requests an immediate push -- this can only set the catch-up flag
    await step(() => { app().recordQuiz(1, 1, []) })
    expect(remote.putsTo('progress.json')).toHaveLength(1)  // mutex: no second concurrent request

    await release({ sha: 'p-1' })
    const puts = remote.putsTo('progress.json')
    expect(puts).toHaveLength(2)                            // the catch-up flag was picked up by the loop
    expect(puts[1].sha).toBe('p-1')                         // uses the sha the previous call returned: genuinely serialized

    const sent = JSON.parse(puts[1].content) as Progress
    expect(sent.dailyStats[today].quizTaken).toBe(1)        // the catch-up run carried the mid-flight change along

    await release({ sha: 'p-2' })
    expect(remote.putsTo('progress.json')).toHaveLength(2)  // the catch-up flag is cleared, no infinite loop
    expect(storage.get('progressSha')).toBe('p-2')
    expect(app().syncStatus).toBe('synced')
  })

  it('settles immediately without sending a request if already clean', async () => {
    await bootAsAlice()
    await step(() => { void app().syncNow() })
    expect(remote.putsTo('progress.json')).toHaveLength(0)
    expect(app().syncStatus).toBe('synced')
  })
})

describe('flushWords: mutex and catch-up flag', () => {
  it('editing another word while mid-flight: queues for the next round, doesn\'t concurrently write words.json', async () => {
    await bootAsAlice()
    remote.hold.add('words.json')

    await step(() => { void app().saveWord(word('gamma')) })
    expect(remote.putsTo('words.json')).toHaveLength(1)
    expect(pendingOps()).toHaveLength(1)

    await step(() => { void app().saveWord(word('delta')) })
    expect(remote.putsTo('words.json')).toHaveLength(1)     // mutex
    expect(pendingOps()).toHaveLength(2)                    // but the change made it into the queue, wasn't lost

    await release({ sha: 'w-1' })
    const puts = remote.putsTo('words.json')
    expect(puts).toHaveLength(2)                            // catch-up run
    expect(puts[1].sha).toBe('w-1')                         // serialized: the second call carries the sha the first one returned
    expect(pendingOps()).toHaveLength(1)                    // only the entry actually sent this round gets confirmed
    expect(ids(JSON.parse(puts[1].content).words as Word[])).toContain('delta')

    await release({ sha: 'w-2' })
    expect(remote.putsTo('words.json')).toHaveLength(2)
    expect(pendingOps()).toEqual([])
    expect(storage.get('wordsSha')).toBe('w-2')
  })
})

describe('flushStaging: mutex and catch-up flag', () => {
  it('staging another word while mid-flight: queues for the next round, doesn\'t concurrently write staging.json', async () => {
    await bootAsAlice()
    remote.hold.add('staging.json')

    await step(() => { void app().addStaging('ostensible') })
    expect(remote.putsTo('staging.json')).toHaveLength(1)
    expect(pendingStaging()).toHaveLength(1)

    await step(() => { void app().addStaging('perfunctory') })
    expect(remote.putsTo('staging.json')).toHaveLength(1)   // mutex
    expect(pendingStaging()).toHaveLength(2)

    await release({ sha: 's-1' })
    const puts = remote.putsTo('staging.json')
    expect(puts).toHaveLength(2)
    expect(puts[1].sha).toBe('s-1')
    expect(pendingStaging()).toHaveLength(1)
    const sent = JSON.parse(puts[1].content) as { items: StagingItem[] }
    expect(heads(sent.items).sort()).toEqual(['ostensible', 'perfunctory'])

    await release({ sha: 's-2' })
    expect(remote.putsTo('staging.json')).toHaveLength(2)
    expect(pendingStaging()).toEqual([])
    expect(storage.get('stagingSha')).toBe('s-2')
  })
})

// === 2. Session invalidation ===================================================
// A response that only comes back after logout/account switch must be
// invalidated in full: it must not write bookkeeping into the already
// cleared localStorage, nor stuff the previous account's data into the
// current UI.

describe('session invalidation', () => {
  it('a progress push that only lands after logout: doesn\'t write bookkeeping back, and doesn\'t carry old data back into the UI', async () => {
    await bootAsAlice()
    await step(() => { app().grade('alpha', 'good') })
    remote.hold.add('progress.json')
    await step(() => { void app().syncNow() })
    expect(remote.putsTo('progress.json')).toHaveLength(1)

    await step(() => { app().logout() })
    expect(app().phase).toBe('login')

    await release({ sha: 'p-late' })
    expect(storage.get('progressSha')).toBeNull()          // cleared storage must never be refilled
    expect(storage.get('dirty')).toBeNull()
    expect(storage.get('progress')).toBeNull()
    expect(app().progress).toEqual(emptyProgress())        // the previous account's progress must never surface in the UI
    expect(app().phase).toBe('login')
    expect(remote.putsTo('progress.json')).toHaveLength(1)  // and it doesn't trigger a catch-up run either
  })

  it('logging out while a push is in flight: must disclose that progress was discarded -- dirty being cleared early doesn\'t mean it actually synced', async () => {
    // pushProgress clears dirty "before" the request goes out (that's the
    // mechanism preventing a grade made mid-flight from being swallowed,
    // and it's correct). So for this whole round trip, storage's dirty is
    // false -- but progress hasn't actually landed. If logout only looked
    // at dirty, it would conclude "nothing to discard" and silently wipe
    // the device, and this review would exist neither locally nor
    // remotely.
    // wordOps / stagingOps are only cleared "after confirmed success", so
    // they count correctly; dirty is cleared "before sending", so it counts
    // wrong -- this asymmetry is the defect itself.
    await bootAsAlice()
    await step(() => { app().grade('alpha', 'good') })
    remote.hold.add('progress.json')
    await step(() => { void app().syncNow() })
    expect(storage.get('dirty')).toBe(false)               // it really has been cleared early
    expect(remote.putsTo('progress.json')).toHaveLength(1)  // but the request is still in flight

    await step(() => { app().logout() })
    expect(app().syncError).not.toBeNull()
    expect(app().syncError).toContain('未同步')

    // and this push ultimately failed -- the data is genuinely gone, not a false alarm
    await release(new Error('HTTP 500'))
    expect(storage.get('progress')).toBeNull()
  })

  it('a words push that only lands after logout: neither the queue nor the vocabulary may be written back', async () => {
    await bootAsAlice()
    remote.hold.add('words.json')
    await step(() => { void app().saveWord(word('gamma')) })

    await step(() => { app().logout() })
    await release({ sha: 'w-late' })

    expect(storage.get('wordsSha')).toBeNull()
    expect(storage.get('words')).toBeNull()
    expect(app().words).toEqual([])
  })

  it('a staging push that only lands after logout: invalidated in full the same way', async () => {
    await bootAsAlice()
    remote.hold.add('staging.json')
    await step(() => { void app().addStaging('ostensible') })

    await step(() => { app().logout() })
    await release({ sha: 's-late' })

    expect(storage.get('stagingSha')).toBeNull()
    expect(storage.get('staging')).toBeNull()
    expect(app().staging).toEqual([])
  })

  it('an old push that only lands after logging into a different account: doesn\'t overwrite the sha and progress the new account just wrote', async () => {
    await bootAsAlice({ words: ['alpha'] })
    await step(() => { app().grade('alpha', 'good') })
    remote.hold.add('progress.json')
    await step(() => { void app().syncNow() })
    expect(remote.putsTo('progress.json')).toHaveLength(1)

    // meanwhile switches to logging in as bob (bob's repo has a different set of files)
    identity = async () => 'bob'
    remote.files['words.json'] = { content: wordsFile(['zeta']), sha: 'w-bob' }
    remote.files['progress.json'] = { content: JSON.stringify(emptyProgress()), sha: 'p-bob' }
    await act(async () => { await app().login('tok-bob') })
    await flush()

    expect(app().owner).toBe('bob')
    expect(storage.get('progressSha')).toBe('p-bob')
    // Note: this deliberately does **not** assert that syncError reports
    // "alice's debt was discarded". dirty was already cleared to false
    // before the push took off, so carryOverFor can't see that debt at this
    // point -- this is a known product gap, out of scope for this change
    // (see the delivery report), so nothing is pinned down either way here.

    await release({ sha: 'p-alice-late' })
    expect(storage.get('progressSha')).toBe('p-bob')        // the late response is discarded
    expect(app().progress.words['alpha']).toBeUndefined()   // alice's review record didn't leak into bob's view
    expect(ids(app().words)).toEqual(['zeta'])
  })
})

// === 3. Changes made mid-flight must never be swallowed =======================
// This is the App's worst failure mode: the snapshot taken when a push went
// out gets overwritten straight back onto local state when it returns,
// erasing whatever the user did while the request was in flight. The
// reconciliation step is the only line of defense.

describe('reconciling once a push returns', () => {
  it('graded another word while progress was in flight: that grade must survive', async () => {
    await bootAsAlice()
    await step(() => { app().grade('alpha', 'good') })
    remote.hold.add('progress.json')
    await step(() => { void app().syncNow() })

    await step(() => { app().grade('beta', 'good') })       // the request is still in flight
    await release({ sha: 'p-1' })

    expect(app().progress.words['beta']).toBeDefined()      // the mid-flight grade wasn't overwritten by the stale snapshot
    expect(app().progress.words['alpha']).toBeDefined()
    expect(app().progress.dailyStats[today].reviewed).toBe(2)
    const saved = storage.get<Progress>('progress')
    expect(saved?.words['beta']).toBeDefined()              // what's persisted is also the reconciled version
    expect(app().syncStatus).toBe('pending')                // it still owes the remote one more push
  })

  it('edited another word while words was in flight: that entry must survive', async () => {
    await bootAsAlice()
    remote.hold.add('words.json')
    await step(() => { void app().saveWord(word('gamma')) })
    await step(() => { void app().saveWord(word('delta')) })  // the request is still in flight

    await release({ sha: 'w-1' })
    expect(ids(app().words)).toEqual(['alpha', 'beta', 'gamma', 'delta'])
    expect(ids(storage.get<Word[]>('words') ?? [])).toContain('delta')
    // the catch-up round's outgoing payload must carry it too, or the next boot would overwrite it with the remote and lose it
    expect(ids(JSON.parse(remote.putsTo('words.json')[1].content).words as Word[])).toContain('delta')
  })

  it('staged another word while staging was in flight: that entry must survive', async () => {
    await bootAsAlice()
    remote.hold.add('staging.json')
    await step(() => { void app().addStaging('ostensible') })
    await step(() => { void app().addStaging('perfunctory') })  // the request is still in flight

    await release({ sha: 's-1' })
    expect(heads(app().staging).sort()).toEqual(['ostensible', 'perfunctory'])
    expect(heads(storage.get<StagingItem[]>('staging') ?? [])).toContain('perfunctory')
  })

  it('words push hits a conflict: both the other device\'s word and the mid-flight edit must be kept', async () => {
    await bootAsAlice({ words: ['alpha'] })
    remote.hold.add('words.json')
    await step(() => { void app().saveWord(word('gamma')) })

    // while in flight this device adds another one, and meanwhile omega gets added elsewhere on the remote
    await step(() => { void app().saveWord(word('delta')) })
    remote.files['words.json'] = { content: wordsFile(['alpha', 'omega']), sha: 'w-other' }

    await release('conflict')                               // the first put conflicts, re-pulls the remote and pushes again
    await release({ sha: 'w-merged' })                      // the conflict retry lands

    expect(ids(app().words).sort()).toEqual(['alpha', 'delta', 'gamma', 'omega'])
  })
})

// === 4. Booting with three files ===============================================

describe('boot: three files', () => {
  it('reads all three files, and everything read lands in state', async () => {
    await bootAsAlice({ staging: [item('ostensible')] })
    expect(remote.getCalls.sort()).toEqual(['progress.json', 'staging.json', 'words.json'])
    expect(app().phase).toBe('ready')
    expect(heads(app().staging)).toEqual(['ostensible'])
    expect(storage.get('stagingSha')).toBe('s-remote')
  })

  it('remote doesn\'t have staging.json yet: reaches ready as usual, doesn\'t use the local copy to create it', async () => {
    await bootAsAlice()                                     // no staging.json set up
    expect(app().phase).toBe('ready')
    expect(ids(app().words)).toEqual(['alpha', 'beta'])
    expect(app().staging).toEqual([])
    expect(storage.get('stagingSha')).toBeNull()
    expect(remote.putCalls).toEqual([])
  })

  it('staging.json is corrupted: treated as absent, must never drag down words / progress', async () => {
    storage.set('token', 'tok-alice')
    storage.set('owner', 'alice')
    remote.files['words.json'] = { content: wordsFile(['alpha']), sha: 'w-remote' }
    remote.files['progress.json'] = { content: JSON.stringify(emptyProgress()), sha: 'p-remote' }
    remote.files['staging.json'] = { content: '{"version":1,"items":[{"nope":1}]}', sha: 's-bad' }
    await mount()

    expect(app().phase).toBe('ready')
    expect(ids(app().words)).toEqual(['alpha'])
    expect(storage.get('progressSha')).toBe('p-remote')
    expect(app().staging).toEqual([])
    expect(storage.get('stagingSha')).toBeNull()            // a corrupted file's sha must never be kept
    expect(app().syncStatus).toBe('synced')
  })

  it('the staging.json read itself throws: must not drag the boot path into the catch either', async () => {
    storage.set('token', 'tok-alice')
    storage.set('owner', 'alice')
    remote.files['words.json'] = { content: wordsFile(['alpha']), sha: 'w-remote' }
    remote.files['progress.json'] = { content: JSON.stringify(emptyProgress()), sha: 'p-remote' }
    remote.getThrows['staging.json'] = new Error('读取 staging.json 失败 (HTTP 500)')
    await mount()

    expect(app().phase).toBe('ready')
    expect(app().syncError).toBeNull()
    expect(ids(app().words)).toEqual(['alpha'])
  })

  it('words.json is corrupted, device has no cache: falls back to the login page and explains why, but doesn\'t clear the token or push anything', async () => {
    storage.set('token', 'tok-alice')
    storage.set('owner', 'alice')
    remote.files['words.json'] = { content: '{"version":1,"words":[{"id":"x"}]}', sha: 'w-bad' }
    remote.files['progress.json'] = { content: JSON.stringify(emptyProgress()), sha: 'p-remote' }
    await mount()

    expect(app().phase).toBe('login')
    expect(app().loginError).toContain('备份')
    expect(storage.get('token')).toBe('tok-alice')          // a corrupted remote file shouldn't destroy a valid credential
    expect(remote.putCalls).toEqual([])                     // and definitely shouldn't overwrite the remote with the local copy
  })

  it('words.json is corrupted, device has a cache: stays on ready using the cache, only flags the sync failure, still doesn\'t overwrite the remote', async () => {
    storage.set('token', 'tok-alice')
    storage.set('owner', 'alice')
    storage.set('words', [word('cached')])
    storage.set('progress', emptyProgress())
    remote.files['words.json'] = { content: '{"version":1,"words":[{"id":"x"}]}', sha: 'w-bad' }
    remote.files['progress.json'] = { content: JSON.stringify(emptyProgress()), sha: 'p-remote' }
    await mount()

    expect(app().phase).toBe('ready')
    expect(ids(app().words)).toEqual(['cached'])
    expect(app().syncStatus).toBe('error')
    expect(app().syncError).toContain('备份')
    expect(remote.putCalls).toEqual([])
  })

  it('progress.json is corrupted: refuses to overwrite the remote, both token and local data are kept', async () => {
    storage.set('token', 'tok-alice')
    storage.set('owner', 'alice')
    remote.files['words.json'] = { content: wordsFile(['alpha']), sha: 'w-remote' }
    remote.files['progress.json'] = { content: '{"version":1,"words":', sha: 'p-bad' }
    await mount()

    expect(remote.putCalls).toEqual([])
    expect(storage.get('token')).toBe('tok-alice')
    expect(storage.get('progressSha')).toBeNull()
    expect(app().loginError).toContain('备份')
  })
})

// === 5. settleStatus must never lie ============================================

describe('settleStatus', () => {
  it('after a staged-word push fails, a successful progress push must not dress the status up as "synced"', async () => {
    await bootAsAlice()
    remote.scripted['staging.json'] = [new Error('写入 staging.json 失败 (HTTP 500)')]

    await step(() => { void app().addStaging('ostensible') })
    expect(app().syncStatus).toBe('error')
    expect(pendingStaging()).toHaveLength(1)                // the queue stays put, awaiting the next retry

    // afterward the progress push succeeds -- it clears the previous failure notice
    await step(() => { app().recordQuiz(1, 1, []) })
    expect(remote.putsTo('progress.json')).toHaveLength(1)
    expect(app().syncError).toBeNull()

    expect(pendingStaging()).toHaveLength(1)                // still owes the remote one file
    expect(app().syncStatus).toBe('pending')                // so it can't be synced
  })

  it('the same holds when the vocabulary queue is non-empty', async () => {
    await bootAsAlice()
    remote.scripted['words.json'] = [new Error('写入 words.json 失败 (HTTP 500)')]
    await step(() => { void app().saveWord(word('gamma')) })
    expect(pendingOps()).toHaveLength(1)

    await step(() => { app().recordQuiz(1, 1, []) })
    expect(app().syncStatus).toBe('pending')
  })
})

// === 6. 401 vs 403 ==============================================================

describe('handling push failures: 401 logs out, 403 does not', () => {
  it('401: falls back to the login page and clears the token, but owner and unpushed changes stay put awaiting re-login', async () => {
    await bootAsAlice()
    remote.scripted['words.json'] = [new Error('写入 words.json 失败 (HTTP 401)')]

    await step(() => { void app().saveWord(word('gamma')) })

    expect(app().phase).toBe('login')
    expect(app().loginError).toBe(TOKEN_REVOKED)
    expect(app().owner).toBeNull()
    expect(app().syncError).toBeNull()                      // the login page only says one thing
    expect(storage.get('token')).toBeNull()
    expect(storage.get('owner')).toBe('alice')              // this is how it recognizes it's the same person
    expect(pendingOps()).toHaveLength(1)                    // that edit wasn't lost
  })

  it('after a 401 there\'s no client anymore: further edits only go into the queue, the queue is never cleared', async () => {
    await bootAsAlice()
    remote.scripted['words.json'] = [new Error('写入 words.json 失败 (HTTP 401)')]
    await step(() => { void app().saveWord(word('gamma')) })
    expect(pendingOps()).toHaveLength(1)

    await step(() => { void app().saveWord(word('delta')) })
    expect(pendingOps()).toHaveLength(2)                    // queued, awaiting replay after re-login
    expect(remote.putsTo('words.json')).toHaveLength(1)     // never hits the remote again
  })

  it('403 rate-limited: doesn\'t log out or clear the token, gives an actionable notice', async () => {
    await bootAsAlice()
    remote.scripted['progress.json'] = [new Error('写入 progress.json 失败 (HTTP 403, rate-limited)')]

    await step(() => { app().grade('alpha', 'good') })
    await step(() => { void app().syncNow() })

    expect(app().phase).toBe('ready')
    expect(storage.get('token')).toBe('tok-alice')          // rate limiting must never destroy a valid credential
    expect(app().syncStatus).toBe('error')
    expect(app().syncError).toBe(RATE_LIMITED)
    expect(app().loginError).toBeNull()
    expect(storage.get('dirty')).toBe(true)                 // the change stays local awaiting retry
  })

  it('403 insufficient permissions: also doesn\'t log out, the notice becomes "go re-authorize"', async () => {
    await bootAsAlice()
    remote.scripted['progress.json'] = [new Error('写入 progress.json 失败 (HTTP 403)')]

    await step(() => { app().grade('alpha', 'good') })
    await step(() => { void app().syncNow() })

    expect(app().phase).toBe('ready')
    expect(storage.get('token')).toBe('tok-alice')
    expect(app().syncError).toBe(FORBIDDEN)
  })
})

// === 7. Discard notice on logout ================================================

describe('logout', () => {
  it('with unsynced data: reports what got discarded item by item, through syncError rather than loginError', async () => {
    await bootAsAlice()
    remote.hold.add('words.json')
    remote.hold.add('staging.json')
    await step(() => { void app().saveWord(word('gamma')) })
    await step(() => { void app().saveWord(word('delta')) })
    await step(() => { void app().addStaging('ostensible') })
    await step(() => { void app().addStaging('perfunctory') })
    await step(() => { app().grade('alpha', 'good') })
    expect(pendingOps()).toHaveLength(2)
    expect(pendingStaging()).toHaveLength(2)
    expect(storage.get('dirty')).toBe(true)

    await step(() => { app().logout() })

    expect(app().syncError).toBe(logoutDiscarded(2, true, 2))
    expect(app().syncError).toContain('未同步的学习进度')
    expect(app().syncError).toContain('2 条未同步的词库改动')
    expect(app().syncError).toContain('2 个待补全的生词')
    expect(app().loginError).toBeNull()                     // the token input has nothing wrong with it right now
    expect(app().phase).toBe('login')
    expect(storage.get('token')).toBeNull()
    expect(storage.get('owner')).toBeNull()
    expect(pendingOps()).toEqual([])
  })

  it('no debt: logs out quietly, doesn\'t fabricate a notice', async () => {
    await bootAsAlice()
    await step(() => { app().logout() })
    expect(app().syncError).toBeNull()
    expect(app().loginError).toBeNull()
    expect(app().syncStatus).toBe('synced')
  })
})

// === 8. Replaying debt at login =================================================
// A revoked token leaves the device stuck with "unpushed changes". The
// orchestration at the moment of re-login: same account replays all three
// queues in turn; a different account discards everything, and none of it
// may ever be pushed into the new account's repo.

describe('login: handling this device\'s debt', () => {
  function seedUnsyncedAliceWork() {
    const p = emptyProgress()
    p.words['alpha'] = {
      state: 'review', ease: 2.5, intervalDays: 3, due: '2026-07-30',
      stepIndex: 0, reps: 4, lapses: 0, lastReviewedAt: '2026-07-25T01:00:00Z',
    }
    storage.set('owner', 'alice')                 // token has been revoked, owner stays
    storage.set('words', [word('alpha')])
    storage.set('progress', p)
    storage.set('dirty', true)
    storage.set('wordOps', [{ kind: 'upsert', word: word('gamma') }])
    storage.set('stagingOps', [item('ostensible')])
    storage.set('staging', [item('ostensible')])
    remote.files['words.json'] = { content: wordsFile(['alpha']), sha: 'w-remote' }
    remote.files['progress.json'] = { content: JSON.stringify(emptyProgress()), sha: 'p-remote' }
    remote.files['staging.json'] = { content: stagingFile([]), sha: 's-remote' }
  }

  it('re-login with the same account: vocabulary, staging, and progress get pushed in turn, queues cleared', async () => {
    seedUnsyncedAliceWork()
    await mount()
    expect(app().phase).toBe('login')

    await act(async () => { await app().login('tok-alice') })
    await flush()

    expect(remote.putCalls.map(c => c.path)).toEqual(['words.json', 'staging.json', 'progress.json'])
    expect(app().owner).toBe('alice')
    expect(app().syncError).toBeNull()
    expect(ids(app().words)).toEqual(['alpha', 'gamma'])
    expect(heads(app().staging)).toEqual(['ostensible'])
    expect(app().progress.words['alpha'].reps).toBe(4)      // the review record from before the revocation is merged back in
    expect(pendingOps()).toEqual([])
    expect(pendingStaging()).toEqual([])
    expect(storage.get('dirty')).toBe(false)
    expect(app().syncStatus).toBe('synced')
  })

  it('logging into a different account: all debt is discarded, reports who lost it, and none of it gets pushed into the new account\'s repo', async () => {
    seedUnsyncedAliceWork()
    await mount()

    identity = async () => 'bob'
    remote.files['words.json'] = { content: wordsFile(['zeta']), sha: 'w-bob' }
    await act(async () => { await app().login('tok-bob') })
    await flush()

    expect(remote.putCalls).toEqual([])                     // alice's changes never got written into bob's repo
    expect(app().owner).toBe('bob')
    expect(app().syncError).toBe(ownerSwitched('alice'))
    expect(ids(app().words)).toEqual(['zeta'])
    expect(app().progress.words['alpha']).toBeUndefined()
    expect(pendingOps()).toEqual([])
    expect(pendingStaging()).toEqual([])
    expect(storage.get('dirty')).toBe(false)
  })

  it('first login, remote doesn\'t have progress.json yet: creates an empty one, doesn\'t touch staging.json', async () => {
    remote.files['words.json'] = { content: wordsFile(['alpha']), sha: 'w-remote' }
    await mount()
    await act(async () => { await app().login('tok-alice') })
    await flush()

    expect(remote.putCalls).toHaveLength(1)
    expect(remote.putCalls[0].path).toBe('progress.json')
    expect(remote.putCalls[0].message).toBe('init progress')
    expect(remote.putCalls[0].sha).toBeUndefined()
    expect(storage.get('progressSha')).toBe('progress.json#1')
    expect(app().phase).toBe('ready')
    expect(app().syncStatus).toBe('synced')
  })
})

// === Sprint settlement ==========================================================
// recordSprint shares the "missed words only get their due date pulled
// forward, ease/interval untouched" contract with recordQuiz; the only
// extra thing is the best score. The condition for refreshing the record
// must match merge.ts's "equal score keeps the earlier date" -- if the two
// disagree, a sync round trip will keep rewriting the date back and forth.

describe('recordSprint: best score', () => {
  it('the first score is automatically the record, and pulls the missed word\'s due date to today without touching ease or interval', async () => {
    await bootAsAlice()
    // Grade it easy once first so it graduates to review with a due date a
    // few days out -- otherwise due would already be today, and the
    // "pulled forward" assertion wouldn't mean anything (it would pass
    // under any implementation).
    await step(() => { app().grade('alpha', 'easy') })
    const before = app().progress.words['alpha']
    expect(before.due > today).toBe(true)

    await step(() => { app().recordSprint(12, ['alpha']) })

    expect(app().progress.bestSprint).toEqual({ score: 12, date: today })
    expect(app().progress.dailyStats[today].quizTaken).toBe(1)
    const after = app().progress.words['alpha']
    expect(after.due).toBe(today)
    expect(after.ease).toBe(before.ease)               // grading logic never touches it
    expect(after.intervalDays).toBe(before.intervalDays)
    expect(after.lapses).toBe(before.lapses)
  })

  it('only a higher score refreshes the record', async () => {
    await bootAsAlice()
    await step(() => { app().recordSprint(12, []) })
    await step(() => { app().recordSprint(20, []) })
    expect(app().progress.bestSprint).toEqual({ score: 20, date: today })
  })

  it('a lower score leaves the record untouched', async () => {
    await bootAsAlice()
    await step(() => { app().recordSprint(20, []) })
    await step(() => { app().recordSprint(5, []) })
    expect(app().progress.bestSprint).toEqual({ score: 20, date: today })
  })

  it('a tie doesn\'t refresh -- otherwise the record date would get rewritten by a later tie, fighting merge\'s "equal score keeps the earlier one"', async () => {
    await bootAsAlice()
    await step(() => { app().recordSprint(20, []) })
    const first = app().progress.bestSprint
    await step(() => { app().recordSprint(20, []) })
    expect(app().progress.bestSprint).toBe(first)      // the same object, never rebuilt at all
  })

  it('settlement pushes immediately, doesn\'t wait for the 30-second debounce', async () => {
    await bootAsAlice()
    await step(() => { app().recordSprint(7, []) })
    const puts = remote.putsTo('progress.json')
    expect(puts.length).toBeGreaterThan(0)
    const sent = JSON.parse(puts[puts.length - 1].content) as Progress
    expect(sent.bestSprint).toEqual({ score: 7, date: today })
  })
})
