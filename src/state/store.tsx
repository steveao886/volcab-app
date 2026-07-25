import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { GitHubClient } from '../lib/github'
import { mergeProgress } from '../lib/merge'
import { gradeWord, todayStr } from '../lib/srs'
import { storage } from '../lib/storage'
import { emptyProgress, emptyStat } from '../types'
import type { Grade, Progress, Word } from '../types'
import { classifySyncFailure, friendlyError, httpStatus, logoutDiscarded, ownerSwitched } from './errors'
import {
  appendPendingOp, bootSnapshot, cachedProgress, carryOverFor, pendingOps, setPendingOps,
} from './session'
import {
  applyWordOps, parseProgress, parseWords, PROGRESS_PATH, pushProgress, pushWords,
  reconcileProgress, reconcileWords, serializeProgress, WORDS_PATH,
} from './sync'
import type { SyncClient, WordsOp } from './sync'

/**
 * 全局状态 + 同步编排的 React 绑定。
 *
 * 能不依赖 React 的都摘出去了:远端编排在 ./sync.ts,本机缓存与启动状态在
 * ./session.ts,错误分类与文案在 ./errors.ts。这里只剩本地落盘、防抖时机、
 * 在线/可见性事件,以及把结果映射成页面能读的状态。
 */

const DATA_REPO = 'volcab-data'
const PUSH_DEBOUNCE_MS = 30_000

export interface AppState {
  phase: 'boot' | 'login' | 'ready'
  owner: string | null
  words: Word[]
  progress: Progress
  syncStatus: 'synced' | 'pending' | 'offline' | 'error'
  /**
   * 登录失败的原因,且**只有**登录失败。登录页把它接在 token 输入框的
   * Field error 上,会同时把输入框标成 aria-invalid —— 输入框本身没问题的
   * 通知(如退出时丢弃了未同步数据)不能走这里,走 syncError。
   */
  loginError: string | null
  /**
   * 同步降级/数据丢弃的具体原因(冲突放弃、远端文件损坏要导出备份、限流、
   * 跨账号丢弃、退出时丢弃未同步数据……)。syncStatus 只有四个枚举值,装不下
   * 要给用户看的那句话。成功一次即清空;退到登录页时由登录页的通知区展示。
   */
  syncError: string | null
}

export interface AppActions {
  login(token: string): Promise<void>
  logout(): void
  grade(wordId: string, g: Grade): void
  recordQuiz(correct: number, total: number, wrongIds: string[]): void
  /** 新增或编辑词条(按 id upsert),立即推送 words.json */
  saveWord(word: Word): Promise<void>
  /** 删除词条,同时清掉它们的进度记录 */
  deleteWords(ids: string[]): Promise<void>
  updateSettings(s: Progress['settings']): void
  syncNow(): Promise<void>
  /** 导出 {words, progress} JSON 字符串 */
  exportAll(): string
  /** 仅开发模式:用仓库自带词库进入演示,全程不触网;生产构建里为 undefined */
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

  // 推送发生在 async 回调里,必须读到「此刻」的状态,所以状态同时挂一份 ref
  const stateRef = useRef(state)
  const clientRef = useRef<SyncClient | null>(null)
  const demoRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pushingRef = useRef(false)           // progress 推送互斥
  const rerunRef = useRef(false)
  const wordsPushingRef = useRef(false)      // words 推送互斥
  const wordsRerunRef = useRef(false)
  const sessionRef = useRef(0)               // 登录/登出递增:飞行中的响应据此作废
  const bootedRef = useRef(false)

  const update = useCallback((patch: Partial<AppState>) => {
    stateRef.current = { ...stateRef.current, ...patch }
    setState(stateRef.current)
  }, [])

  const settleStatus = useCallback((): AppState['syncStatus'] => {
    if (demoRef.current) return 'synced'
    if (!navigator.onLine) return 'offline'
    return storage.get<boolean>('dirty') || pendingOps().length > 0 ? 'pending' : 'synced'
  }, [])

  /** 一次推送成功后的收尾:状态归位,并清掉上一次失败留下的说明 */
  const markSettled = useCallback(() => {
    update({ syncStatus: settleStatus(), syncError: null })
  }, [settleStatus, update])

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  /** 演示模式的词库每次都从仓库现读,不落盘,免得本地白留一份 500KB 的旧副本 */
  const cacheWords = useCallback((words: Word[]) => {
    if (!demoRef.current) storage.set('words', words)
  }, [])

  const toLogin = useCallback((loginError: string, clearToken: boolean) => {
    clearTimer()
    sessionRef.current += 1
    clientRef.current = null
    // 只清 token,owner 留着:重新登录时据此认出是同一个人,把没推上去的改动并回来
    if (clearToken) storage.remove('token')
    // syncError 一并清掉:上一条同步失败的说明在登录页已经无从处置,留着只会
    // 和这里真正的原因(loginError)在两个区域各说一句,读起来像出了两件事。
    update({ phase: 'login', loginError, owner: null, syncError: null })
  }, [clearTimer, update])

  /**
   * 推送失败的统一落点。只有 401(token 被撤销)才退回登录页;403 一律不退登
   * —— 限流是暂时的,为它清掉一个有效 token 是净损失,提示用户等一等即可。
   */
  const failSync = useCallback((error: string) => {
    const failure = classifySyncFailure(error)
    if (failure.kind === 'auth') { toLogin(failure.message, true); return }
    update({ syncStatus: navigator.onLine ? 'error' : 'offline', syncError: failure.message })
  }, [toLogin, update])

  // --- 推送 ---------------------------------------------------------------

  const flushProgress = useCallback(async (): Promise<void> => {
    clearTimer()
    const client = clientRef.current
    if (demoRef.current || !client) return
    if (!navigator.onLine) { update({ syncStatus: 'offline' }); return }
    if (!storage.get<boolean>('dirty')) { update({ syncStatus: settleStatus() }); return }
    // 已有一次在飞:让它跑完再补一轮,不要并发写同一个文件
    if (pushingRef.current) { rerunRef.current = true; return }

    pushingRef.current = true
    const session = sessionRef.current
    const alive = () => session === sessionRef.current
    try {
      for (;;) {
        rerunRef.current = false
        const out = await pushProgress(client, stateRef.current.progress, { alive })
        if (!alive()) return                      // 期间登出/换号,结果作废
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

  /** 词库改动不防抖,立即推。op 省略表示只重试队列里积压的改动。 */
  const flushWords = useCallback(async (op?: WordsOp): Promise<void> => {
    if (op) appendPendingOp(op)
    const client = clientRef.current
    if (demoRef.current || !client) { setPendingOps([]); return }
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

        const remaining = pendingOps().slice(sending.length)   // 推送途中新产生的改动
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

  /** 本地落盘 + 置脏 + 刷新状态;推送时机(防抖 / 立即)由调用方决定 */
  const commitProgress = useCallback((progress: Progress) => {
    storage.set('progress', progress)
    if (!demoRef.current) storage.set('dirty', true)   // 演示模式不欠远端任何东西
    update({ progress, syncStatus: settleStatus() })
  }, [settleStatus, update])

  // --- 会话 ---------------------------------------------------------------

  const enterDemoMode = useCallback(async (): Promise<void> => {
    // 整块包在 DEV 分支里:生产构建折成 if(false),词库的动态 import 连同分块一起被摇掉
    if (import.meta.env.DEV) {
      clearTimer()
      sessionRef.current += 1
      const session = sessionRef.current
      clientRef.current = null
      const words: Word[] = (await import('../../data/words.json')).default.words
      if (session !== sessionRef.current) return   // 期间真登录/登出了,别把演示数据盖上去
      demoRef.current = true
      setPendingOps([])
      const progress = cachedProgress() ?? emptyProgress()
      storage.set('owner', 'demo')       // 词库不进缓存:每次演示都从仓库现读,只留进度
      storage.set('progress', progress)
      update({
        phase: 'ready', owner: 'demo', words, progress,
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
        // 首次登录:远端还没有 progress.json,建一份空的推上去
        const put = await client.putFile(PROGRESS_PATH, serializeProgress(progress), 'init progress')
        progressSha = put === 'conflict' ? null : put.sha
      }
      if (session !== sessionRef.current) return

      // token 被撤销会把本机停在「有未推送改动」的状态,重新登录不能拿远端直接盖掉。
      // 同账号带走,换账号丢弃并报出丢的是谁 —— 判定在 session.ts 里,有测试盯着。
      const carry = carryOverFor(owner)
      if (carry.progress) progress = mergeProgress(carry.progress, progress)
      const words = applyWordOps(remoteWords, carry.ops)

      storage.set('token', token)
      storage.set('owner', owner)
      storage.set('words', words)
      storage.set('wordsSha', wf.sha)
      storage.set('progress', progress)
      if (progressSha) storage.set('progressSha', progressSha)
      else storage.remove('progressSha')
      storage.set('dirty', carry.progress !== null)   // 并回来的旧改动还欠远端一次推送
      setPendingOps(carry.ops)

      clientRef.current = client
      demoRef.current = false
      // 登录成功一定重写 syncError:要么换成「换账号丢弃了谁的改动」,要么清空。
      // 上一次退出留下的丢弃告知到此为止,两条不会叠在一起,也不会互相盖掉 ——
      // 后者只在这一刻产生,前者只活到下一次登录成功。
      update({
        phase: 'ready', owner, words, progress, loginError: null,
        syncError: carry.discardedOwner ? ownerSwitched(carry.discardedOwner) : null,
        syncStatus: settleStatus(),
      })
      if (carry.ops.length > 0) await flushWords()
      if (carry.progress) await flushProgress()
    } catch (e) {
      if (session !== sessionRef.current) return
      update({ phase: 'login', loginError: friendlyError(e) })
    }
  }, [flushProgress, flushWords, settleStatus, update])

  const logout = useCallback(() => {
    // 退出等于「把本机上这个账号的数据清干净」,没推上去的只能丢 —— 但要说一声
    const droppedOps = pendingOps().length
    const droppedProgress = storage.get<boolean>('dirty') === true
    clearTimer()
    sessionRef.current += 1
    clientRef.current = null
    demoRef.current = false
    pushingRef.current = false      // 万一有请求卡住不返回,别让互斥锁把下次登录后的推送也堵死
    wordsPushingRef.current = false
    storage.clearAll()
    // 「丢了什么」是一条数据告知,不是登录失败:走 syncError,由登录页的中性通知区
    // 展示。放 loginError 会让 token 输入框被标成 aria-invalid —— 那个框此刻没有
    // 任何问题,用户甚至还没开始填。没丢东西就写 null,顺带清掉退出前那次同步失败。
    update({
      phase: 'login', owner: null, words: [], progress: emptyProgress(), loginError: null,
      syncError: droppedOps > 0 || droppedProgress ? logoutDiscarded(droppedOps, droppedProgress) : null,
      syncStatus: navigator.onLine ? 'synced' : 'offline',
    })
  }, [clearTimer, update])

  // --- 启动 ---------------------------------------------------------------

  const boot = useCallback(async (): Promise<void> => {
    const token = storage.get<string>('token')
    const owner = storage.get<string>('owner')
    if (import.meta.env.DEV && !token && owner === 'demo') { await enterDemoMode(); return }
    if (!token || !owner) return   // 初始状态已经是 login

    const client = new GitHubClient(token, owner, DATA_REPO)
    clientRef.current = client
    const session = sessionRef.current
    try {
      const [wf, pf] = await Promise.all([client.getFile(WORDS_PATH), client.getFile(PROGRESS_PATH)])
      if (session !== sessionRef.current) return

      let words = stateRef.current.words
      if (wf) {
        // 词库以远端为准,但上次没推成功的增删要先重放上去,否则这份缓存一覆盖
        // 就把用户的编辑抹了 —— 队列是持久化的,关掉页面再回来也还在。
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
      storage.set('progress', progress)
      update({ phase: 'ready', owner, words, progress, loginError: null })

      if (pendingOps().length > 0) await flushWords()
      if (storage.get<boolean>('dirty')) await flushProgress()
      else update({ syncStatus: settleStatus() })
    } catch (e) {
      if (session !== sessionRef.current) return
      if (httpStatus(e) === 401) { toLogin(friendlyError(e), true); return }
      // 有本地缓存就照常用,只把同步状态标出来;没有缓存则退回登录页说明原因
      if (stateRef.current.phase === 'ready') {
        update({ syncStatus: navigator.onLine ? 'error' : 'offline', syncError: friendlyError(e) })
        return
      }
      toLogin(friendlyError(e), false)
    }
  }, [cacheWords, enterDemoMode, flushProgress, flushWords, settleStatus, toLogin, update])

  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    void boot()
  }, [boot])

  // --- 动作 ---------------------------------------------------------------

  const grade = useCallback((wordId: string, g: Grade) => {
    const now = new Date()
    const day = todayStr(now)
    const cur = stateRef.current.progress
    const prev = cur.words[wordId]
    const stat = { ...(cur.dailyStats[day] ?? emptyStat()) }
    stat.reviewed += 1
    // 没有记录、或还停在 new,都算今天新学的一个 —— 与 buildQueue 的新词判定一致
    if (!prev || prev.state === 'new') stat.newLearned += 1
    if (g !== 'again') stat.correct += 1
    commitProgress({
      ...cur,
      words: { ...cur.words, [wordId]: gradeWord(prev, g, now) },
      dailyStats: { ...cur.dailyStats, [day]: stat },
    })
    schedulePush()
  }, [commitProgress, schedulePush])

  // 得分不入库:错词已经通过提前到期反映到复习计划里,dailyStats 只记「今天测过一次」
  const recordQuiz = useCallback((_correct: number, _total: number, wrongIds: string[]) => {
    const now = new Date()
    const day = todayStr(now)
    const cur = stateRef.current.progress
    const stat = { ...(cur.dailyStats[day] ?? emptyStat()) }
    stat.quizTaken += 1
    const words = { ...cur.words }
    for (const id of wrongIds) {
      const e = words[id]
      if (e) words[id] = { ...e, due: day, lastReviewedAt: now.toISOString() }  // 只提前到期,ease/间隔不动
    }
    commitProgress({ ...cur, words, dailyStats: { ...cur.dailyStats, [day]: stat } })
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
    for (const id of ids) delete entries[id]   // 顺手清掉孤儿进度
    cacheWords(words)
    update({ words })
    commitProgress({ ...cur, words: entries })  // progress 走正常防抖
    schedulePush()
    await flushWords({ kind: 'delete', ids })
  }, [cacheWords, commitProgress, flushWords, schedulePush, update])

  const updateSettings = useCallback((s: Progress['settings']) => {
    commitProgress({ ...stateRef.current.progress, settings: s })
    schedulePush()
  }, [commitProgress, schedulePush])

  const syncNow = useCallback(async (): Promise<void> => {
    if (demoRef.current || !clientRef.current) return
    if (!navigator.onLine) { update({ syncStatus: 'offline' }); return }
    if (pendingOps().length > 0) await flushWords()
    await flushProgress()
  }, [flushProgress, flushWords, update])

  const exportAll = useCallback(
    () => JSON.stringify({ words: stateRef.current.words, progress: stateRef.current.progress }, null, 2),
    [],
  )

  // --- 网络与可见性 -------------------------------------------------------

  useEffect(() => {
    const onOnline = () => { update({ syncStatus: settleStatus() }); void syncNow() }
    const onOffline = () => update({ syncStatus: demoRef.current ? 'synced' : 'offline' })
    // 切后台/锁屏很可能就是这次会话的终点,有未推的改动就别等防抖了
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return
      if (storage.get<boolean>('dirty')) void flushProgress()
      if (pendingOps().length > 0) void flushWords()
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [flushProgress, flushWords, settleStatus, syncNow, update])

  useEffect(() => clearTimer, [clearTimer])   // 卸载时别把防抖定时器留下

  const value = useMemo<AppContextValue>(() => ({
    ...state,
    login, logout, grade, recordQuiz, saveWord, deleteWords, updateSettings, syncNow, exportAll,
    ...(import.meta.env.DEV ? { enterDemoMode } : {}),
  }), [
    state, login, logout, grade, recordQuiz, saveWord, deleteWords,
    updateSettings, syncNow, exportAll, enterDemoMode,
  ])

  return <AppContext value={value}>{children}</AppContext>
}

// 刻意和 AppProvider 同文件:页面只需要 `from '../state/store'` 一个入口。
// Fast Refresh 的告警在这里不成立 —— 全部状态都挂在 AppProvider 上,
// 改动本文件无论如何都要重挂一次。
// oxlint-disable-next-line react/only-export-components
export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp 必须在 <AppProvider> 之内使用')
  return ctx
}
