import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { GitHubClient } from '../lib/github'
import { mergeProgress } from '../lib/merge'
import { gradeWord, todayStr } from '../lib/srs'
import { storage } from '../lib/storage'
import { emptyProgress, emptyStat } from '../types'
import type { Grade, Progress, StagingItem, Word } from '../types'
import { classifySyncFailure, friendlyError, httpStatus, logoutDiscarded, ownerSwitched } from './errors'
import {
  appendPendingOp, appendPendingStaging, bootSnapshot, cachedProgress, carryOverFor,
  pendingOps, pendingStaging, setPendingOps, setPendingStaging,
} from './session'
import {
  applyWordOps, cleanHeadword, loadStaging, mergeStaging, parseProgress, parseWords,
  PROGRESS_PATH, pushProgress, pushStaging, pushWords,
  reconcileProgress, reconcileStaging, reconcileWords, serializeProgress, WORDS_PATH,
} from './sync'
import type { SyncClient, WordsOp } from './sync'

/**
 * React bindings for global state + sync orchestration.
 *
 * Everything that doesn't need React has been pulled out: remote
 * orchestration lives in ./sync.ts, local caching and boot state in
 * ./session.ts, error classification and copy in ./errors.ts. What's left
 * here is local persistence, debounce timing, online/visibility events, and
 * mapping the result into state the pages can read.
 */

const DATA_REPO = 'volcab-data'
const PUSH_DEBOUNCE_MS = 30_000

export interface AppState {
  phase: 'boot' | 'login' | 'ready'
  owner: string | null
  words: Word[]
  progress: Progress
  /** New-word staging area: just headwords, todos not yet filled in. Filling in happens in a session, not in the App. */
  staging: StagingItem[]
  syncStatus: 'synced' | 'pending' | 'offline' | 'error'
  /**
   * The reason login failed, and **only** login failures. The login page
   * attaches it as the field error on the token input, which also marks the
   * input aria-invalid — notices where the input itself isn't the problem
   * (e.g. unsynced data discarded on logout) must not go through here; use
   * syncError instead.
   */
  loginError: string | null
  /**
   * The specific reason for a sync degradation / data discard (gave up
   * after a conflict, remote file corrupted and needs a backup export,
   * rate limited, discarded on account switch, unsynced data discarded on
   * logout...). syncStatus only has four enum values, not enough room for
   * the sentence users need to see. Cleared on the next success; shown by
   * the login page's notice area when we fall back there.
   */
  syncError: string | null
}

export interface AppActions {
  login(token: string): Promise<void>
  logout(): void
  grade(wordId: string, g: Grade): void
  /** Stubborn-word drill, graded one card at a time: practice only, so a miss pulls the due date forward and nothing else moves */
  recordLapseDrill(wordId: string, g: Grade): void
  /** Same-day consolidation pass over today's new words. Practice, like recordLapseDrill, but a miss is not counted as a lapse */
  recordConsolidation(wordId: string, g: Grade): void
  /** Reject a suggested word, permanently: the id is remembered in synced progress so later suggestion batches skip it */
  dismissSuggestion(id: string): void
  recordQuiz(correct: number, total: number, wrongIds: string[]): void
  /** Sprint settlement: like recordQuiz, only pulls forward the due date of missed words, plus refreshes the personal best score */
  recordSprint(score: number, wrongIds: string[]): void
  /** Add or edit an entry (upsert by id), pushes words.json immediately */
  saveWord(word: Word): Promise<void>
  /** Delete entries, also clearing their progress records */
  deleteWords(ids: string[]): Promise<void>
  /**
   * Drops a word into the staging area awaiting completion, pushes
   * staging.json immediately.
   *
   * Pure mechanical append: if it's already in the list after case/whitespace
   * normalization, this returns as a no-op. Policy judgments like "this word
   * is already in the vocabulary" are left to the calling page (it holds
   * both words and staging, so it can give an actionable hint in place).
   */
  addStaging(headword: string): Promise<void>
  updateSettings(s: Progress['settings']): void
  syncNow(): Promise<void>
  /** Export a {words, progress, staging} JSON string */
  exportAll(): string
  /** Dev mode only: enter demo mode using the vocabulary bundled in the repo, never touching the network; undefined in production builds */
  enterDemoMode?: () => Promise<void>
}

export type AppContextValue = AppState & AppActions

const AppContext = createContext<AppContextValue | null>(null)

// --- Provider -------------------------------------------------------------

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(() => ({
    ...bootSnapshot(import.meta.env.DEV),
    syncStatus: navigator.onLine ? 'synced' : 'offline',
    loginError: null,
    syncError: null,
  }))

  // Pushes happen inside async callbacks and must read "right now" state, so state is also mirrored on a ref
  const stateRef = useRef(state)
  const clientRef = useRef<SyncClient | null>(null)
  const demoRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pushingRef = useRef(false)           // progress push mutex
  const rerunRef = useRef(false)
  const wordsPushingRef = useRef(false)      // words push mutex
  const wordsRerunRef = useRef(false)
  const stagingPushingRef = useRef(false)    // staging push mutex
  const stagingRerunRef = useRef(false)
  const sessionRef = useRef(0)               // incremented on login/logout: in-flight responses are invalidated against this
  const bootedRef = useRef(false)

  const update = useCallback((patch: Partial<AppState>) => {
    stateRef.current = { ...stateRef.current, ...patch }
    setState(stateRef.current)
  }, [])

  const settleStatus = useCallback((): AppState['syncStatus'] => {
    if (demoRef.current) return 'synced'
    if (!navigator.onLine) return 'offline'
    // Pending staged words also count as "still owed to the remote". This is
    // the most important line here: if a staging push fails and a later
    // flushProgress succeeds, that clears syncError — at that point this
    // pending check is the only thing still signaling "not fully synced".
    // Without it, a failed staging push would end up displayed as "synced".
    const owing = storage.get<boolean>('dirty') || pendingOps().length > 0 || pendingStaging().length > 0
    return owing ? 'pending' : 'synced'
  }, [])

  /** Cleanup after a successful push: settle status, and clear whatever explanation the last failure left behind */
  const markSettled = useCallback(() => {
    update({ syncStatus: settleStatus(), syncError: null })
  }, [settleStatus, update])

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  /** In demo mode, the vocabulary is read fresh from the repo every time and never persisted, so we don't leave a stale 500KB copy sitting around locally */
  const cacheWords = useCallback((words: Word[]) => {
    if (!demoRef.current) storage.set('words', words)
  }, [])

  const cacheStaging = useCallback((items: StagingItem[]) => {
    if (!demoRef.current) storage.set('staging', items)
  }, [])

  const toLogin = useCallback((loginError: string, clearToken: boolean) => {
    clearTimer()
    sessionRef.current += 1
    clientRef.current = null
    // Only clear the token, keep owner: on re-login this is how we recognize it's the same person and carry unpushed changes back over
    if (clearToken) storage.remove('token')
    // Clear syncError too: the previous sync-failure explanation has nowhere
    // to go on the login page — leaving it would just say one thing in each
    // of two areas alongside the real reason (loginError) here, reading as
    // if two separate things went wrong.
    update({ phase: 'login', loginError, owner: null, syncError: null })
  }, [clearTimer, update])

  /**
   * The single landing point for push failures. Only a 401 (token revoked)
   * falls back to the login page; a 403 never does — rate limiting is
   * temporary, and clearing a valid token over it is a net loss, so we just
   * tell the user to wait.
   */
  const failSync = useCallback((error: string) => {
    const failure = classifySyncFailure(error)
    if (failure.kind === 'auth') { toLogin(failure.message, true); return }
    update({ syncStatus: navigator.onLine ? 'error' : 'offline', syncError: failure.message })
  }, [toLogin, update])

  // --- Push -----------------------------------------------------------------

  const flushProgress = useCallback(async (): Promise<void> => {
    clearTimer()
    const client = clientRef.current
    if (demoRef.current || !client) return
    if (!navigator.onLine) { update({ syncStatus: 'offline' }); return }
    if (!storage.get<boolean>('dirty')) { update({ syncStatus: settleStatus() }); return }
    // One is already in flight: let it finish and run one more round after, don't write the same file concurrently
    if (pushingRef.current) { rerunRef.current = true; return }

    pushingRef.current = true
    const session = sessionRef.current
    const alive = () => session === sessionRef.current
    try {
      for (;;) {
        rerunRef.current = false
        const out = await pushProgress(client, stateRef.current.progress, { alive })
        if (!alive()) return                      // logged out/switched accounts meanwhile, discard the result
        if (!out.ok) { failSync(out.error); return }

        const next = reconcileProgress(stateRef.current.progress, out.data)
        if (next !== stateRef.current.progress) {
          storage.set('progress', next)
          update({ progress: next })
        }
        markSettled()
        if (!rerunRef.current || !storage.get<boolean>('dirty')) return
      }
    } finally {
      pushingRef.current = false
    }
  }, [clearTimer, failSync, markSettled, settleStatus, update])

  const schedulePush = useCallback(() => {
    if (demoRef.current || !clientRef.current) return
    clearTimer()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void flushProgress()
    }, PUSH_DEBOUNCE_MS)
  }, [clearTimer, flushProgress])

  /** Vocabulary changes aren't debounced, pushed immediately. Omitting op means only retrying whatever's backed up in the queue. */
  const flushWords = useCallback(async (op?: WordsOp): Promise<void> => {
    if (op) appendPendingOp(op)
    const client = clientRef.current
    // Demo mode has no remote to push to, so clearing the queue is correct —
    // it never owed anything to begin with.
    if (demoRef.current) { setPendingOps([]); return }
    // But "no client" is a completely different story: when the token is
    // revoked and we're kicked back to the login page, owner / wordOps /
    // dirty are deliberately left behind so carryOverFor can replay them on
    // re-login. Clearing the queue here would wipe out the user's unsynced
    // vocabulary edits outright. Return in place, touch nothing.
    if (!client) return
    if (!navigator.onLine) { update({ syncStatus: 'offline' }); return }
    if (wordsPushingRef.current) { wordsRerunRef.current = true; return }

    wordsPushingRef.current = true
    const session = sessionRef.current
    const alive = () => session === sessionRef.current
    try {
      for (;;) {
        wordsRerunRef.current = false
        const sending = pendingOps()
        const out = await pushWords(client, stateRef.current.words, sending, { alive })
        if (!alive()) return
        if (!out.ok) { failSync(out.error); return }

        const remaining = pendingOps().slice(sending.length)   // changes made while the push was in flight
        setPendingOps(remaining)
        const next = reconcileWords(stateRef.current.words, out.data, remaining)
        if (next !== stateRef.current.words) {
          cacheWords(next)
          update({ words: next })
        }
        markSettled()
        if (!wordsRerunRef.current) return
      }
    } finally {
      wordsPushingRef.current = false
    }
  }, [cacheWords, failSync, markSettled, update])

  /**
   * Staged words aren't debounced either, pushed immediately — same timing
   * as vocabulary changes. Omitting item means only retrying whatever's
   * backed up in the queue.
   *
   * Written line-for-line against flushWords, including the two branches
   * that can't be skipped: clear the queue in demo mode, and **return in
   * place** when there's no client (stagingOps needs to stay put so it can
   * be replayed after re-login; clearing it would wipe out the words the
   * user typed in).
   */
  const flushStaging = useCallback(async (it?: StagingItem): Promise<void> => {
    if (it) appendPendingStaging(it)
    const client = clientRef.current
    if (demoRef.current) { setPendingStaging([]); return }
    if (!client) return
    if (!navigator.onLine) { update({ syncStatus: 'offline' }); return }
    if (stagingPushingRef.current) { stagingRerunRef.current = true; return }

    stagingPushingRef.current = true
    const session = sessionRef.current
    const alive = () => session === sessionRef.current
    try {
      for (;;) {
        stagingRerunRef.current = false
        const sending = pendingStaging()
        const out = await pushStaging(client, stateRef.current.staging, sending, { alive })
        if (!alive()) return
        // On failure the queue is left as-is (no setPendingStaging), and
        // retried automatically next time we're back online / go to
        // background / sync manually. Same handling as the other two files:
        // only a 401 logs out, everything else just notifies. Any later
        // successful push clears this notice, while settleStatus still
        // reports "pending" because the queue is non-empty — a failure is
        // never dressed up as "synced", nor does it block forever.
        if (!out.ok) { failSync(out.error); return }

        const remaining = pendingStaging().slice(sending.length)   // words staged while the push was in flight
        setPendingStaging(remaining)
        const next = reconcileStaging(stateRef.current.staging, out.data, remaining)
        if (next !== stateRef.current.staging) {
          cacheStaging(next)
          update({ staging: next })
        }
        markSettled()
        if (!stagingRerunRef.current) return
      }
    } finally {
      stagingPushingRef.current = false
    }
  }, [cacheStaging, failSync, markSettled, update])

  /** Persist locally + mark dirty + refresh state; push timing (debounced / immediate) is up to the caller */
  const commitProgress = useCallback((progress: Progress) => {
    storage.set('progress', progress)
    if (!demoRef.current) storage.set('dirty', true)   // demo mode never owes the remote anything
    update({ progress, syncStatus: settleStatus() })
  }, [settleStatus, update])

  // --- Session --------------------------------------------------------------

  const enterDemoMode = useCallback(async (): Promise<void> => {
    // The whole block is wrapped in the DEV branch: production builds fold it to if(false), and the vocabulary's dynamic import gets tree-shaken away along with its chunk
    if (import.meta.env.DEV) {
      clearTimer()
      sessionRef.current += 1
      const session = sessionRef.current
      clientRef.current = null
      const words: Word[] = (await import('../../data/words.json')).default.words
      if (session !== sessionRef.current) return   // a real login/logout happened meanwhile, don't overwrite it with demo data
      demoRef.current = true
      setPendingOps([])
      setPendingStaging([])
      const progress = cachedProgress() ?? emptyProgress()
      storage.set('owner', 'demo')       // vocabulary isn't cached: every demo run reads fresh from the repo, only progress is kept
      storage.set('progress', progress)
      update({
        phase: 'ready', owner: 'demo', words, progress, staging: [],
        loginError: null, syncError: null, syncStatus: 'synced',
      })
    }
  }, [clearTimer, update])

  const login = useCallback(async (token: string): Promise<void> => {
    sessionRef.current += 1
    const session = sessionRef.current
    update({ loginError: null })
    try {
      const owner = await GitHubClient.whoAmI(token)
      const client = new GitHubClient(token, owner, DATA_REPO)
      await client.validate()

      const wf = await client.getFile(WORDS_PATH)
      if (!wf) throw new Error(`${owner}/${DATA_REPO} 里还没有 words.json —— 请先初始化数据仓库再登录。`)
      const remoteWords = parseWords(wf.content)

      const pf = await client.getFile(PROGRESS_PATH)
      let progress = emptyProgress()
      let progressSha: string | null = null
      if (pf) {
        progress = parseProgress(pf.content)
        progressSha = pf.sha
      } else {
        // First login: the remote doesn't have progress.json yet, create an empty one and push it up
        const put = await client.putFile(PROGRESS_PATH, serializeProgress(progress), 'init progress')
        progressSha = put === 'conflict' ? null : put.sha
      }

      // The third file is read last and **never throws** (loadStaging folds
      // missing/corrupted/read-failure all into null). It's the least
      // important of the three: locking the user out of their vocabulary
      // and review progress over a handful of not-yet-completed words would
      // be wildly disproportionate.
      // Also not created here if the remote doesn't have staging.json yet —
      // it naturally gets created the first time a staged word gets pushed.
      const sf = await loadStaging(client)
      if (session !== sessionRef.current) return

      // A revoked token leaves this device stuck with "unpushed changes";
      // re-login must not just overwrite them with the remote. Carry over on
      // the same account, discard and report who lost what on an account
      // switch — the decision lives in session.ts, guarded by tests.
      const carry = carryOverFor(owner)
      if (carry.progress) progress = mergeProgress(carry.progress, progress)
      const words = applyWordOps(remoteWords, carry.ops)
      // Treat an unreadable remote as empty, keeping only the handful this
      // device hasn't pushed yet — don't use a stale local cache to guess
      // what the remote has, that would overwrite words staged elsewhere on
      // the next push.
      const staging = mergeStaging(sf?.items ?? [], carry.staging)

      storage.set('token', token)
      storage.set('owner', owner)
      storage.set('words', words)
      storage.set('wordsSha', wf.sha)
      storage.set('progress', progress)
      storage.set('staging', staging)
      if (progressSha) storage.set('progressSha', progressSha)
      else storage.remove('progressSha')
      if (sf) storage.set('stagingSha', sf.sha)
      else storage.remove('stagingSha')
      storage.set('dirty', carry.progress !== null)   // carried-over old changes still owe the remote one more push
      setPendingOps(carry.ops)
      setPendingStaging(carry.staging)

      clientRef.current = client
      demoRef.current = false
      // A successful login always rewrites syncError: either it becomes
      // "whose changes got discarded on account switch", or it's cleared.
      // Whatever discard notice was left by the last logout ends here — the
      // two never stack, and never overwrite each other, since the latter
      // is only produced at this instant and the former only lives until
      // the next successful login.
      update({
        phase: 'ready', owner, words, progress, staging, loginError: null,
        syncError: carry.discardedOwner ? ownerSwitched(carry.discardedOwner) : null,
        syncStatus: settleStatus(),
      })
      if (carry.ops.length > 0) await flushWords()
      if (carry.staging.length > 0) await flushStaging()
      if (carry.progress) await flushProgress()   // progress matters most, so it's the last cleanup step
    } catch (e) {
      if (session !== sessionRef.current) return
      update({ phase: 'login', loginError: friendlyError(e) })
    }
  }, [flushProgress, flushStaging, flushWords, settleStatus, update])

  const logout = useCallback(() => {
    // Logging out means "wipe this account's data off this device"; anything unpushed just has to be dropped — but we need to say so
    const droppedOps = pendingOps().length
    const droppedStaging = pendingStaging().length
    // dirty alone isn't enough to tell whether progress still owes the
    // remote: pushProgress clears it before the request even goes out
    // (that's the mechanism preventing a grade made mid-flight from being
    // swallowed, and it can't change). So for the whole round trip of a
    // push, dirty stays false while progress hasn't actually landed yet — if
    // logout happened right then it would silently wipe the device, and
    // that review would exist neither locally nor remotely.
    // Compare with wordOps / stagingOps: those are only cleared after
    // confirmed success, so they count correctly. This asymmetry is the
    // root cause, so here's the other half of the fix: a request still in
    // flight still counts as owed.
    const droppedProgress = storage.get<boolean>('dirty') === true || pushingRef.current
    clearTimer()
    sessionRef.current += 1
    clientRef.current = null
    demoRef.current = false
    pushingRef.current = false      // in case a request gets stuck and never returns, don't let the mutex block the next login's push too
    wordsPushingRef.current = false
    stagingPushingRef.current = false
    storage.clearAll()
    // "What got discarded" is a data notice, not a login failure: it goes
    // through syncError, shown by the login page's neutral notice area.
    // Putting it in loginError would mark the token input aria-invalid —
    // that field has nothing wrong with it right now, the user hasn't even
    // started typing. Write null when nothing was discarded, which also
    // clears out whatever sync failure existed before logout.
    update({
      phase: 'login', owner: null, words: [], progress: emptyProgress(), staging: [], loginError: null,
      syncError: droppedOps > 0 || droppedProgress || droppedStaging > 0
        ? logoutDiscarded(droppedOps, droppedProgress, droppedStaging)
        : null,
      syncStatus: navigator.onLine ? 'synced' : 'offline',
    })
  }, [clearTimer, update])

  // --- Boot -----------------------------------------------------------------

  const boot = useCallback(async (): Promise<void> => {
    const token = storage.get<string>('token')
    const owner = storage.get<string>('owner')
    if (import.meta.env.DEV && !token && owner === 'demo') { await enterDemoMode(); return }
    if (!token || !owner) return   // initial state is already login

    const client = new GitHubClient(token, owner, DATA_REPO)
    clientRef.current = client
    const session = sessionRef.current
    try {
      // loadStaging swallows every failure itself, so it can never make this
      // whole Promise.all reject — a missing or corrupted staging.json must
      // not drag the words/progress boot path down into the catch with it.
      const [wf, pf, sf] = await Promise.all([
        client.getFile(WORDS_PATH), client.getFile(PROGRESS_PATH), loadStaging(client),
      ])
      if (session !== sessionRef.current) return

      let words = stateRef.current.words
      if (wf) {
        // Vocabulary defers to the remote, but any add/delete that failed to
        // push last time needs replaying first, or overwriting with this
        // cache would erase the user's edits — the queue is persisted, so
        // it's still there even after closing and reopening the page.
        words = applyWordOps(parseWords(wf.content), pendingOps())
        cacheWords(words)
        storage.set('wordsSha', wf.sha)
      } else if (words.length === 0) {
        throw new Error(`${owner}/${DATA_REPO} 里没有 words.json —— 请先初始化数据仓库。`)
      }

      let progress = stateRef.current.progress
      if (pf) {
        progress = mergeProgress(progress, parseProgress(pf.content))
        storage.set('progressSha', pf.sha)
      }

      // Same rule as vocabulary: defer to the remote + replay staged words
      // that failed to push. If the remote can't be read (missing/corrupt/
      // read failure), keep using this device's copy — only that way do
      // entries the completion flow removed from the remote actually stay
      // gone, instead of getting merged back in by the local cache.
      const staging = mergeStaging(sf ? sf.items : stateRef.current.staging, pendingStaging())
      if (sf) storage.set('stagingSha', sf.sha)
      cacheStaging(staging)

      storage.set('progress', progress)
      update({ phase: 'ready', owner, words, progress, staging, loginError: null })

      if (pendingOps().length > 0) await flushWords()
      if (pendingStaging().length > 0) await flushStaging()
      if (storage.get<boolean>('dirty')) await flushProgress()
      else update({ syncStatus: settleStatus() })
    } catch (e) {
      if (session !== sessionRef.current) return
      if (httpStatus(e) === 401) { toLogin(friendlyError(e), true); return }
      // If there's a local cache, keep using it as usual and just flag the sync status; without a cache, fall back to the login page and explain why
      if (stateRef.current.phase === 'ready') {
        update({ syncStatus: navigator.onLine ? 'error' : 'offline', syncError: friendlyError(e) })
        return
      }
      toLogin(friendlyError(e), false)
    }
  }, [
    cacheStaging, cacheWords, enterDemoMode, flushProgress, flushStaging, flushWords,
    settleStatus, toLogin, update,
  ])

  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    void boot()
  }, [boot])

  // --- Actions --------------------------------------------------------------

  const grade = useCallback((wordId: string, g: Grade) => {
    const now = new Date()
    const day = todayStr(now)
    const cur = stateRef.current.progress
    const prev = cur.words[wordId]
    const stat = { ...(cur.dailyStats[day] ?? emptyStat()) }
    stat.reviewed += 1
    // No record, or still sitting at new, both count as one new word learned today — consistent with how buildQueue determines new words
    if (!prev || prev.state === 'new') stat.newLearned += 1
    if (g !== 'again') stat.correct += 1
    // The retention measurement, kept separate from the counters above: only
    // a word that had already graduated is a real test of the schedule. See
    // the comment on DailyStat.reviewPhase for why the two can't be the same
    // number. Read `prev`, not the graded result — grading an 'again' demotes
    // the word back to learning, and that card was still a review when it
    // was shown.
    if (prev?.state === 'review') {
      // Written as a pair, so "the field is absent" always means "this day
      // predates the measurement" and never "the only review that day was a
      // miss". mergeProgress leans on that: it omits a counter only when
      // neither side has it.
      stat.reviewPhase = (stat.reviewPhase ?? 0) + 1
      stat.reviewPhaseCorrect = (stat.reviewPhaseCorrect ?? 0) + (g === 'again' ? 0 : 1)
    }
    commitProgress({
      ...cur,
      words: { ...cur.words, [wordId]: gradeWord(prev, g, now, undefined, cur.settings.intervalModifier) },
      dailyStats: { ...cur.dailyStats, [day]: stat },
    })
    schedulePush()
  }, [commitProgress, schedulePush])

  /**
   * Grading inside a stubborn-word drill. **Practice, not review.**
   *
   * Same contract as recordQuiz — a missed word only gets its due date
   * pulled forward, ease/intervalDays/state are never touched — but graded
   * one card at a time, because the drill uses the review card UI.
   *
   * Why this can't just call grade(): the drill deliberately ignores due
   * dates, so the same word can be graded again and again on one day, and
   * every pass through gradeWord multiplies the interval by ease. Measured
   * on the live library before this change: the seven drilled words had
   * reps 11-15 against a library median of 4, and "embroil" had been
   * pushed out to a 273-day interval due 2027-04-28 — the longest in the
   * whole library. Drilling the hardest words had scheduled them furthest
   * away, which is precisely backwards.
   *
   * A miss still increments `lapses`: forgetting a word is a fact about
   * the word, not about which screen you were on, and it is the signal
   * that keeps a genuinely stubborn word at the top of tomorrow's list.
   * That counter feeds ranking only — it is not part of the schedule.
   */
  /**
   * The one grading path shared by both practice drills.
   *
   * A correct answer writes **nothing at all** to the word — not even
   * lastReviewedAt. mergeProgress takes whichever side's entry has the
   * later lastReviewedAt and takes it whole, so bumping that timestamp
   * without changing anything else would let this device's otherwise-stale
   * copy of the word beat a real review done on another device.
   */
  const practiceGrade = useCallback((wordId: string, g: Grade, countLapse: boolean) => {
    const now = new Date()
    const day = todayStr(now)
    const cur = stateRef.current.progress
    const prev = cur.words[wordId]
    if (!prev) return   // Nothing to grade against; the word was deleted from another device mid-session
    const correct = g !== 'again'
    const stat = { ...(cur.dailyStats[day] ?? emptyStat()) }
    // Counted as a review, not as a quiz: this is a card you looked at and
    // graded, so it has to keep the streak alive and show up in the 30-day
    // chart. newLearned is untouched — neither drill ever introduces a word.
    stat.reviewed += 1
    if (correct) stat.correct += 1
    const entry = correct
      ? prev
      : {
          ...prev,
          due: day,
          lastReviewedAt: now.toISOString(),
          ...(countLapse ? { lapses: prev.lapses + 1 } : {}),
        }
    commitProgress({
      ...cur,
      words: { ...cur.words, [wordId]: entry },
      dailyStats: { ...cur.dailyStats, [day]: stat },
    })
    schedulePush()
  }, [commitProgress, schedulePush])

  const recordLapseDrill = useCallback(
    (wordId: string, g: Grade) => practiceGrade(wordId, g, true),
    [practiceGrade],
  )

  /**
   * Grading inside the same-day consolidation pass. Same practice contract
   * as recordLapseDrill with one deliberate difference: a miss does **not**
   * count a lapse.
   *
   * A lapse means forgetting a word you had already learned. Every word in
   * this session was learned hours ago and is still on a one-day interval,
   * so fumbling one is the normal shape of learning, not a relapse.
   * Counting it would pour every shaky new word straight into the stubborn
   * list and drown the words that genuinely keep coming back.
   */
  const recordConsolidation = useCallback(
    (wordId: string, g: Grade) => practiceGrade(wordId, g, false),
    [practiceGrade],
  )

  /**
   * Rejecting a suggested word. Append-only, and nothing in the scheduler
   * ever reads it — the list exists so a word the user has already said no
   * to never comes back in a later batch.
   *
   * **Returns without committing when the id is already on the list.** Not
   * an optimisation: a suggestion batch is built from a snapshot, so the
   * same word can be offered again after a reload or on a second device,
   * and without this guard each pass would append a duplicate and mark
   * progress dirty for a change that isn't one — a push per no-op.
   *
   * Debounced like grading rather than pushed immediately (recordQuiz's
   * flushProgress): a dismissal is worth far less than a review, and a
   * discovery session produces a run of them.
   */
  const dismissSuggestion = useCallback((id: string) => {
    const cur = stateRef.current.progress
    const prev = cur.dismissed ?? []
    if (prev.includes(id)) return
    commitProgress({ ...cur, dismissed: [...prev, id] })
    schedulePush()
  }, [commitProgress, schedulePush])

  // The score itself isn't stored: missed words are already reflected in the review schedule by having their due date pulled forward; dailyStats just records "took a quiz today"
  const recordQuiz = useCallback((_correct: number, _total: number, wrongIds: string[]) => {
    const now = new Date()
    const day = todayStr(now)
    const cur = stateRef.current.progress
    const stat = { ...(cur.dailyStats[day] ?? emptyStat()) }
    stat.quizTaken += 1
    const words = { ...cur.words }
    for (const id of wrongIds) {
      const e = words[id]
      if (e) words[id] = { ...e, due: day, lastReviewedAt: now.toISOString() }  // only pull the due date forward, ease/interval untouched
    }
    commitProgress({ ...cur, words, dailyStats: { ...cur.dailyStats, [day]: stat } })
    void flushProgress()
  }, [commitProgress, flushProgress])

  // Sprint shares the same contract as recordQuiz (missed words only get
  // their due date pulled forward, ease/interval untouched); the one extra
  // thing it does is refresh the best score.
  const recordSprint = useCallback((score: number, wrongIds: string[]) => {
    const now = new Date()
    const day = todayStr(now)
    const cur = stateRef.current.progress
    const stat = { ...(cur.dailyStats[day] ?? emptyStat()) }
    stat.quizTaken += 1
    const words = { ...cur.words }
    for (const id of wrongIds) {
      const e = words[id]
      if (e) words[id] = { ...e, due: day, lastReviewedAt: now.toISOString() }
    }
    const next: Progress = { ...cur, words, dailyStats: { ...cur.dailyStats, [day]: stat } }
    // Only refresh on a **strict** greater-than: a tie shouldn't rewrite the
    // record date to today. Same rule as merge.ts's "equal score keeps the
    // earlier date" — the two must stay consistent, or a sync round trip
    // would fight itself.
    if (cur.bestSprint === undefined || score > cur.bestSprint.score) {
      next.bestSprint = { score, date: day }
    }
    commitProgress(next)
    void flushProgress()
  }, [commitProgress, flushProgress])

  const saveWord = useCallback(async (word: Word): Promise<void> => {
    const words = applyWordOps(stateRef.current.words, [{ kind: 'upsert', word }])
    cacheWords(words)
    update({ words })
    await flushWords({ kind: 'upsert', word })
  }, [cacheWords, flushWords, update])

  const deleteWords = useCallback(async (ids: string[]): Promise<void> => {
    const words = applyWordOps(stateRef.current.words, [{ kind: 'delete', ids }])
    const cur = stateRef.current.progress
    const entries = { ...cur.words }
    for (const id of ids) delete entries[id]   // clean up orphaned progress while we're at it
    cacheWords(words)
    update({ words })
    commitProgress({ ...cur, words: entries })  // progress goes through the normal debounce
    schedulePush()
    await flushWords({ kind: 'delete', ids })
  }, [cacheWords, commitProgress, flushWords, schedulePush, update])

  const addStaging = useCallback(async (raw: string): Promise<void> => {
    const it: StagingItem = { headword: cleanHeadword(raw), addedAt: todayStr(new Date()) }
    if (it.headword === '') return
    const staging = mergeStaging(stateRef.current.staging, [it])
    // Union: if it's already in the list (case/whitespace differences included), nothing got added, so there's nothing to do
    if (staging.length === stateRef.current.staging.length) return
    cacheStaging(staging)
    update({ staging })
    await flushStaging(it)
  }, [cacheStaging, flushStaging, update])

  const updateSettings = useCallback((s: Progress['settings']) => {
    // Stamp the modification time: mergeProgress relies on it to decide
    // whose settings are newer across two devices. Without it the field
    // would always be empty, merging would degrade to "always take local",
    // and settings would stop syncing again.
    const settings = { ...s, updatedAt: new Date().toISOString() }
    commitProgress({ ...stateRef.current.progress, settings })
    schedulePush()
  }, [commitProgress, schedulePush])

  const syncNow = useCallback(async (): Promise<void> => {
    if (demoRef.current || !clientRef.current) return
    if (!navigator.onLine) { update({ syncStatus: 'offline' }); return }
    if (pendingOps().length > 0) await flushWords()
    if (pendingStaging().length > 0) await flushStaging()
    await flushProgress()
  }, [flushProgress, flushStaging, flushWords, update])

  // Backups must include the staging area too: those words were typed in by the user, just not filled in yet
  const exportAll = useCallback(
    () => JSON.stringify({
      words: stateRef.current.words,
      progress: stateRef.current.progress,
      staging: stateRef.current.staging,
    }, null, 2),
    [],
  )

  // --- Network & visibility ---------------------------------------------------

  useEffect(() => {
    const onOnline = () => { update({ syncStatus: settleStatus() }); void syncNow() }
    const onOffline = () => update({ syncStatus: demoRef.current ? 'synced' : 'offline' })
    // Backgrounding/locking the screen could well be the end of this session, so don't wait on the debounce if there are unpushed changes
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return
      if (storage.get<boolean>('dirty')) void flushProgress()
      if (pendingOps().length > 0) void flushWords()
      if (pendingStaging().length > 0) void flushStaging()
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [flushProgress, flushStaging, flushWords, settleStatus, syncNow, update])

  useEffect(() => clearTimer, [clearTimer])   // don't leave the debounce timer behind on unmount

  const value = useMemo<AppContextValue>(() => ({
    ...state,
    login, logout, grade, recordLapseDrill, recordConsolidation, dismissSuggestion, recordQuiz, recordSprint, saveWord, deleteWords, addStaging,
    updateSettings, syncNow, exportAll,
    ...(import.meta.env.DEV ? { enterDemoMode } : {}),
  }), [
    state, login, logout, grade, recordLapseDrill, recordConsolidation, dismissSuggestion, recordQuiz, recordSprint, saveWord, deleteWords, addStaging,
    updateSettings, syncNow, exportAll, enterDemoMode,
  ])

  return <AppContext value={value}>{children}</AppContext>
}

// Deliberately kept in the same file as AppProvider: pages only need one
// entry point, `from '../state/store'`. The Fast Refresh warning doesn't
// apply here — all state lives on AppProvider, so any change to this file
// forces a remount regardless.
// oxlint-disable-next-line react/only-export-components
export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within <AppProvider>')
  return ctx
}
