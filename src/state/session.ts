import { storage } from '../lib/storage'
import { emptyProgress } from '../types'
import type { Progress, StagingItem, Word } from '../types'
import { isProgress, isStagingItem, isWord, isWordsOp, mergeStaging } from './sync'
import type { WordsOp } from './sync'

/**
 * The local device session in localStorage: caches, the pending-push queue,
 * and the boot state derived from them.
 *
 * Like sync.ts, this doesn't depend on React -- "which phase to enter after
 * a refresh" and "what to do with local debt when logging in under a
 * different account" are the two things easiest to get wrong and hardest to
 * test inside a component, so they're pulled out as pure functions.
 */

export interface BootSnapshot {
  /** Never 'ready' since 2026-09-01: words are behind an async IndexedDB read, so boot() makes that call */
  phase: 'boot' | 'login'
  owner: string | null
  /** Always empty here; see the phase note. Kept in the shape so the snapshot still spreads straight into AppState. */
  words: Word[]
  progress: Progress
  /** New-word staging area. **Does not factor into the phase decision** -- see the note inside bootSnapshot */
  staging: StagingItem[]
}

/** Treat a cache with the wrong shape as absent, so one bad cache doesn't take down the whole App */
export function cachedProgress(): Progress | null {
  const p = storage.get<unknown>('progress')
  return isProgress(p) ? p : null
}

/**
 * The shape check for the words cache, which lives in IndexedDB
 * (src/lib/wordsCache.ts) and is read asynchronously by boot(). Same
 * predicate the localStorage read applied until 2026-09-01: a bad shape is
 * "no cache", never a throw, and non-empty is required -- an empty library
 * is not a state this app can be in.
 */
export function validWords(raw: unknown): Word[] | null {
  return Array.isArray(raw) && raw.length > 0 && raw.every(isWord) ? raw : null
}

/** Same idea; the staging area can legitimately be an empty array ("nothing staged yet"), so unlike validWords it doesn't require non-empty */
export function cachedStaging(): StagingItem[] | null {
  const s = storage.get<unknown>('staging')
  return Array.isArray(s) && s.every(isStagingItem) ? s : null
}

/**
 * Vocabulary add/deletes not yet confirmed pushed to the remote.
 *
 * A single dirty boolean is enough for progress (the whole thing gets
 * re-pushed), but not for vocabulary: on conflict, the specific actions have
 * to be **replayed** on the freshly re-pulled remote copy, so the actions
 * themselves must be retained. Keeping them only in memory would mean that
 * if a push fails and the page is closed, the next boot overwrites the local
 * cache with the remote and that change is simply gone.
 */
export function pendingOps(): WordsOp[] {
  const raw = storage.get<unknown>('wordOps')
  if (!Array.isArray(raw)) return []
  return raw.filter(isWordsOp)
}

export function setPendingOps(ops: WordsOp[]): void {
  if (ops.length === 0) storage.remove('wordOps')
  else storage.set('wordOps', ops)
}

export function appendPendingOp(op: WordsOp): WordsOp[] {
  const next = [...pendingOps(), op]
  setPendingOps(next)
  return next
}

/**
 * Staged words not yet pushed to the remote. Same mechanism, same rationale
 * as wordOps (a failed push followed by closing the page means the next boot
 * overwrites the local cache with the remote) -- except here the queue
 * elements are the items themselves. The staging area only ever has one
 * kind of action, "append", so a union merge is the replay; no separate
 * action description is needed.
 */
export function pendingStaging(): StagingItem[] {
  const raw = storage.get<unknown>('stagingOps')
  if (!Array.isArray(raw)) return []
  return raw.filter(isStagingItem)
}

export function setPendingStaging(items: StagingItem[]): void {
  if (items.length === 0) storage.remove('stagingOps')
  else storage.set('stagingOps', items)
}

/** Union append: pressing "add to staging" twice on the same word only queues one entry */
export function appendPendingStaging(it: StagingItem): StagingItem[] {
  const next = mergeStaging(pendingStaging(), [it])
  setPendingStaging(next)
  return next
}

/**
 * First-frame state. Until 2026-09-01 this reached 'ready' on its own when
 * both caches were valid; now the words cache is in IndexedDB and behind an
 * async read, so a device with a token renders the Booting gate until
 * boot() has read it (tens of milliseconds for 717 words) and goes ready
 * from cache there instead.
 *
 * Progress and staging are still read here, so state holds this device's
 * localStorage copies from the first frame. That is not decorative: boot()
 * merges the remote into stateRef.current.progress, and a device whose
 * words cache is missing (the first boot after the move, an evicted
 * IndexedDB) but whose progress carries unpushed grades would otherwise
 * merge the remote into an empty progress and lose them.
 */
export function bootSnapshot(isDev: boolean): BootSnapshot {
  // Staging doesn't factor into any decision here: a missing or corrupted
  // cache only means "the staging area is empty".
  const staging = cachedStaging() ?? []
  const idle: BootSnapshot = {
    phase: 'login', owner: null, words: [], progress: emptyProgress(), staging,
  }
  const token = storage.get<string>('token')
  const owner = storage.get<string>('owner')

  // Dev demo mode has no token, so refreshing returns to the demo automatically, saving a re-click every time the page is worked on
  if (isDev && !token && owner === 'demo') return { ...idle, phase: 'boot', owner }
  if (!token || !owner) return idle

  return { ...idle, phase: 'boot', owner, progress: cachedProgress() ?? emptyProgress() }
}

export interface CarryOver {
  /** Local progress that needs to be merged back into the remote; null means the device has no debt */
  progress: Progress | null
  /** Vocabulary changes that need replaying onto the remote copy */
  ops: WordsOp[]
  /** Staged words that need merging into the remote staging area */
  staging: StagingItem[]
  /** There was debt but it belongs to a different account and has been discarded -- must be disclosed to the user, never silent */
  discardedOwner: string | null
}

/**
 * On re-login, which of the things this device never finished pushing can be carried over.
 *
 * A revoked token leaves the device stuck with "unpushed changes"; if
 * re-login just overwrote them with the remote, that review history would
 * be swallowed. But merging across accounts is equally wrong -- that would
 * mix someone else's data in. So: carry over on the same account, discard on
 * an account switch + report who lost what.
 */
export function carryOverFor(owner: string): CarryOver {
  const previous = storage.get<string>('owner')
  const dirty = storage.get<boolean>('dirty') === true
  const ops = pendingOps()
  const staging = pendingStaging()
  const progress = dirty ? cachedProgress() : null

  if (previous === null || previous === owner) return { progress, ops, staging, discardedOwner: null }

  const hadWork = progress !== null || ops.length > 0 || staging.length > 0
  return { progress: null, ops: [], staging: [], discardedOwner: hadWork ? previous : null }
}
