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
 * store.tsx 的**同步编排**测试。
 *
 * 【关于「UI 本身不写组件测试」这条约定】
 * 计划里写的是「UI 本身不写组件测试」——逻辑测在纯函数文件里,界面写行为契约 +
 * 人工验收。**那条约定对页面和组件依然成立**,这里是一次经过明确授权、范围仅限
 * store.tsx 的例外。理由:这个文件里那一百多行不是「把状态接到界面上」,而是真正
 * 的数据安全逻辑——三条推送路径各自的互斥锁与补跑标志、会话作废检查、请求返回后
 * 与「此刻」本地状态的对账、状态收尾。sync.ts / session.ts / errors.ts 有 150+ 条
 * 测试盯着,把它们拼起来的这一层此前一条都没有,而拼错的代价是用户不可再生的复习
 * 记录。别拿这个文件当先例去给页面或组件补组件测试。
 *
 * 【手法】
 * 不引入 @testing-library:用 react-dom/client 把 Provider 渲进一个游离容器,
 * 再用一个探针子组件把 context 值捞出来,配合 React 19 自带的 act()。
 * 远端一律走**纯对象假 client**(照 sync.test.ts 的路子),不 mock 模块、不触网;
 * GitHubClient 的四个方法在 beforeEach 里改接到假 client,afterEach 原样还原。
 */

// React 的 act() 需要这个全局开关,否则会警告「不在 act 环境里」
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// --- 测试替身:远端 -------------------------------------------------------
// 与 sync.test.ts 同一套思路,多了「把一次 put 扣在半空」的能力 —— 互斥锁、
// 补跑标志、飞行途中改动这几件事,只有请求真的悬在那里才测得到。

type PutResult = { sha: string } | 'conflict'
interface PutCall { path: string; content: string; message: string; sha?: string }

function fakeRemote() {
  const putCalls: PutCall[] = []
  const getCalls: string[] = []
  const files: Record<string, { content: string; sha: string } | undefined> = {}
  const getThrows: Record<string, Error | undefined> = {}
  /** 按路径排队的预设 put 结果;用完了就返回一个自动生成的新 sha */
  const scripted: Record<string, (PutResult | Error)[] | undefined> = {}
  /** 这些路径上的 put 悬在半空,由测试用 settleNext 逐个放行 */
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
    /** 放行最早一个悬着的 put(可指定路径);不给结果就用预设/自动 sha */
    release(result?: PutResult | Error, path?: string) {
      const i = path ? held.findIndex(h => h.call.path === path) : 0
      const h = held[i]
      if (!h) throw new Error(`没有悬着的 put${path ? `(${path})` : ''}`)
      held.splice(i, 1)
      h.settle(result ?? nextResult(h.call.path))
    },
  }
}

type Remote = ReturnType<typeof fakeRemote>

// --- 测试替身:Provider 挂载 ----------------------------------------------

let ctx: AppContextValue | null = null

function Probe() {
  ctx = useApp()
  return null
}

let root: Root | null = null
let container: HTMLDivElement | null = null

/** 让 React 提交、并让已经落地的 Promise 链继续往下跑几步 */
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

/** 当前的 context 值。每次重新取 —— 状态字段会随重渲染换新对象。 */
function app(): AppContextValue {
  if (!ctx) throw new Error('Provider 还没挂上')
  return ctx
}

/** 触发一个动作并把随之而来的渲染/微任务跑完。异步动作请在回调里 void 掉。 */
async function step(fn: () => void): Promise<void> {
  await act(async () => { fn() })
  await flush()
}

/** 放行一个悬着的 put,并把它引发的后续跑完 */
async function release(result?: PutResult | Error, path?: string): Promise<void> {
  await act(async () => { remote.release(result, path) })
  await flush()
}

// --- 夹具 -----------------------------------------------------------------

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

/** 远端三个文件都在、本机有 token 的正常启动 */
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

// === 0. 先证明这套夹具真的能跑 =============================================

describe('夹具本身', () => {
  it('act() 确实把 effect 冲刷了 —— 挂载后 boot 已经跑完并落到 ready', async () => {
    await bootAsAlice()
    // boot 在 useEffect 里,还要等三个 await;这两条断言同时证明 effect 跑了、异步也追平了
    expect(app().phase).toBe('ready')
    expect(ids(app().words)).toEqual(['alpha', 'beta'])
    expect(storage.get('wordsSha')).toBe('w-remote')

    // 动作引起的重渲染也能看见
    await step(() => { app().updateSettings({ newPerDay: 42 }) })
    expect(app().progress.settings.newPerDay).toBe(42)
  })
})

// === 1. 互斥锁 + 补跑标志 ==================================================
// 第二次推送撞上飞行中的第一次,必须置补跑标志、由循环接手,而不是并发写同一
// 个文件。三条路径逐一验;progress / words 这两条从 Phase 3 起就没测过。

describe('flushProgress:互斥锁与补跑标志', () => {
  it('飞行途中再来一次推送不并发,而是等第一次落地后补跑一轮', async () => {
    await bootAsAlice()
    await step(() => { app().grade('alpha', 'good') })     // 置脏(防抖 30s,不会自己飞)
    remote.hold.add('progress.json')

    await step(() => { void app().syncNow() })
    expect(remote.putsTo('progress.json')).toHaveLength(1)  // 第一次在飞

    // 飞行途中做完一次测验:置脏 + 立即请求推送 —— 这一下只能置补跑标志
    await step(() => { app().recordQuiz(1, 1, []) })
    expect(remote.putsTo('progress.json')).toHaveLength(1)  // 互斥:没有第二个并发请求

    await release({ sha: 'p-1' })
    const puts = remote.putsTo('progress.json')
    expect(puts).toHaveLength(2)                            // 补跑标志被循环接住了
    expect(puts[1].sha).toBe('p-1')                         // 用的是上一次回来的 sha:确实是串行的

    const sent = JSON.parse(puts[1].content) as Progress
    expect(sent.dailyStats[today].quizTaken).toBe(1)        // 补跑带上了飞行途中那笔

    await release({ sha: 'p-2' })
    expect(remote.putsTo('progress.json')).toHaveLength(2)  // 补跑标志已清,不再无限循环
    expect(storage.get('progressSha')).toBe('p-2')
    expect(app().syncStatus).toBe('synced')
  })

  it('已经不脏了就直接收尾,不发请求', async () => {
    await bootAsAlice()
    await step(() => { void app().syncNow() })
    expect(remote.putsTo('progress.json')).toHaveLength(0)
    expect(app().syncStatus).toBe('synced')
  })
})

describe('flushWords:互斥锁与补跑标志', () => {
  it('飞行途中再编辑一个词:排队等下一轮,不并发写 words.json', async () => {
    await bootAsAlice()
    remote.hold.add('words.json')

    await step(() => { void app().saveWord(word('gamma')) })
    expect(remote.putsTo('words.json')).toHaveLength(1)
    expect(pendingOps()).toHaveLength(1)

    await step(() => { void app().saveWord(word('delta')) })
    expect(remote.putsTo('words.json')).toHaveLength(1)     // 互斥
    expect(pendingOps()).toHaveLength(2)                    // 但改动进了队列,没丢

    await release({ sha: 'w-1' })
    const puts = remote.putsTo('words.json')
    expect(puts).toHaveLength(2)                            // 补跑
    expect(puts[1].sha).toBe('w-1')                         // 串行:第二次带着第一次回来的 sha
    expect(pendingOps()).toHaveLength(1)                    // 只确认掉本次送出的那条
    expect(ids(JSON.parse(puts[1].content).words as Word[])).toContain('delta')

    await release({ sha: 'w-2' })
    expect(remote.putsTo('words.json')).toHaveLength(2)
    expect(pendingOps()).toEqual([])
    expect(storage.get('wordsSha')).toBe('w-2')
  })
})

describe('flushStaging:互斥锁与补跑标志', () => {
  it('飞行途中再收一个词:排队等下一轮,不并发写 staging.json', async () => {
    await bootAsAlice()
    remote.hold.add('staging.json')

    await step(() => { void app().addStaging('ostensible') })
    expect(remote.putsTo('staging.json')).toHaveLength(1)
    expect(pendingStaging()).toHaveLength(1)

    await step(() => { void app().addStaging('perfunctory') })
    expect(remote.putsTo('staging.json')).toHaveLength(1)   // 互斥
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

// === 2. 会话作废 ===========================================================
// 登出/换号之后才回来的响应必须整条作废:既不能往已经清空的 localStorage 里
// 写簿记,也不能把上一个账号的数据塞进当前界面。

describe('会话作废', () => {
  it('登出后才落地的 progress 推送:不回写簿记,也不把旧数据搬回界面', async () => {
    await bootAsAlice()
    await step(() => { app().grade('alpha', 'good') })
    remote.hold.add('progress.json')
    await step(() => { void app().syncNow() })
    expect(remote.putsTo('progress.json')).toHaveLength(1)

    await step(() => { app().logout() })
    expect(app().phase).toBe('login')

    await release({ sha: 'p-late' })
    expect(storage.get('progressSha')).toBeNull()          // 清空的 storage 不许被回填
    expect(storage.get('dirty')).toBeNull()
    expect(storage.get('progress')).toBeNull()
    expect(app().progress).toEqual(emptyProgress())        // 界面上不许冒出上一个账号的进度
    expect(app().phase).toBe('login')
    expect(remote.putsTo('progress.json')).toHaveLength(1)  // 也不会补跑
  })

  it('推送在飞时登出:必须告知进度被丢弃 —— dirty 提前清掉不等于已经同步', async () => {
    // pushProgress 在发请求「之前」就清掉 dirty(那是防止飞行途中的打分被吞掉的
    // 机制,是对的)。于是这段往返里 storage 的 dirty 是 false —— 但进度并没有
    // 送达。logout 若只看 dirty,就会认定「没什么可丢的」而一声不吭地清空本机,
    // 而这次复习既不在本地也不在远端。
    // wordOps / stagingOps 是「确认成功后」才清,所以它们数得对;dirty 是「发送前」
    // 清的,所以它数不对 —— 这个不对称就是缺陷本身。
    await bootAsAlice()
    await step(() => { app().grade('alpha', 'good') })
    remote.hold.add('progress.json')
    await step(() => { void app().syncNow() })
    expect(storage.get('dirty')).toBe(false)               // 确实已经被提前清掉
    expect(remote.putsTo('progress.json')).toHaveLength(1)  // 但请求还在飞

    await step(() => { app().logout() })
    expect(app().syncError).not.toBeNull()
    expect(app().syncError).toContain('未同步')

    // 而且这次推送最终失败了 —— 数据是真的没了,不是虚惊一场
    await release(new Error('HTTP 500'))
    expect(storage.get('progress')).toBeNull()
  })

  it('登出后才落地的 words 推送:队列与词库都不许被回写', async () => {
    await bootAsAlice()
    remote.hold.add('words.json')
    await step(() => { void app().saveWord(word('gamma')) })

    await step(() => { app().logout() })
    await release({ sha: 'w-late' })

    expect(storage.get('wordsSha')).toBeNull()
    expect(storage.get('words')).toBeNull()
    expect(app().words).toEqual([])
  })

  it('登出后才落地的 staging 推送:同样整条作废', async () => {
    await bootAsAlice()
    remote.hold.add('staging.json')
    await step(() => { void app().addStaging('ostensible') })

    await step(() => { app().logout() })
    await release({ sha: 's-late' })

    expect(storage.get('stagingSha')).toBeNull()
    expect(storage.get('staging')).toBeNull()
    expect(app().staging).toEqual([])
  })

  it('换账号登录后才落地的旧推送:不覆盖新账号刚写下的 sha 与进度', async () => {
    await bootAsAlice({ words: ['alpha'] })
    await step(() => { app().grade('alpha', 'good') })
    remote.hold.add('progress.json')
    await step(() => { void app().syncNow() })
    expect(remote.putsTo('progress.json')).toHaveLength(1)

    // 期间换成 bob 登录(bob 的仓库里是另一套文件)
    identity = async () => 'bob'
    remote.files['words.json'] = { content: wordsFile(['zeta']), sha: 'w-bob' }
    remote.files['progress.json'] = { content: JSON.stringify(emptyProgress()), sha: 'p-bob' }
    await act(async () => { await app().login('tok-bob') })
    await flush()

    expect(app().owner).toBe('bob')
    expect(storage.get('progressSha')).toBe('p-bob')
    // 注:这里**没有**断言 syncError 会报出「alice 的欠账被丢弃」。推送起飞前
    // dirty 就被清成 false 了,所以此刻 carryOverFor 看不到那笔欠账 —— 这是一个
    // 已发现的产品缺口,不在本次改动范围内(见交付报告),故不在此固化任何一边。

    await release({ sha: 'p-alice-late' })
    expect(storage.get('progressSha')).toBe('p-bob')        // 迟到的响应作废
    expect(app().progress.words['alpha']).toBeUndefined()   // alice 的复习记录没混进 bob 的视图
    expect(ids(app().words)).toEqual(['zeta'])
  })
})

// === 3. 飞行途中的改动不许被吞 =============================================
// 这是整个 App 最严重的失败模式:推送发出时拍的快照回来后直接盖回本地,把
// 请求飞行途中用户做的事抹掉。对账那一步就是唯一的防线。

describe('推送返回后的对账', () => {
  it('progress 在飞时又打了一次分:那一笔必须活下来', async () => {
    await bootAsAlice()
    await step(() => { app().grade('alpha', 'good') })
    remote.hold.add('progress.json')
    await step(() => { void app().syncNow() })

    await step(() => { app().grade('beta', 'good') })       // 请求还在飞
    await release({ sha: 'p-1' })

    expect(app().progress.words['beta']).toBeDefined()      // 飞行途中那一笔没被旧快照盖掉
    expect(app().progress.words['alpha']).toBeDefined()
    expect(app().progress.dailyStats[today].reviewed).toBe(2)
    const saved = storage.get<Progress>('progress')
    expect(saved?.words['beta']).toBeDefined()              // 落盘的也是对账后的那份
    expect(app().syncStatus).toBe('pending')                // 它还欠远端一次推送
  })

  it('words 在飞时又编辑了一个词:那一条必须活下来', async () => {
    await bootAsAlice()
    remote.hold.add('words.json')
    await step(() => { void app().saveWord(word('gamma')) })
    await step(() => { void app().saveWord(word('delta')) })  // 请求还在飞

    await release({ sha: 'w-1' })
    expect(ids(app().words)).toEqual(['alpha', 'beta', 'gamma', 'delta'])
    expect(ids(storage.get<Word[]>('words') ?? [])).toContain('delta')
    // 补跑那一轮送出去的也必须带着它,否则下次启动就被远端覆盖没了
    expect(ids(JSON.parse(remote.putsTo('words.json')[1].content).words as Word[])).toContain('delta')
  })

  it('staging 在飞时又收了一个词:那一条必须活下来', async () => {
    await bootAsAlice()
    remote.hold.add('staging.json')
    await step(() => { void app().addStaging('ostensible') })
    await step(() => { void app().addStaging('perfunctory') })  // 请求还在飞

    await release({ sha: 's-1' })
    expect(heads(app().staging).sort()).toEqual(['ostensible', 'perfunctory'])
    expect(heads(storage.get<StagingItem[]>('staging') ?? [])).toContain('perfunctory')
  })

  it('words 推送遇冲突:他端的词与飞行途中的编辑都要留下', async () => {
    await bootAsAlice({ words: ['alpha'] })
    remote.hold.add('words.json')
    await step(() => { void app().saveWord(word('gamma')) })

    // 飞行途中本机又加了一个,同时远端被他端加了 omega
    await step(() => { void app().saveWord(word('delta')) })
    remote.files['words.json'] = { content: wordsFile(['alpha', 'omega']), sha: 'w-other' }

    await release('conflict')                               // 第一次 put 冲突,重新拉远端再推
    await release({ sha: 'w-merged' })                      // 冲突重推落地

    expect(ids(app().words).sort()).toEqual(['alpha', 'delta', 'gamma', 'omega'])
  })
})

// === 4. 三文件启动 =========================================================

describe('启动:三个文件', () => {
  it('三个文件都读,读到的都进状态', async () => {
    await bootAsAlice({ staging: [item('ostensible')] })
    expect(remote.getCalls.sort()).toEqual(['progress.json', 'staging.json', 'words.json'])
    expect(app().phase).toBe('ready')
    expect(heads(app().staging)).toEqual(['ostensible'])
    expect(storage.get('stagingSha')).toBe('s-remote')
  })

  it('远端还没有 staging.json:照常进 ready,不拿本地那份去创建它', async () => {
    await bootAsAlice()                                     // 没放 staging.json
    expect(app().phase).toBe('ready')
    expect(ids(app().words)).toEqual(['alpha', 'beta'])
    expect(app().staging).toEqual([])
    expect(storage.get('stagingSha')).toBeNull()
    expect(remote.putCalls).toEqual([])
  })

  it('staging.json 坏了:当作没有,绝不能拖累 words / progress', async () => {
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
    expect(storage.get('stagingSha')).toBeNull()            // 坏文件的 sha 不许留下
    expect(app().syncStatus).toBe('synced')
  })

  it('staging.json 读取本身报错:同样不许把启动路径拖进 catch', async () => {
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

  it('words.json 坏了、本机没有缓存:退回登录页说明原因,但不清 token、不推任何东西', async () => {
    storage.set('token', 'tok-alice')
    storage.set('owner', 'alice')
    remote.files['words.json'] = { content: '{"version":1,"words":[{"id":"x"}]}', sha: 'w-bad' }
    remote.files['progress.json'] = { content: JSON.stringify(emptyProgress()), sha: 'p-remote' }
    await mount()

    expect(app().phase).toBe('login')
    expect(app().loginError).toContain('备份')
    expect(storage.get('token')).toBe('tok-alice')          // 远端坏文件不该毁掉一个有效凭据
    expect(remote.putCalls).toEqual([])                     // 更不该拿本地那份去覆盖远端
  })

  it('words.json 坏了、本机有缓存:留在 ready 用缓存,只标同步失败,仍不覆盖远端', async () => {
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

  it('progress.json 坏了:拒绝覆盖远端,token 与本机数据都留着', async () => {
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

// === 5. settleStatus 不许说谎 ==============================================

describe('settleStatus', () => {
  it('收词推送失败后,一次成功的 progress 推送不能把状态粉饰成「已同步」', async () => {
    await bootAsAlice()
    remote.scripted['staging.json'] = [new Error('写入 staging.json 失败 (HTTP 500)')]

    await step(() => { void app().addStaging('ostensible') })
    expect(app().syncStatus).toBe('error')
    expect(pendingStaging()).toHaveLength(1)                // 队列留着,等下次重试

    // 之后 progress 推送成功 —— 它会把上一条失败提示清掉
    await step(() => { app().recordQuiz(1, 1, []) })
    expect(remote.putsTo('progress.json')).toHaveLength(1)
    expect(app().syncError).toBeNull()

    expect(pendingStaging()).toHaveLength(1)                // 还欠着远端一个文件
    expect(app().syncStatus).toBe('pending')                // 所以不能是 synced
  })

  it('词库队列非空时同理', async () => {
    await bootAsAlice()
    remote.scripted['words.json'] = [new Error('写入 words.json 失败 (HTTP 500)')]
    await step(() => { void app().saveWord(word('gamma')) })
    expect(pendingOps()).toHaveLength(1)

    await step(() => { app().recordQuiz(1, 1, []) })
    expect(app().syncStatus).toBe('pending')
  })
})

// === 6. 401 与 403 =========================================================

describe('推送失败的处置:401 退登、403 不退登', () => {
  it('401:退回登录页并清 token,但 owner 与未推送的改动都留着等重新登录', async () => {
    await bootAsAlice()
    remote.scripted['words.json'] = [new Error('写入 words.json 失败 (HTTP 401)')]

    await step(() => { void app().saveWord(word('gamma')) })

    expect(app().phase).toBe('login')
    expect(app().loginError).toBe(TOKEN_REVOKED)
    expect(app().owner).toBeNull()
    expect(app().syncError).toBeNull()                      // 登录页只说一件事
    expect(storage.get('token')).toBeNull()
    expect(storage.get('owner')).toBe('alice')              // 靠它认出是同一个人
    expect(pendingOps()).toHaveLength(1)                    // 那条编辑没丢
  })

  it('401 之后没有 client 了:再改词只进队列,绝不清空队列', async () => {
    await bootAsAlice()
    remote.scripted['words.json'] = [new Error('写入 words.json 失败 (HTTP 401)')]
    await step(() => { void app().saveWord(word('gamma')) })
    expect(pendingOps()).toHaveLength(1)

    await step(() => { void app().saveWord(word('delta')) })
    expect(pendingOps()).toHaveLength(2)                    // 排队等重新登录后重放
    expect(remote.putsTo('words.json')).toHaveLength(1)     // 没有再去打远端
  })

  it('403 限流:不退登、不清 token,给一句能照做的提示', async () => {
    await bootAsAlice()
    remote.scripted['progress.json'] = [new Error('写入 progress.json 失败 (HTTP 403, rate-limited)')]

    await step(() => { app().grade('alpha', 'good') })
    await step(() => { void app().syncNow() })

    expect(app().phase).toBe('ready')
    expect(storage.get('token')).toBe('tok-alice')          // 限流绝不能毁掉一个有效凭据
    expect(app().syncStatus).toBe('error')
    expect(app().syncError).toBe(RATE_LIMITED)
    expect(app().loginError).toBeNull()
    expect(storage.get('dirty')).toBe(true)                 // 改动留在本地等重试
  })

  it('403 权限不足:同样不退登,提示改成「去重新授权」', async () => {
    await bootAsAlice()
    remote.scripted['progress.json'] = [new Error('写入 progress.json 失败 (HTTP 403)')]

    await step(() => { app().grade('alpha', 'good') })
    await step(() => { void app().syncNow() })

    expect(app().phase).toBe('ready')
    expect(storage.get('token')).toBe('tok-alice')
    expect(app().syncError).toBe(FORBIDDEN)
  })
})

// === 7. 退出时的丢弃告知 ===================================================

describe('logout', () => {
  it('有未同步数据:逐项报出丢了什么,且走 syncError 而不是 loginError', async () => {
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
    expect(app().loginError).toBeNull()                     // token 输入框此刻没有任何问题
    expect(app().phase).toBe('login')
    expect(storage.get('token')).toBeNull()
    expect(storage.get('owner')).toBeNull()
    expect(pendingOps()).toEqual([])
  })

  it('没有欠账:安静退出,不编造一条告知', async () => {
    await bootAsAlice()
    await step(() => { app().logout() })
    expect(app().syncError).toBeNull()
    expect(app().loginError).toBeNull()
    expect(app().syncStatus).toBe('synced')
  })
})

// === 8. 登录时的欠账重放 ===================================================
// token 被撤销会把本机停在「有未推送改动」的状态。重新登录这一刻的编排:同账号
// 三个队列依次重放,换账号一律丢弃且一条都不许推进新账号的仓库。

describe('登录:本机欠账的处置', () => {
  function seedUnsyncedAliceWork() {
    const p = emptyProgress()
    p.words['alpha'] = {
      state: 'review', ease: 2.5, intervalDays: 3, due: '2026-07-30',
      stepIndex: 0, reps: 4, lapses: 0, lastReviewedAt: '2026-07-25T01:00:00Z',
    }
    storage.set('owner', 'alice')                 // token 已被撤销,owner 留着
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

  it('同一个账号重新登录:词库、暂存区、进度依次补推,队列清空', async () => {
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
    expect(app().progress.words['alpha'].reps).toBe(4)      // 撤销前的复习记录并回来了
    expect(pendingOps()).toEqual([])
    expect(pendingStaging()).toEqual([])
    expect(storage.get('dirty')).toBe(false)
    expect(app().syncStatus).toBe('synced')
  })

  it('换一个账号登录:欠账全部丢弃、报出丢的是谁,一条都不推进新账号的仓库', async () => {
    seedUnsyncedAliceWork()
    await mount()

    identity = async () => 'bob'
    remote.files['words.json'] = { content: wordsFile(['zeta']), sha: 'w-bob' }
    await act(async () => { await app().login('tok-bob') })
    await flush()

    expect(remote.putCalls).toEqual([])                     // alice 的改动没被写进 bob 的仓库
    expect(app().owner).toBe('bob')
    expect(app().syncError).toBe(ownerSwitched('alice'))
    expect(ids(app().words)).toEqual(['zeta'])
    expect(app().progress.words['alpha']).toBeUndefined()
    expect(pendingOps()).toEqual([])
    expect(pendingStaging()).toEqual([])
    expect(storage.get('dirty')).toBe(false)
  })

  it('首次登录、远端还没有 progress.json:建一份空的,不碰 staging.json', async () => {
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

// === 极速赛结算 =============================================================
// recordSprint 与 recordQuiz 共用「错词只提前到期、ease/间隔不动」这条约定,
// 多的只有最好成绩。纪录的刷新条件必须与 merge.ts 的「同分取日期早的」一致 ——
// 两处不一致时,同步一来一回会把日期反复改写。

describe('recordSprint:最好成绩', () => {
  it('第一次就是纪录,并把错词提前到今天、不动 ease 与间隔', async () => {
    await bootAsAlice()
    // 先 easy 一次让它毕业到 review、到期日排到几天后 —— 否则 due 本来就是今天,
    // 「提前到期」这条断言不成立(它会在任何实现下都通过)。
    await step(() => { app().grade('alpha', 'easy') })
    const before = app().progress.words['alpha']
    expect(before.due > today).toBe(true)

    await step(() => { app().recordSprint(12, ['alpha']) })

    expect(app().progress.bestSprint).toEqual({ score: 12, date: today })
    expect(app().progress.dailyStats[today].quizTaken).toBe(1)
    const after = app().progress.words['alpha']
    expect(after.due).toBe(today)
    expect(after.ease).toBe(before.ease)               // 打分逻辑一律不碰
    expect(after.intervalDays).toBe(before.intervalDays)
    expect(after.lapses).toBe(before.lapses)
  })

  it('分数更高才刷新纪录', async () => {
    await bootAsAlice()
    await step(() => { app().recordSprint(12, []) })
    await step(() => { app().recordSprint(20, []) })
    expect(app().progress.bestSprint).toEqual({ score: 20, date: today })
  })

  it('分数更低不动纪录', async () => {
    await bootAsAlice()
    await step(() => { app().recordSprint(20, []) })
    await step(() => { app().recordSprint(5, []) })
    expect(app().progress.bestSprint).toEqual({ score: 20, date: today })
  })

  it('打平不刷新 —— 否则纪录日期会被后来的平局改写,与 merge 的「同分取早」打架', async () => {
    await bootAsAlice()
    await step(() => { app().recordSprint(20, []) })
    const first = app().progress.bestSprint
    await step(() => { app().recordSprint(20, []) })
    expect(app().progress.bestSprint).toBe(first)      // 同一个对象,压根没重建
  })

  it('结算立即推送,不等 30 秒防抖', async () => {
    await bootAsAlice()
    await step(() => { app().recordSprint(7, []) })
    const puts = remote.putsTo('progress.json')
    expect(puts.length).toBeGreaterThan(0)
    const sent = JSON.parse(puts[puts.length - 1].content) as Progress
    expect(sent.bestSprint).toEqual({ score: 7, date: today })
  })
})
