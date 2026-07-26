import { mergeProgress } from '../lib/merge'
import { storage } from '../lib/storage'
import type { Progress, ProgressEntry, StagingFile, StagingItem, Word, WordsFile } from '../types'
import { BACKUP_HINT, errText, GIVE_UP } from './errors'

/**
 * 同步编排:两个文件的「推一次,冲突就合并重推一次」。
 *
 * 刻意不依赖 React,也不依赖 GitHubClient 具体类 —— 只吃下面这个结构接口,
 * 因此整条冲突重试路径可以用纯对象假 client 测(见 sync.test.ts)。
 *
 * 职责边界:本模块管**远端簿记**(progressSha / wordsSha / dirty),
 * store 管本地状态与 words / progress 正文的缓存。
 */

export const WORDS_PATH = 'words.json'
export const PROGRESS_PATH = 'progress.json'
/**
 * 生词暂存区。**单独一个文件**而不是塞进上面两个:放进 words.json,半成品词条
 * 通不过 schema 校验还会直接进复习队列;放进 progress.json,它会卷进那套为学习
 * 进度设计的按词合并逻辑。单独文件 = 独立的冲突域(设计文档 §6.2)。
 */
export const STAGING_PATH = 'staging.json'

export interface SyncClient {
  getFile(path: string): Promise<{ content: string; sha: string } | null>
  putFile(path: string, content: string, message: string, sha?: string): Promise<{ sha: string } | 'conflict'>
}

export interface PushOptions {
  /** 返回 false 表示会话已经结束(登出/换号),此时一个簿记键都不该再写 */
  alive?: () => boolean
}

export type PushOutcome<T> =
  | { ok: true; sha: string; data: T }   // data 是最终落盘的内容(可能已与远端合并)
  | { ok: false; error: string }

/** 本次会话对词库做过的改动,冲突时在重新拉取的远端副本上重放 */
export type WordsOp =
  | { kind: 'upsert'; word: Word }
  | { kind: 'delete'; ids: string[] }

// --- 形状校验 -------------------------------------------------------------
// 远端文件是「别的进程写的、可能被手改过的」外部输入。只查顶层不够:一份
// dailyStats 缺字段、meanings 为空的半坏文件能过顶层校验,却会在渲染时炸成
// undefined.map()。§8 要的是「解析不了或对不上 schema 就拒绝覆盖远端」,
// 所以这里逐条查到叶子。

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
 * 暂存条目只有两个字段,两个都查死。
 * `headword` 不能是空白串 —— 一条空条目在页面上是个看不见却占位的幽灵,
 * 并且归一化后键为空,会和下一条空条目撞在一起。
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

// --- 序列化与解析 ---------------------------------------------------------
// 缩进 2 空格 + 结尾换行:GitHub 网页上的 diff 才是逐词条可读的。

export const serializeProgress = (p: Progress): string => `${JSON.stringify(p, null, 2)}\n`

export const serializeWords = (words: Word[]): string =>
  `${JSON.stringify({ version: 1, words } satisfies WordsFile, null, 2)}\n`

export const serializeStaging = (items: StagingItem[]): string =>
  `${JSON.stringify({ version: 1, items } satisfies StagingFile, null, 2)}\n`

function parseJson(text: string): unknown {
  try { return JSON.parse(text) } catch { throw new Error(BACKUP_HINT) }
}

/** 解析远端 progress.json;形状不对就抛错,由调用方拒绝覆盖远端 */
export function parseProgress(text: string): Progress {
  const raw = parseJson(text)
  if (!isProgress(raw)) throw new Error(BACKUP_HINT)
  return raw
}

/** 解析远端 words.json;形状不对就抛错,由调用方拒绝覆盖远端 */
export function parseWords(text: string): Word[] {
  const raw = parseJson(text)
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.words)) throw new Error(BACKUP_HINT)
  if (!raw.words.every(isWord)) throw new Error(BACKUP_HINT)
  return raw.words
}

/** 解析远端 staging.json;形状不对就抛错,由调用方决定是拒绝覆盖还是当作没有 */
export function parseStaging(text: string): StagingItem[] {
  const raw = parseJson(text)
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.items)) throw new Error(BACKUP_HINT)
  if (!raw.items.every(isStagingItem)) throw new Error(BACKUP_HINT)
  return raw.items
}

// --- 暂存区合并 -----------------------------------------------------------

/** 去首尾空白,内部连续空白折成一个空格。保留大小写,给人看的就是这一份。 */
export const cleanHeadword = (s: string): string => s.trim().replace(/\s+/g, ' ')

/** 去重与合并的键:在 cleanHeadword 之上再转小写。「Ad  Hoc」与「ad hoc」是同一个词。 */
export const normalizeHeadword = (s: string): string => cleanHeadword(s).toLowerCase()

/**
 * 暂存区合并 = 按归一化词头取并集,同词保留较早的 `addedAt`。
 *
 * 比 progress 那套按词比 `lastReviewedAt` 简单得多,因为这里只有「追加」这一种
 * 动作(移除发生在会话里,由人推一次新文件),所以并集天然幂等 —— 同一条重放
 * 多少次结果都一样,不需要待推送队列去区分「这次到底改了什么」。
 *
 * 「保留较早的」取整条,不只取日期:日期是 YYYY-MM-DD,字典序即时间序。
 * 内容与合并方向无关(a∪b 和 b∪a 得到同一组条目),只有排列顺序按首次出现。
 */
export function mergeStaging(a: StagingItem[], b: StagingItem[]): StagingItem[] {
  const byKey = new Map<string, StagingItem>()
  for (const it of [...a, ...b]) {
    const key = normalizeHeadword(it.headword)
    if (key === '') continue        // 空条目不入列(远端已被 parseStaging 挡掉,这里防本地构造)
    const prev = byKey.get(key)
    if (!prev || it.addedAt < prev.addedAt) byKey.set(key, it)   // Map.set 不改已有键的位置
  }
  return [...byKey.values()]
}

/**
 * 读远端 staging.json,**任何失败都当作「远端还没有这个文件」**。
 *
 * 三个同步文件里它最不重要:词库和进度是用户的真实资产,暂存区只是几个还没
 * 补全的单词。所以缺失、解析失败、甚至读取报错,都不能让异常冒到登录/启动
 * 路径上去 —— 那条路径上一个抛错就是「登不进去」或「progress 不同步」。
 * 推送路径不用这个函数,那里必须区分「没有」和「坏了」(见 pushStaging)。
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

// --- 词库改动重放 ---------------------------------------------------------

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

// --- 推送返回后的对账 -----------------------------------------------------
// 推送是异步的,`pushed` 是请求**发出那一刻**的快照(可能又和远端合并过)。
// 直接拿它盖回本地,会把请求飞行途中用户新做的改动吞掉 —— 这是这个 App 最
// 严重的失败模式,所以单独成函数并有测试盯着,别当成 sync 内部合并的冗余删掉。

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

// --- 推送 -----------------------------------------------------------------

/**
 * 推 progress.json。
 *
 * dirty 在发请求**前**就清掉:飞行途中用户又打了分会把它重新置 true,
 * 这样这次成功不会把那笔改动一起「吞」成已同步。失败则重新置脏。
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
 * 推 words.json(整份覆盖)。冲突时不做字段级合并 —— 重新拉远端,
 * 把尚未确认落地的增删重放上去,他端并发添加的词条因此得以保留。
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
 * 推 staging.json。时机与冲突策略照抄 words.json(变更即推、不防抖;冲突就重新
 * 拉远端、把本次收的词合上去、再推一次,仍冲突就放弃留到下次)。
 *
 * 与 pushWords 的唯一区别是「重放」换成了并集合并 —— 没有删除动作要重放,
 * 所以 `pending` 直接就是要并进去的条目。
 *
 * 注意这里**不**吞解析错误:远端文件坏掉时必须中止,而不是拿本地那份盖过去。
 * 启动/登录路径上的宽容由 loadStaging 负责,两条路径要的东西正好相反。
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
