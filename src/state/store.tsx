import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { GitHubClient } from '../lib/github'
import { mergeProgress } from '../lib/merge'
import { gradeWord, todayStr } from '../lib/srs'
import { storage } from '../lib/storage'
import { emptyProgress, emptyStat } from '../types'
import type { Grade, Progress, Word } from '../types'
import {
  applyWordOps, parseProgress, parseWords, PROGRESS_PATH, pushProgress, pushWords,
  serializeProgress, WORDS_PATH,
} from './sync'
import type { SyncClient, WordsOp } from './sync'

/**
 * 全局状态 + 同步编排的 React 绑定。
 *
 * 真正的「推一次,冲突就合并重推一次」在 ./sync.ts,这里只负责:
 * 本地落盘、防抖时机、在线/可见性事件、以及把结果映射成页面能读的状态。
 */

const DATA_REPO = 'volcab-data'
const PUSH_DEBOUNCE_MS = 30_000

export interface AppState {
  phase: 'boot' | 'login' | 'ready'
  owner: string | null
  words: Word[]
  progress: Progress
  syncStatus: 'synced' | 'pending' | 'offline' | 'error'
  loginError: string | null
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

// --- 工具 -----------------------------------------------------------------

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * 从 github.ts 的报错文案里取回 HTTP 状态码,用来区分「token 失效」和「其它失败」。
 * 也吃 sync.ts 回传的 error 字符串。
 */
function httpStatus(e: unknown): number | null {
  const m = /HTTP (\d{3})/.exec(errText(e))
  return m ? Number(m[1]) : null
}

function friendlyError(e: unknown): string {
  if (!navigator.onLine) return '当前处于离线状态,连上网络后再试。'
  const status = httpStatus(e)
  if (status === 401) return '登录信息已失效或被撤销,请重新粘贴一个有效的 token。'
  if (status === 403) return 'GitHub 拒绝了请求:可能是 token 权限不足,也可能触发了速率限制,请稍后重试。'
  if (e instanceof TypeError) return '网络请求失败,请检查网络后重试。'
  return errText(e)
}

/** 本地缓存的 progress 形状不对就当没有,免得整个 App 因为一份坏缓存崩掉 */
function cachedProgress(): Progress | null {
  const p = storage.get<Progress>('progress')
  return p && p.version === 1 && !!p.words && !!p.dailyStats && !!p.settings ? p : null
}

function initialState(): AppState {
  const base: AppState = {
    phase: 'login', owner: null, words: [], progress: emptyProgress(),
    syncStatus: navigator.onLine ? 'synced' : 'offline', loginError: null,
  }
  const token = storage.get<string>('token')
  const owner = storage.get<string>('owner')

  // 开发演示模式没有 token,刷新后自动回到演示,免得每次调页面都要重新点一次
  if (import.meta.env.DEV && !token && owner === 'demo') return { ...base, phase: 'boot', owner }

  if (!token || !owner) return base
  const words = storage.get<Word[]>('words')
  const progress = cachedProgress()
  // 有完整缓存就立刻可用,远端放到后台拉
  if (words && progress) return { ...base, phase: 'ready', owner, words, progress }
  return { ...base, phase: 'boot', owner }
}

// --- Provider -------------------------------------------------------------

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState)

  // 推送发生在 async 回调里,必须读到「此刻」的状态,所以状态同时挂一份 ref
  const stateRef = useRef(state)
  const clientRef = useRef<SyncClient | null>(null)
  const demoRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pushingRef = useRef(false)           // progress 推送互斥
  const rerunRef = useRef(false)
  const wordsPushingRef = useRef(false)      // words 推送互斥
  const wordsRerunRef = useRef(false)
  const wordOpsRef = useRef<WordsOp[]>([])   // 尚未成功推上去的词库改动,冲突时用来重放
  const sessionRef = useRef(0)               // 登录/登出递增:飞行中的响应据此作废
  const bootedRef = useRef(false)

  const update = useCallback((patch: Partial<AppState>) => {
    stateRef.current = { ...stateRef.current, ...patch }
    setState(stateRef.current)
  }, [])

  const settleStatus = useCallback((): AppState['syncStatus'] => {
    if (demoRef.current) return 'synced'
    if (!navigator.onLine) return 'offline'
    return storage.get<boolean>('dirty') || wordOpsRef.current.length > 0 ? 'pending' : 'synced'
  }, [])

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
    // 只清 token,owner 留着:重新登录时据此认出是同一个人,把没推上去的进度合并回去
    if (clearToken) storage.remove('token')
    update({ phase: 'login', loginError, owner: null })
  }, [clearTimer, update])

  /** 推送失败的统一落点:token 被撤销就退回登录页说明原因,其余只标同步状态 */
  const failSync = useCallback((error: string) => {
    if (httpStatus(error) === 401) { toLogin(friendlyError(error), true); return }
    update({ syncStatus: navigator.onLine ? 'error' : 'offline' })
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
    try {
      for (;;) {
        rerunRef.current = false
        const out = await pushProgress(client, stateRef.current.progress)
        if (session !== sessionRef.current) return   // 期间登出/换号,结果作废
        if (!out.ok) { failSync(out.error); return }
        // 与远端合并过就采纳合并结果。再和「此刻」的本地合并一次:请求飞行途中
        // 用户可能又打了分,直接盖上去会把那一笔吞掉(本地新、远端旧,merge 取本地)。
        if (out.data !== stateRef.current.progress) {
          const next = mergeProgress(stateRef.current.progress, out.data)
          storage.set('progress', next)
          update({ progress: next })
        }
        update({ syncStatus: settleStatus() })
        if (!rerunRef.current || !storage.get<boolean>('dirty')) return
      }
    } finally {
      pushingRef.current = false
    }
  }, [clearTimer, failSync, settleStatus, update])

  const schedulePush = useCallback(() => {
    if (demoRef.current || !clientRef.current) return
    clearTimer()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void flushProgress()
    }, PUSH_DEBOUNCE_MS)
  }, [clearTimer, flushProgress])

  /** 词库改动不防抖,立即推。op 为空表示只重试队列里积压的改动。 */
  const flushWords = useCallback(async (op?: WordsOp): Promise<void> => {
    if (op) wordOpsRef.current = [...wordOpsRef.current, op]
    const client = clientRef.current
    if (demoRef.current || !client) { wordOpsRef.current = []; return }
    if (!navigator.onLine) { update({ syncStatus: 'offline' }); return }

    if (wordsPushingRef.current) { wordsRerunRef.current = true; return }

    wordsPushingRef.current = true
    const session = sessionRef.current
    try {
      for (;;) {
        wordsRerunRef.current = false
        const sent = wordOpsRef.current.length
        const out = await pushWords(client, stateRef.current.words, [...wordOpsRef.current])
        if (session !== sessionRef.current) return
        if (!out.ok) { failSync(out.error); return }

        const remaining = wordOpsRef.current.slice(sent)   // 推送途中新产生的改动
        wordOpsRef.current = remaining
        if (out.data !== stateRef.current.words) {
          // 采纳「远端 + 重放」的结果,再把飞行途中的改动补回去,否则会被这份旧快照盖掉
          const next = applyWordOps(out.data, remaining)
          cacheWords(next)
          update({ words: next })
        }
        update({ syncStatus: settleStatus() })
        if (!wordsRerunRef.current) return
      }
    } finally {
      wordsPushingRef.current = false
    }
  }, [cacheWords, failSync, settleStatus, update])

  /** 本地落盘 + 置脏 + 刷新状态;推送时机(防抖 / 立即)由调用方决定 */
  const commitProgress = useCallback((progress: Progress) => {
    storage.set('progress', progress)
    storage.set('dirty', true)
    update({ progress, syncStatus: settleStatus() })
  }, [settleStatus, update])

  // --- 会话 ---------------------------------------------------------------

  const enterDemoMode = useCallback(async (): Promise<void> => {
    // 整块包在 DEV 分支里:生产构建折成 if(false),词库的动态 import 连同分块一起被摇掉
    if (import.meta.env.DEV) {
      clearTimer()
      sessionRef.current += 1
      clientRef.current = null
      demoRef.current = true
      wordOpsRef.current = []
      const words: Word[] = (await import('../../data/words.json')).default.words
      const progress = cachedProgress() ?? emptyProgress()
      storage.set('owner', 'demo')       // 词库不进缓存:每次演示都从仓库现读,只留进度
      storage.set('progress', progress)
      update({ phase: 'ready', owner: 'demo', words, progress, loginError: null, syncStatus: 'synced' })
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
      const words = parseWords(wf.content)

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

      // token 被撤销时会把本地留在「有未推送改动」的状态,重新登录不能拿远端直接盖掉;
      // 认出是同一个账号才合并,换人登录一律以远端为准。
      const stale = storage.get<boolean>('dirty') && storage.get<string>('owner') === owner
        ? cachedProgress()
        : null
      if (stale) progress = mergeProgress(stale, progress)

      storage.set('token', token)
      storage.set('owner', owner)
      storage.set('words', words)
      storage.set('wordsSha', wf.sha)
      storage.set('progress', progress)
      if (progressSha) storage.set('progressSha', progressSha)
      else storage.remove('progressSha')
      storage.set('dirty', stale !== null)   // 合并进来的旧改动还欠远端一次推送

      clientRef.current = client
      demoRef.current = false
      wordOpsRef.current = []
      update({ phase: 'ready', owner, words, progress, loginError: null, syncStatus: settleStatus() })
      if (stale) await flushProgress()
    } catch (e) {
      if (session !== sessionRef.current) return
      update({ phase: 'login', loginError: friendlyError(e) })
    }
  }, [flushProgress, settleStatus, update])

  const logout = useCallback(() => {
    clearTimer()
    sessionRef.current += 1
    clientRef.current = null
    demoRef.current = false
    wordOpsRef.current = []
    pushingRef.current = false      // 万一有请求卡住不返回,别让互斥锁把下次登录后的推送也堵死
    wordsPushingRef.current = false
    storage.clearAll()
    update({
      phase: 'login', owner: null, words: [], progress: emptyProgress(),
      loginError: null, syncStatus: navigator.onLine ? 'synced' : 'offline',
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
        words = parseWords(wf.content)          // 词库以远端为准,直接覆盖缓存
        storage.set('words', words)
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

      if (storage.get<boolean>('dirty')) await flushProgress()
      else update({ syncStatus: settleStatus() })
    } catch (e) {
      if (session !== sessionRef.current) return
      if (httpStatus(e) === 401) { toLogin(friendlyError(e), true); return }
      // 有本地缓存就照常用,只把同步状态标出来;没有缓存则退回登录页说明原因
      if (stateRef.current.phase === 'ready') {
        update({ syncStatus: navigator.onLine ? 'error' : 'offline' })
        return
      }
      toLogin(friendlyError(e), false)
    }
  }, [enterDemoMode, flushProgress, settleStatus, toLogin, update])

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
    if (wordOpsRef.current.length > 0) await flushWords()
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
      if (document.visibilityState === 'hidden' && storage.get<boolean>('dirty')) void flushProgress()
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [flushProgress, settleStatus, syncNow, update])

  useEffect(() => clearTimer, [clearTimer])   // 卸载时别把防抖定时器留下

  const value: AppContextValue = {
    ...state,
    login, logout, grade, recordQuiz, saveWord, deleteWords, updateSettings, syncNow, exportAll,
    ...(import.meta.env.DEV ? { enterDemoMode } : {}),
  }
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
