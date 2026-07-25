import { beforeEach, describe, expect, it } from 'vitest'
import { applyWordOps, parseProgress, parseWords, pushProgress, pushWords } from './sync'
import type { SyncClient, WordsOp } from './sync'
import { emptyProgress } from '../types'
import type { Progress, ProgressEntry, Word } from '../types'
import { storage } from '../lib/storage'

// --- 测试替身 -------------------------------------------------------------
// 纯对象假 client:不发 HTTP、不 mock 模块,按脚本依次返回 putFile 的结果。

type PutResult = { sha: string } | 'conflict' | Error
interface PutCall { path: string; content: string; message: string; sha?: string }

function fakeClient(script: {
  puts: PutResult[]
  files?: Record<string, { content: string; sha: string }>
  getThrows?: Error
}) {
  const putCalls: PutCall[] = []
  const getCalls: string[] = []
  let i = 0
  const client: SyncClient = {
    async getFile(path) {
      getCalls.push(path)
      if (script.getThrows) throw script.getThrows
      return script.files?.[path] ?? null
    },
    async putFile(path, content, message, sha) {
      putCalls.push({ path, content, message, sha })
      const r = script.puts[i++]
      if (r === undefined) throw new Error(`超出脚本:第 ${i} 次 putFile 无预期结果`)
      if (r instanceof Error) throw r
      return r
    },
  }
  return { client, putCalls, getCalls }
}

const entry = (lastReviewedAt: string, reps: number): ProgressEntry => ({
  state: 'review', ease: 2.5, intervalDays: 3, due: '2026-07-30',
  stepIndex: 0, reps, lapses: 0, lastReviewedAt,
})

const word = (id: string): Word => ({
  id, headword: id, phonetic: `/${id}/`,
  meanings: [{ pos: 'n.', en: id, zh: id }],
  examples: [], synonyms: [], antonyms: [], collocations: [], relatedForms: [],
  sourceNote: 'manual', addedAt: '2026-07-25',
})

const wordsFile = (ids: string[]) => JSON.stringify({ version: 1, words: ids.map(word) })
const lastPut = (calls: PutCall[]) => calls[calls.length - 1]

beforeEach(() => {
  localStorage.clear()
})

// --- progress 推送 --------------------------------------------------------

describe('pushProgress', () => {
  it('成功:带上本地 sha 推送,回写新 sha 并清掉 dirty', async () => {
    storage.set('progressSha', 'sha-old')
    storage.set('dirty', true)
    const local = emptyProgress()
    local.words['a'] = entry('2026-07-25T01:00:00Z', 1)

    const { client, putCalls, getCalls } = fakeClient({ puts: [{ sha: 'sha-new' }] })
    const out = await pushProgress(client, local)

    expect(out).toEqual({ ok: true, sha: 'sha-new', data: local })
    expect(putCalls).toHaveLength(1)
    expect(getCalls).toHaveLength(0)
    expect(putCalls[0].path).toBe('progress.json')
    expect(putCalls[0].sha).toBe('sha-old')
    expect(JSON.parse(putCalls[0].content).words['a'].reps).toBe(1)
    expect(storage.get('progressSha')).toBe('sha-new')
    expect(storage.get('dirty')).toBe(false)
  })

  it('首次推送(本地无 sha):不带 sha', async () => {
    const { client, putCalls } = fakeClient({ puts: [{ sha: 'sha-1' }] })
    await pushProgress(client, emptyProgress())
    expect(putCalls[0].sha).toBeUndefined()
  })

  it('冲突:拉回远端合并后重推,两端记录都保留', async () => {
    storage.set('progressSha', 'sha-stale')
    const local = emptyProgress()
    local.words['a'] = entry('2026-07-25T01:00:00Z', 5)
    local.dailyStats['2026-07-25'] = { reviewed: 4, newLearned: 1, correct: 3, quizTaken: 0 }

    const remote = emptyProgress()
    remote.words['a'] = entry('2026-07-24T01:00:00Z', 4)  // 更旧,应被本地覆盖
    remote.words['b'] = entry('2026-07-25T02:00:00Z', 9)  // 他端独有,必须保住
    remote.dailyStats['2026-07-25'] = { reviewed: 2, newLearned: 0, correct: 2, quizTaken: 1 }

    const { client, putCalls, getCalls } = fakeClient({
      puts: ['conflict', { sha: 'sha-merged' }],
      files: { 'progress.json': { content: JSON.stringify(remote), sha: 'sha-remote' } },
    })
    const out = await pushProgress(client, local)

    expect(out.ok).toBe(true)
    expect(getCalls).toEqual(['progress.json'])
    expect(putCalls).toHaveLength(2)
    expect(putCalls[1].sha).toBe('sha-remote')   // 用远端最新 sha 重推

    const sent = JSON.parse(lastPut(putCalls).content) as Progress
    expect(sent.words['a'].reps).toBe(5)         // 本地较新,胜出
    expect(sent.words['b'].reps).toBe(9)         // 他端的复习记录没被吞掉
    expect(sent.dailyStats['2026-07-25'].quizTaken).toBe(1)
    expect(sent.dailyStats['2026-07-25'].reviewed).toBe(4)

    if (out.ok) expect(out.data.words['b'].reps).toBe(9)  // 合并结果回传给调用方
    expect(storage.get('progressSha')).toBe('sha-merged')
    expect(storage.get('dirty')).toBe(false)
  })

  it('连续两次冲突:只重试一次就放弃,置错并保留 dirty', async () => {
    const { client, putCalls, getCalls } = fakeClient({
      puts: ['conflict', 'conflict'],
      files: { 'progress.json': { content: JSON.stringify(emptyProgress()), sha: 'sha-remote' } },
    })
    const out = await pushProgress(client, emptyProgress())

    expect(out.ok).toBe(false)
    expect(putCalls).toHaveLength(2)   // 恰好一次重试,不再继续
    expect(getCalls).toHaveLength(1)
    expect(storage.get('dirty')).toBe(true)
  })

  it('网络异常:不重试,标脏留待下次,本地数据不动', async () => {
    storage.set('progressSha', 'sha-old')
    const local = emptyProgress()
    local.words['a'] = entry('2026-07-25T01:00:00Z', 5)
    const snapshot = structuredClone(local)

    const { client, putCalls, getCalls } = fakeClient({ puts: [new TypeError('Failed to fetch')] })
    const out = await pushProgress(client, local)

    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain('Failed to fetch')
    expect(putCalls).toHaveLength(1)
    expect(getCalls).toHaveLength(0)
    expect(local).toEqual(snapshot)
    expect(storage.get('progressSha')).toBe('sha-old')  // sha 不动
    expect(storage.get('dirty')).toBe(true)
  })

  it('远端 progress.json 解析不了:拒绝覆盖,不发第二次 put', async () => {
    const { client, putCalls } = fakeClient({
      puts: ['conflict', { sha: 'never' }],
      files: { 'progress.json': { content: '{"version":1,"words":', sha: 'sha-remote' } },
    })
    const out = await pushProgress(client, emptyProgress())

    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain('备份')
    expect(putCalls).toHaveLength(1)   // 第二次 put 没有发生
    expect(storage.get('dirty')).toBe(true)
  })

  it('推送期间又改了本地:成功也不清 dirty', async () => {
    storage.set('dirty', true)
    let resolvePut: (r: { sha: string }) => void = () => {}
    const client: SyncClient = {
      async getFile() { return null },
      putFile: () => new Promise(res => { resolvePut = res }),
    }
    const pending = pushProgress(client, emptyProgress())
    storage.set('dirty', true)          // 用户在请求飞行途中又打了一次分
    resolvePut({ sha: 'sha-new' })
    await pending

    expect(storage.get('dirty')).toBe(true)
  })
})

// --- words 推送 -----------------------------------------------------------

describe('pushWords', () => {
  it('成功:整份词库覆盖写,回写 wordsSha', async () => {
    storage.set('wordsSha', 'w-old')
    const local = [word('alpha'), word('beta')]
    const { client, putCalls } = fakeClient({ puts: [{ sha: 'w-new' }] })

    const out = await pushWords(client, local, [{ kind: 'upsert', word: word('beta') }])

    expect(out).toEqual({ ok: true, sha: 'w-new', data: local })
    expect(putCalls[0].path).toBe('words.json')
    expect(putCalls[0].sha).toBe('w-old')
    expect(JSON.parse(putCalls[0].content).version).toBe(1)
    expect(storage.get('wordsSha')).toBe('w-new')
  })

  it('冲突:在重新拉取的远端副本上重放本次新增,他端的词条全部保留', async () => {
    const mine = word('zeta')
    const local = [word('alpha'), mine]                       // 本地视图:落后一个 gamma
    const remoteIds = ['alpha', 'gamma']                       // 他端并发加了 gamma

    const { client, putCalls, getCalls } = fakeClient({
      puts: ['conflict', { sha: 'w-merged' }],
      files: { 'words.json': { content: wordsFile(remoteIds), sha: 'w-remote' } },
    })
    const out = await pushWords(client, local, [{ kind: 'upsert', word: mine }])

    expect(out.ok).toBe(true)
    expect(getCalls).toEqual(['words.json'])
    expect(putCalls).toHaveLength(2)
    expect(putCalls[1].sha).toBe('w-remote')

    const sent = JSON.parse(lastPut(putCalls).content) as { words: Word[] }
    expect(sent.words.map(w => w.id).sort()).toEqual(['alpha', 'gamma', 'zeta'])
    if (out.ok) expect(out.data.map(w => w.id).sort()).toEqual(['alpha', 'gamma', 'zeta'])
  })

  it('冲突:重放本次删除,只抹掉该删的,他端新增仍在', async () => {
    const local = [word('alpha')]                              // 本地刚删掉 beta
    const { client, putCalls } = fakeClient({
      puts: ['conflict', { sha: 'w-merged' }],
      files: { 'words.json': { content: wordsFile(['alpha', 'beta', 'gamma']), sha: 'w-remote' } },
    })

    const out = await pushWords(client, local, [{ kind: 'delete', ids: ['beta'] }])

    expect(out.ok).toBe(true)
    const sent = JSON.parse(lastPut(putCalls).content) as { words: Word[] }
    expect(sent.words.map(w => w.id).sort()).toEqual(['alpha', 'gamma'])
  })

  it('连续两次冲突:一次重试后放弃', async () => {
    const { client, putCalls } = fakeClient({
      puts: ['conflict', 'conflict'],
      files: { 'words.json': { content: wordsFile(['alpha']), sha: 'w-remote' } },
    })
    const out = await pushWords(client, [word('alpha')], [])
    expect(out.ok).toBe(false)
    expect(putCalls).toHaveLength(2)
  })

  it('远端 words.json 解析不了:拒绝覆盖', async () => {
    storage.set('wordsSha', 'w-old')
    const { client, putCalls } = fakeClient({
      puts: ['conflict', { sha: 'never' }],
      files: { 'words.json': { content: '[]', sha: 'w-remote' } },
    })
    const out = await pushWords(client, [word('alpha')], [])

    expect(out.ok).toBe(false)
    expect(putCalls).toHaveLength(1)
    expect(storage.get('wordsSha')).toBe('w-old')
  })

  it('网络异常:错误上报,sha 不动', async () => {
    storage.set('wordsSha', 'w-old')
    const { client } = fakeClient({ puts: [new TypeError('Failed to fetch')] })
    const out = await pushWords(client, [word('alpha')], [])
    expect(out.ok).toBe(false)
    expect(storage.get('wordsSha')).toBe('w-old')
  })
})

// --- 纯函数 ---------------------------------------------------------------

describe('applyWordOps', () => {
  it('upsert 同 id 覆盖、异 id 追加,顺序稳定', () => {
    const base = [word('a'), word('b')]
    const edited: Word = { ...word('b'), headword: 'B!' }
    const ops: WordsOp[] = [{ kind: 'upsert', word: edited }, { kind: 'upsert', word: word('c') }]
    const out = applyWordOps(base, ops)
    expect(out.map(w => w.id)).toEqual(['a', 'b', 'c'])
    expect(out[1].headword).toBe('B!')
    expect(base.map(w => w.headword)).toEqual(['a', 'b'])  // 输入不被改写
  })

  it('delete 移除多个 id,不存在的 id 无副作用', () => {
    const out = applyWordOps([word('a'), word('b'), word('c')], [{ kind: 'delete', ids: ['b', 'zzz'] }])
    expect(out.map(w => w.id)).toEqual(['a', 'c'])
  })
})

describe('parse 守卫', () => {
  it('parseProgress 接受合法文件', () => {
    const p = emptyProgress()
    p.settings.newPerDay = 20
    expect(parseProgress(JSON.stringify(p)).settings.newPerDay).toBe(20)
  })
  it.each([
    ['非 JSON', '{oops'],
    ['版本不对', '{"version":2,"settings":{"newPerDay":10},"words":{},"dailyStats":{}}'],
    ['缺字段', '{"version":1,"words":{}}'],
    ['是数组', '[]'],
  ])('parseProgress 拒绝%s', (_label, text) => {
    expect(() => parseProgress(text)).toThrow()
  })

  it('parseWords 接受合法文件', () => {
    expect(parseWords(wordsFile(['a', 'b'])).map(w => w.id)).toEqual(['a', 'b'])
  })
  it.each([
    ['非 JSON', '{oops'],
    ['顶层是数组', '[]'],
    ['words 不是数组', '{"version":1,"words":{}}'],
    ['词条缺 id', '{"version":1,"words":[{"headword":"x"}]}'],
  ])('parseWords 拒绝%s', (_label, text) => {
    expect(() => parseWords(text)).toThrow()
  })
})
