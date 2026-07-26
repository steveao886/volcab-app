import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyWordOps, loadStaging, mergeStaging, normalizeHeadword, parseProgress, parseStaging,
  parseWords, pushProgress, pushStaging, pushWords,
  reconcileProgress, reconcileStaging, reconcileWords, serializeStaging,
} from './sync'
import type { SyncClient, WordsOp } from './sync'
import { emptyProgress } from '../types'
import type { Progress, ProgressEntry, StagingItem, Word } from '../types'
import { storage } from '../lib/storage'
import realLibrary from '../../data/words.json'

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

const item = (headword: string, addedAt = '2026-07-25'): StagingItem => ({ headword, addedAt })
const stagingFile = (items: StagingItem[]) => JSON.stringify({ version: 1, items })
const sentStaging = (calls: PutCall[]) => (JSON.parse(lastPut(calls).content) as { items: StagingItem[] }).items

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

describe('会话已结束时的回写', () => {
  it('登出后才返回的推送不再回写任何簿记', async () => {
    storage.set('progressSha', 'sha-old')
    const { client } = fakeClient({ puts: [{ sha: 'sha-new' }] })
    const out = await pushProgress(client, emptyProgress(), { alive: () => false })

    expect(out.ok).toBe(true)          // 请求本身是成功的
    expect(storage.get('progressSha')).toBe('sha-old')   // 但本机已经换人了,不留痕
  })

  it('登出后失败的推送也不把 dirty 写回来', async () => {
    const { client } = fakeClient({ puts: [new TypeError('Failed to fetch')] })
    await pushProgress(client, emptyProgress(), { alive: () => false })
    expect(storage.get('dirty')).toBeNull()
  })
})

// --- 推送返回后与「此刻」本地状态的对账 -----------------------------------
// 这是「飞行途中又打了一次分」不被吞掉的唯一机制,单独抽出来保证它不会被
// 当成 sync 内部合并的冗余而删掉。

describe('reconcileProgress', () => {
  it('推送期间本地没动过:原样返回,不产生新对象', () => {
    const current = emptyProgress()
    expect(reconcileProgress(current, current)).toBe(current)
  })

  it('推送期间又打了一次分:那一笔必须活下来,同时保住远端合并进来的词', () => {
    // 推送开始时的快照 + 远端他端记录,合并后由 pushProgress 回传
    const pushed = emptyProgress()
    pushed.words['a'] = entry('2026-07-25T01:00:00Z', 1)
    pushed.words['remote-only'] = entry('2026-07-25T00:30:00Z', 7)
    pushed.dailyStats['2026-07-25'] = { reviewed: 1, newLearned: 1, correct: 1, quizTaken: 0 }

    // 请求还在飞的时候,用户又复习了 a 和 b
    const current = emptyProgress()
    current.words['a'] = entry('2026-07-25T02:00:00Z', 2)
    current.words['b'] = entry('2026-07-25T02:00:01Z', 1)
    current.dailyStats['2026-07-25'] = { reviewed: 3, newLearned: 2, correct: 3, quizTaken: 0 }

    const out = reconcileProgress(current, pushed)
    expect(out.words['a'].reps).toBe(2)              // 飞行途中的那一笔没被旧快照盖回去
    expect(out.words['b']).toBeDefined()
    expect(out.words['remote-only'].reps).toBe(7)    // 远端合并进来的也还在
    expect(out.dailyStats['2026-07-25'].reviewed).toBe(3)
  })
})

describe('reconcileWords', () => {
  it('推送期间本地没动过:原样返回', () => {
    const current = [word('a')]
    expect(reconcileWords(current, current, [])).toBe(current)
  })

  it('推送期间新加的词要补回到「远端+重放」的结果上', () => {
    // 冲突重放后的结果:远端并发加的 gamma + 本次推送的 zeta
    const pushed = [word('alpha'), word('gamma'), word('zeta')]
    // 推送还在飞的时候用户又加了 later,它不在本次推送里
    const remaining: WordsOp[] = [{ kind: 'upsert', word: word('later') }]

    const out = reconcileWords([word('alpha'), word('zeta'), word('later')], pushed, remaining)
    expect(out.map(w => w.id).sort()).toEqual(['alpha', 'gamma', 'later', 'zeta'])
  })

  it('推送期间的删除同样要补上', () => {
    const pushed = [word('alpha'), word('gamma')]
    const out = reconcileWords([word('alpha')], pushed, [{ kind: 'delete', ids: ['gamma'] }])
    expect(out.map(w => w.id)).toEqual(['alpha'])
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

  it.each([
    ['进度条目缺字段', '{"version":1,"settings":{"newPerDay":10},"words":{"a":{"state":"review"}},"dailyStats":{}}'],
    ['进度条目 state 不合法', `{"version":1,"settings":{"newPerDay":10},"words":{"a":${JSON.stringify({ ...entry('t', 1), state: 'bogus' })}},"dailyStats":{}}`],
    ['日统计缺字段', '{"version":1,"settings":{"newPerDay":10},"words":{},"dailyStats":{"2026-07-25":{"reviewed":1}}}'],
    ['日统计字段不是数字', '{"version":1,"settings":{"newPerDay":10},"words":{},"dailyStats":{"2026-07-25":{"reviewed":"1","newLearned":0,"correct":0,"quizTaken":0}}}'],
  ])('parseProgress 拒绝%s —— 半坏的文件会在页面上炸,不能放行', (_label, text) => {
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
    ['词条缺 meanings', `{"version":1,"words":[${JSON.stringify({ ...word('a'), meanings: undefined })}]}`],
    ['meanings 是空数组', `{"version":1,"words":[${JSON.stringify({ ...word('a'), meanings: [] })}]}`],
    ['meanings 条目缺 zh', '{"version":1,"words":[{"id":"a","headword":"a","phonetic":"/a/","meanings":[{"pos":"n.","en":"a"}],"examples":[],"synonyms":[],"antonyms":[],"collocations":[],"relatedForms":[],"sourceNote":"m","addedAt":"2026-07-25"}]}'],
    ['examples 不是数组', `{"version":1,"words":[${JSON.stringify({ ...word('a'), examples: 'nope' })}]}`],
    ['relatedForms 缺失', `{"version":1,"words":[${JSON.stringify({ ...word('a'), relatedForms: undefined })}]}`],
  ])('parseWords 拒绝%s', (_label, text) => {
    expect(() => parseWords(text)).toThrow()
  })

  // Task 24 会把这份文件原样推进 volcab-data,它必须能过我们自己的校验
  it('仓库里的 476 词词库能通过 parseWords', () => {
    const parsed = parseWords(JSON.stringify(realLibrary))
    expect(parsed).toHaveLength(476)
    expect(parsed.some(w => w.id === 'interchangeability')).toBe(true)
  })
})

// === 生词暂存区 staging.json ===============================================
// 第三个同步文件。规则比 progress 简单得多:按归一化词头取并集,同词留较早的
// addedAt。追加为主、天然幂等 —— 但它是新接进来的一环,下面每一条都在盯着
// 「别把已有的两个文件带下水」。

describe('normalizeHeadword', () => {
  it('大小写、首尾空白、内部连续空白都归一到同一个键', () => {
    expect(normalizeHeadword('  Ostensible ')).toBe('ostensible')
    expect(normalizeHeadword('Ad   Hoc')).toBe('ad hoc')
    expect(normalizeHeadword('ad hoc')).toBe(normalizeHeadword(' AD  HOC '))
  })
})

describe('mergeStaging', () => {
  it('取并集:两端各自加的词都要留下', () => {
    const out = mergeStaging([item('ostensible')], [item('perfunctory')])
    expect(out.map(i => i.headword)).toEqual(['ostensible', 'perfunctory'])
  })

  it('两台设备加了同一个词:合并成一条,保留较早的 addedAt', () => {
    const a = [item('ostensible', '2026-07-25')]
    const b = [item('ostensible', '2026-07-20')]
    expect(mergeStaging(a, b)).toEqual([item('ostensible', '2026-07-20')])
    // 反向合并结果相同 —— 谁先谁后不影响内容,否则两台设备会互相推翻对方
    expect(mergeStaging(b, a)).toEqual([item('ostensible', '2026-07-20')])
  })

  it('大小写与空白不同视为同一个词,不重复入列', () => {
    const out = mergeStaging([item('Ad  Hoc', '2026-07-25')], [item(' ad hoc ', '2026-07-26')])
    expect(out).toHaveLength(1)
    expect(normalizeHeadword(out[0].headword)).toBe('ad hoc')
  })

  it('幂等:同一份内容合并多少次都不变', () => {
    const base = [item('a', '2026-07-01'), item('b', '2026-07-02')]
    expect(mergeStaging(mergeStaging(base, base), base)).toEqual(base)
  })

  it('不改写入参,且空词头被丢掉', () => {
    const a = [item('ostensible')]
    const out = mergeStaging(a, [item('   ')])
    expect(out).toEqual([item('ostensible')])
    expect(a).toEqual([item('ostensible')])
  })
})

describe('parseStaging / serializeStaging', () => {
  it('接受合法文件', () => {
    expect(parseStaging(stagingFile([item('ostensible')]))).toEqual([item('ostensible')])
  })

  it('空列表是合法的 —— 补全流程会把条目全部移走', () => {
    expect(parseStaging('{"version":1,"items":[]}')).toEqual([])
  })

  it('序列化为 2 空格缩进 + 结尾换行,与另外两个文件一致', () => {
    const text = serializeStaging([item('ostensible')])
    expect(text).toBe('{\n  "version": 1,\n  "items": [\n    {\n      "headword": "ostensible",\n      "addedAt": "2026-07-25"\n    }\n  ]\n}\n')
    expect(parseStaging(text)).toEqual([item('ostensible')])
  })

  it.each([
    ['非 JSON', '{oops'],
    ['顶层是数组', '[]'],
    ['版本不对', '{"version":2,"items":[]}'],
    ['items 不是数组', '{"version":1,"items":{}}'],
    ['条目缺 addedAt', '{"version":1,"items":[{"headword":"ostensible"}]}'],
    ['addedAt 不是日期', '{"version":1,"items":[{"headword":"ostensible","addedAt":"昨天"}]}'],
    ['词头是空串', '{"version":1,"items":[{"headword":"  ","addedAt":"2026-07-25"}]}'],
    ['词头不是字符串', '{"version":1,"items":[{"headword":42,"addedAt":"2026-07-25"}]}'],
  ])('拒绝%s', (_label, text) => {
    expect(() => parseStaging(text)).toThrow()
  })
})

describe('loadStaging:三个文件里最不重要的那个,读不到一律当没有', () => {
  it('远端还没有这个文件:返回 null,不抛错', async () => {
    const { client } = fakeClient({ puts: [] })
    await expect(loadStaging(client)).resolves.toBeNull()
  })

  it('远端文件坏了:返回 null 而不是让异常冒到登录/启动路径上', async () => {
    const { client } = fakeClient({
      puts: [], files: { 'staging.json': { content: '{"version":1,"items":[{"nope":1}]}', sha: 's' } },
    })
    await expect(loadStaging(client)).resolves.toBeNull()
  })

  it('读取本身失败(网络/权限):同样吞掉 —— 绝不能因为它登不上或推不了 progress', async () => {
    const { client } = fakeClient({ puts: [], getThrows: new Error('读取 staging.json 失败 (HTTP 500)') })
    await expect(loadStaging(client)).resolves.toBeNull()
  })

  // 这条盯的是引入第三个文件时最容易犯的错:把它塞进 boot 的 Promise.all,
  // 结果它一 reject 就把 words / progress 一起拖进 catch —— 用户会看到「登录失败」
  // 或者一个不再同步进度的 App,而原因只是几个还没补全的单词。
  it('放进 boot 那个 Promise.all 里也不会把 words/progress 拖下水', async () => {
    const client: SyncClient = {
      async getFile(path) {
        if (path === 'staging.json') throw new Error('读取 staging.json 失败 (HTTP 500)')
        return { content: path === 'words.json' ? wordsFile(['alpha']) : JSON.stringify(emptyProgress()), sha: path }
      },
      async putFile() { throw new Error('本用例不该推送') },
    }

    const [wf, pf, sf] = await Promise.all([
      client.getFile('words.json'), client.getFile('progress.json'), loadStaging(client),
    ])

    expect(parseWords(wf!.content)).toHaveLength(1)   // 词库照常拿到
    expect(parseProgress(pf!.content).version).toBe(1) // 进度照常拿到
    expect(sf).toBeNull()                              // 暂存区当作没有,仅此而已
  })

  it('正常读到:带回条目与 sha', async () => {
    const { client } = fakeClient({
      puts: [], files: { 'staging.json': { content: stagingFile([item('ostensible')]), sha: 'st-1' } },
    })
    await expect(loadStaging(client)).resolves.toEqual({ items: [item('ostensible')], sha: 'st-1' })
  })
})

describe('pushStaging', () => {
  it('成功:整份覆盖写 staging.json,回写 stagingSha', async () => {
    storage.set('stagingSha', 'st-old')
    const local = [item('ostensible')]
    const { client, putCalls } = fakeClient({ puts: [{ sha: 'st-new' }] })

    const out = await pushStaging(client, local, local)

    expect(out).toEqual({ ok: true, sha: 'st-new', data: local })
    expect(putCalls[0].path).toBe('staging.json')
    expect(putCalls[0].sha).toBe('st-old')
    expect(JSON.parse(putCalls[0].content).version).toBe(1)
    expect(storage.get('stagingSha')).toBe('st-new')
  })

  it('首次推送(远端还没有这个文件):不带 sha,直接创建', async () => {
    const { client, putCalls } = fakeClient({ puts: [{ sha: 'st-1' }] })
    await pushStaging(client, [item('ostensible')], [item('ostensible')])
    expect(putCalls[0].sha).toBeUndefined()
  })

  it('冲突:在重新拉回的远端副本上合并本次收词,他端收的词全部保留', async () => {
    const mine = item('zeta', '2026-07-25')
    const { client, putCalls, getCalls } = fakeClient({
      puts: ['conflict', { sha: 'st-merged' }],
      files: {
        'staging.json': {
          content: stagingFile([item('alpha', '2026-07-01'), item('gamma', '2026-07-02')]),
          sha: 'st-remote',
        },
      },
    })
    const out = await pushStaging(client, [mine], [mine])

    expect(out.ok).toBe(true)
    expect(getCalls).toEqual(['staging.json'])
    expect(putCalls[1].sha).toBe('st-remote')
    expect(sentStaging(putCalls).map(i => i.headword).sort()).toEqual(['alpha', 'gamma', 'zeta'])
    if (out.ok) expect(out.data.map(i => i.headword).sort()).toEqual(['alpha', 'gamma', 'zeta'])
  })

  it('冲突:两端同一天各收了同一个词,合并后只剩一条且日期取早的', async () => {
    const mine = item('Ostensible', '2026-07-25')
    const { client, putCalls } = fakeClient({
      puts: ['conflict', { sha: 'st-merged' }],
      files: { 'staging.json': { content: stagingFile([item('ostensible', '2026-07-20')]), sha: 'st-r' } },
    })
    const out = await pushStaging(client, [mine], [mine])

    expect(out.ok).toBe(true)
    expect(sentStaging(putCalls)).toEqual([item('ostensible', '2026-07-20')])
  })

  it('远端 staging.json 解析不了:拒绝覆盖,不发第二次 put,sha 不动', async () => {
    storage.set('stagingSha', 'st-old')
    const { client, putCalls } = fakeClient({
      puts: ['conflict', { sha: 'never' }],
      files: { 'staging.json': { content: '{"version":1,"items":[{"headword":"x"}]}', sha: 'st-r' } },
    })
    const out = await pushStaging(client, [item('zeta')], [item('zeta')])

    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain('备份')
    expect(putCalls).toHaveLength(1)               // 没有把本地那份盖上去
    expect(storage.get('stagingSha')).toBe('st-old')
  })

  it('连续两次冲突:一次重试后放弃,本地条目留着下次再推', async () => {
    const { client, putCalls } = fakeClient({
      puts: ['conflict', 'conflict'],
      files: { 'staging.json': { content: stagingFile([item('alpha')]), sha: 'st-r' } },
    })
    const out = await pushStaging(client, [item('zeta')], [item('zeta')])
    expect(out.ok).toBe(false)
    expect(putCalls).toHaveLength(2)
  })

  it('网络异常:错误上报,sha 不动', async () => {
    storage.set('stagingSha', 'st-old')
    const { client } = fakeClient({ puts: [new TypeError('Failed to fetch')] })
    const out = await pushStaging(client, [item('zeta')], [item('zeta')])
    expect(out.ok).toBe(false)
    expect(storage.get('stagingSha')).toBe('st-old')
  })

  it('登出后才返回的推送不回写 stagingSha', async () => {
    storage.set('stagingSha', 'st-old')
    const { client } = fakeClient({ puts: [{ sha: 'st-new' }] })
    const out = await pushStaging(client, [item('zeta')], [item('zeta')], { alive: () => false })
    expect(out.ok).toBe(true)
    expect(storage.get('stagingSha')).toBe('st-old')
  })
})

describe('reconcileStaging', () => {
  it('推送期间本地没动过:原样返回', () => {
    const current = [item('a')]
    expect(reconcileStaging(current, current, [])).toBe(current)
  })

  it('推送飞行途中又收了一个词:那一条必须活下来,远端合并进来的也还在', () => {
    const pushed = [item('alpha', '2026-07-01'), item('zeta', '2026-07-25')]
    const later = item('later', '2026-07-25')
    const out = reconcileStaging([item('zeta'), later], pushed, [later])
    expect(out.map(i => i.headword).sort()).toEqual(['alpha', 'later', 'zeta'])
  })
})
