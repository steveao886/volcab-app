import { mergeProgress } from '../lib/merge'
import { storage } from '../lib/storage'
import type { Progress, ProgressEntry, StagingFile, StagingItem, Word, WordsFile } from '../types'
import { BACKUP_HINT, errText, GIVE_UP } from './errors'

/**
 * Sync orchestration: for two files, "push once, and if there's a conflict, merge and push once more".
 *
 * Deliberately doesn't depend on React, nor on the concrete GitHubClient
 * class -- it only consumes the structural interface below, so the whole
 * conflict-retry path can be tested with a plain-object fake client (see
 * sync.test.ts).
 *
 * Division of responsibility: this module owns **remote bookkeeping**
 * (progressSha / wordsSha / dirty); store owns local state and the caching
 * of the words / progress payloads themselves.
 */

export const WORDS_PATH = 'words.json'
export const PROGRESS_PATH = 'progress.json'
/**
 * The new-word staging area. Kept as **its own separate file** instead of
 * being stuffed into the two above: putting it in words.json means
 * half-finished entries would fail schema validation and land straight in
 * the review queue; putting it in progress.json would drag it into the
 * per-word merge logic designed for review progress. A separate file means
 * an independent conflict domain (design doc §6.2).
 */
export const STAGING_PATH = 'staging.json'

export interface SyncClient {
  getFile(path: string): Promise<{ content: string; sha: string } | null>
  putFile(path: string, content: string, message: string, sha?: string): Promise<{ sha: string } | 'conflict'>
}

export interface PushOptions {
  /** Returning false means the session has already ended (logout/account switch); no bookkeeping key should be written after that */
  alive?: () => boolean
}

export type PushOutcome<T> =
  | { ok: true; sha: string; data: T }   // data is the content that actually landed (may already be merged with the remote)
  | { ok: false; error: string }

/** Changes made to the vocabulary during this session, replayed onto the freshly re-pulled remote copy on conflict */
export type WordsOp =
  | { kind: 'upsert'; word: Word }
  | { kind: 'delete'; ids: string[] }

// --- Shape validation -------------------------------------------------------
// A remote file is external input "written by some other process, possibly
// hand-edited". Checking only the top level isn't enough: a dailyStats
// missing a field, or a half-broken file with empty meanings, would pass a
// top-level check but blow up as undefined.map() at render time. §8 requires
// "reject overwriting the remote if it fails to parse or doesn't match the
// schema", so this validates all the way down to the leaves.

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(x => typeof x === 'string')

const isMeaning = (v: unknown) =>
  isRecord(v) && typeof v.pos === 'string' && typeof v.en === 'string' && typeof v.zh === 'string'

const isRelatedForm = (v: unknown) =>
  isRecord(v) && typeof v.form === 'string' && typeof v.pos === 'string' && typeof v.zh === 'string'

export function isWord(v: unknown): v is Word {
  return isRecord(v)
    && typeof v.id === 'string' && v.id.length > 0
    && typeof v.headword === 'string'
    && typeof v.phonetic === 'string'
    && typeof v.sourceNote === 'string'
    && typeof v.addedAt === 'string'
    && Array.isArray(v.meanings) && v.meanings.length > 0 && v.meanings.every(isMeaning)
    && isStrings(v.examples) && isStrings(v.synonyms) && isStrings(v.antonyms) && isStrings(v.collocations)
    && Array.isArray(v.relatedForms) && v.relatedForms.every(isRelatedForm)
}

const STATES: ReadonlySet<string> = new Set(['new', 'learning', 'review'])

const isProgressEntry = (v: unknown): v is ProgressEntry =>
  isRecord(v)
  && typeof v.state === 'string' && STATES.has(v.state)
  && typeof v.ease === 'number' && typeof v.intervalDays === 'number'
  && typeof v.due === 'string' && typeof v.stepIndex === 'number'
  && typeof v.reps === 'number' && typeof v.lapses === 'number'
  && typeof v.lastReviewedAt === 'string'

const isDailyStat = (v: unknown) =>
  isRecord(v) && typeof v.reviewed === 'number' && typeof v.newLearned === 'number'
  && typeof v.correct === 'number' && typeof v.quizTaken === 'number'

export function isProgress(v: unknown): v is Progress {
  return isRecord(v) && v.version === 1
    && isRecord(v.settings) && typeof v.settings.newPerDay === 'number'
    && isRecord(v.words) && Object.values(v.words).every(isProgressEntry)
    && isRecord(v.dailyStats) && Object.values(v.dailyStats).every(isDailyStat)
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * A staging entry only has two fields, and both are strictly checked.
 * `headword` can't be a blank string -- an empty entry is an invisible but
 * space-occupying ghost on the page, and after normalization its key would
 * be empty, colliding with the next empty entry.
 */
export function isStagingItem(v: unknown): v is StagingItem {
  return isRecord(v)
    && typeof v.headword === 'string' && v.headword.trim().length > 0
    && typeof v.addedAt === 'string' && DATE.test(v.addedAt)
}

export function isWordsOp(v: unknown): v is WordsOp {
  if (!isRecord(v)) return false
  if (v.kind === 'delete') return isStrings(v.ids)
  if (v.kind === 'upsert') return isWord(v.word)
  return false
}

// --- Serialization & parsing -------------------------------------------------
// 2-space indent + trailing newline: only this way is the diff on GitHub's web UI readable entry by entry.

export const serializeProgress = (p: Progress): string => `${JSON.stringify(p, null, 2)}\n`

export const serializeWords = (words: Word[]): string =>
  `${JSON.stringify({ version: 1, words } satisfies WordsFile, null, 2)}\n`

export const serializeStaging = (items: StagingItem[]): string =>
  `${JSON.stringify({ version: 1, items } satisfies StagingFile, null, 2)}\n`

function parseJson(text: string): unknown {
  try { return JSON.parse(text) } catch { throw new Error(BACKUP_HINT) }
}

/** Parses the remote progress.json; throws on a bad shape, leaving the caller to refuse overwriting the remote */
export function parseProgress(text: string): Progress {
  const raw = parseJson(text)
  if (!isProgress(raw)) throw new Error(BACKUP_HINT)
  return raw
}

/** Parses the remote words.json; throws on a bad shape, leaving the caller to refuse overwriting the remote */
export function parseWords(text: string): Word[] {
  const raw = parseJson(text)
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.words)) throw new Error(BACKUP_HINT)
  if (!raw.words.every(isWord)) throw new Error(BACKUP_HINT)
  return raw.words
}

/** Parses the remote staging.json; throws on a bad shape, leaving the caller to decide whether to refuse overwriting or treat it as absent */
export function parseStaging(text: string): StagingItem[] {
  const raw = parseJson(text)
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.items)) throw new Error(BACKUP_HINT)
  if (!raw.items.every(isStagingItem)) throw new Error(BACKUP_HINT)
  return raw.items
}

// --- Staging area merge ---------------------------------------------------

/** Trims leading/trailing whitespace, folds internal runs of whitespace to a single space. Case is preserved -- this is what people actually see. */
export const cleanHeadword = (s: string): string => s.trim().replace(/\s+/g, ' ')

/** The dedup/merge key: lowercased on top of cleanHeadword. "Ad  Hoc" and "ad hoc" are the same word. */
export const normalizeHeadword = (s: string): string => cleanHeadword(s).toLowerCase()

/**
 * Staging merge = union by normalized headword, keeping the earlier `addedAt` for the same word.
 *
 * Much simpler than progress's per-word comparison of `lastReviewedAt`,
 * because here there's only one kind of action, "append" (removal happens
 * within a session, via a person pushing a fresh file), so the union is
 * naturally idempotent -- replaying the same entry any number of times
 * yields the same result, with no need for a pending-push queue to
 * distinguish "what actually changed this time".
 *
 * "Keep the earlier one" takes the whole entry, not just the date: the date
 * is YYYY-MM-DD, so lexicographic order is chronological order. The content
 * doesn't depend on merge direction (a∪b and b∪a produce the same set of
 * entries), only the ordering follows first appearance.
 */
export function mergeStaging(a: StagingItem[], b: StagingItem[]): StagingItem[] {
  const byKey = new Map<string, StagingItem>()
  for (const it of [...a, ...b]) {
    const key = normalizeHeadword(it.headword)
    if (key === '') continue        // empty entries don't get queued (the remote is already blocked by parseStaging; this guards against local construction)
    const prev = byKey.get(key)
    if (!prev || it.addedAt < prev.addedAt) byKey.set(key, it)   // Map.set doesn't move an existing key's position
  }
  return [...byKey.values()]
}

/**
 * Reads the remote staging.json, **treating any failure as "the remote doesn't have this file yet"**.
 *
 * Of the three sync files it's the least important: vocabulary and progress
 * are the user's real assets, staging is just a handful of not-yet-completed
 * words. So a missing file, a parse failure, even a read error, must never
 * let an exception bubble up to the login/boot path -- a throw there means
 * "can't log in" or "progress isn't syncing". The push path doesn't use this
 * function; there, "absent" and "corrupted" must be distinguished (see
 * pushStaging).
 */
export async function loadStaging(
  client: SyncClient,
): Promise<{ items: StagingItem[]; sha: string } | null> {
  try {
    const f = await client.getFile(STAGING_PATH)
    return f ? { items: parseStaging(f.content), sha: f.sha } : null
  } catch {
    return null
  }
}

// --- Vocabulary change replay ----------------------------------------------

export function applyWordOps(words: Word[], ops: WordsOp[]): Word[] {
  let out = words
  for (const op of ops) {
    if (op.kind === 'delete') {
      const ids = new Set(op.ids)
      out = out.filter(w => !ids.has(w.id))
    } else {
      const { word } = op
      out = out.some(w => w.id === word.id)
        ? out.map(w => (w.id === word.id ? word : w))
        : [...out, word]
    }
  }
  return out
}

// --- Reconciling once a push returns ---------------------------------------
// A push is asynchronous, and `pushed` is a snapshot from the **instant the
// request went out** (possibly already merged with the remote). Overwriting
// local state with it directly would swallow whatever changes the user made
// while the request was in flight -- this is this App's worst failure mode,
// so it's pulled into its own function with tests watching it; don't delete
// it as if it were redundant with sync's internal merging.

export function reconcileProgress(current: Progress, pushed: Progress): Progress {
  return pushed === current ? current : mergeProgress(current, pushed)
}

export function reconcileWords(current: Word[], pushed: Word[], stillPending: WordsOp[]): Word[] {
  return pushed === current ? current : applyWordOps(pushed, stillPending)
}

export function reconcileStaging(
  current: StagingItem[], pushed: StagingItem[], stillPending: StagingItem[],
): StagingItem[] {
  return pushed === current ? current : mergeStaging(pushed, stillPending)
}

// --- Push -------------------------------------------------------------------

/**
 * Pushes progress.json.
 *
 * dirty is cleared **before** the request goes out: if the user grades
 * another word while it's in flight, that sets it back to true, so this
 * success doesn't "swallow" that change into looking synced. Re-marked
 * dirty on failure.
 */
export async function pushProgress(
  client: SyncClient, local: Progress, opts: PushOptions = {},
): Promise<PushOutcome<Progress>> {
  const alive = opts.alive ?? (() => true)
  if (alive()) storage.set('dirty', false)
  try {
    const sha = storage.get<string>('progressSha') ?? undefined
    const first = await client.putFile(PROGRESS_PATH, serializeProgress(local), 'sync progress', sha)
    if (first !== 'conflict') {
      if (alive()) storage.set('progressSha', first.sha)
      return { ok: true, sha: first.sha, data: local }
    }

    const remote = await client.getFile(PROGRESS_PATH)
    const merged = remote ? mergeProgress(local, parseProgress(remote.content)) : local
    const second = await client.putFile(
      PROGRESS_PATH, serializeProgress(merged), 'sync progress (merged)', remote?.sha,
    )
    if (second === 'conflict') {
      if (alive()) storage.set('dirty', true)
      return { ok: false, error: GIVE_UP }
    }
    if (alive()) storage.set('progressSha', second.sha)
    return { ok: true, sha: second.sha, data: merged }
  } catch (e) {
    if (alive()) storage.set('dirty', true)
    return { ok: false, error: errText(e) }
  }
}

/**
 * Pushes words.json (whole-file overwrite). No field-level merge on
 * conflict -- instead the remote is re-pulled and any not-yet-confirmed
 * add/deletes are replayed onto it, which is how entries added concurrently
 * elsewhere get preserved.
 */
export async function pushWords(
  client: SyncClient, local: Word[], ops: WordsOp[], opts: PushOptions = {},
): Promise<PushOutcome<Word[]>> {
  const alive = opts.alive ?? (() => true)
  try {
    const sha = storage.get<string>('wordsSha') ?? undefined
    const first = await client.putFile(WORDS_PATH, serializeWords(local), 'update words', sha)
    if (first !== 'conflict') {
      if (alive()) storage.set('wordsSha', first.sha)
      return { ok: true, sha: first.sha, data: local }
    }

    const remote = await client.getFile(WORDS_PATH)
    const replayed = remote ? applyWordOps(parseWords(remote.content), ops) : local
    const second = await client.putFile(
      WORDS_PATH, serializeWords(replayed), 'update words (merged)', remote?.sha,
    )
    if (second === 'conflict') return { ok: false, error: GIVE_UP }
    if (alive()) storage.set('wordsSha', second.sha)
    return { ok: true, sha: second.sha, data: replayed }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

/**
 * Pushes staging.json. Timing and conflict strategy are copied straight
 * from words.json (push on every change, no debounce; on conflict, re-pull
 * the remote, merge in this session's staged words, and push again; give up
 * and leave it for next time if it conflicts again).
 *
 * The only difference from pushWords is that "replay" becomes a union merge
 * -- there's no delete action to replay, so `pending` is directly the set
 * of entries to merge in.
 *
 * Note this **doesn't** swallow parse errors: a corrupted remote file must
 * abort, not get overwritten with the local copy. The leniency on the
 * boot/login path is loadStaging's job -- the two paths want exactly
 * opposite things.
 */
export async function pushStaging(
  client: SyncClient, local: StagingItem[], pending: StagingItem[], opts: PushOptions = {},
): Promise<PushOutcome<StagingItem[]>> {
  const alive = opts.alive ?? (() => true)
  try {
    const sha = storage.get<string>('stagingSha') ?? undefined
    const first = await client.putFile(STAGING_PATH, serializeStaging(local), 'update staging', sha)
    if (first !== 'conflict') {
      if (alive()) storage.set('stagingSha', first.sha)
      return { ok: true, sha: first.sha, data: local }
    }

    const remote = await client.getFile(STAGING_PATH)
    const merged = remote ? mergeStaging(parseStaging(remote.content), pending) : local
    const second = await client.putFile(
      STAGING_PATH, serializeStaging(merged), 'update staging (merged)', remote?.sha,
    )
    if (second === 'conflict') return { ok: false, error: GIVE_UP }
    if (alive()) storage.set('stagingSha', second.sha)
    return { ok: true, sha: second.sha, data: merged }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}
