import { mergeProgress } from '../lib/merge'
import { storage } from '../lib/storage'
import type { Progress, Word, WordsFile } from '../types'

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

export interface SyncClient {
  getFile(path: string): Promise<{ content: string; sha: string } | null>
  putFile(path: string, content: string, message: string, sha?: string): Promise<{ sha: string } | 'conflict'>
}

export type PushOutcome<T> =
  | { ok: true; sha: string; data: T }   // data 是最终落盘的内容(可能已与远端合并)
  | { ok: false; error: string }

/** 本次会话对词库做过的改动,冲突时在重新拉取的远端副本上重放 */
export type WordsOp =
  | { kind: 'upsert'; word: Word }
  | { kind: 'delete'; ids: string[] }

const GIVE_UP = '云端刚被其他设备改写,已重试一次仍冲突;本次改动留在本地,稍后会自动重试。'
const BACKUP_HINT = '云端文件解析失败,已中止同步以免覆盖数据。请先到设置页导出备份,再检查数据仓库。'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

// --- 序列化与校验 ---------------------------------------------------------
// 缩进 2 空格 + 结尾换行:GitHub 网页上的 diff 才是逐词条可读的。

export const serializeProgress = (p: Progress): string => `${JSON.stringify(p, null, 2)}\n`

export const serializeWords = (words: Word[]): string =>
  `${JSON.stringify({ version: 1, words } satisfies WordsFile, null, 2)}\n`

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** 解析远端 progress.json;形状不对就抛错,由调用方拒绝覆盖远端 */
export function parseProgress(text: string): Progress {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error(BACKUP_HINT) }
  if (
    !isRecord(raw) || raw.version !== 1 ||
    !isRecord(raw.settings) || typeof raw.settings.newPerDay !== 'number' ||
    !isRecord(raw.words) || !isRecord(raw.dailyStats)
  ) throw new Error(BACKUP_HINT)
  return raw as unknown as Progress
}

/** 解析远端 words.json;形状不对就抛错,由调用方拒绝覆盖远端 */
export function parseWords(text: string): Word[] {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error(BACKUP_HINT) }
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.words)) throw new Error(BACKUP_HINT)
  for (const w of raw.words) {
    if (!isRecord(w) || typeof w.id !== 'string' || typeof w.headword !== 'string') throw new Error(BACKUP_HINT)
  }
  return raw.words as Word[]
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

// --- 推送 -----------------------------------------------------------------

/**
 * 推 progress.json。
 *
 * dirty 在发请求**前**就清掉:飞行途中用户又打了分会把它重新置 true,
 * 这样这次成功不会把那笔改动一起「吞」成已同步。失败则重新置脏。
 */
export async function pushProgress(client: SyncClient, local: Progress): Promise<PushOutcome<Progress>> {
  storage.set('dirty', false)
  try {
    const sha = storage.get<string>('progressSha') ?? undefined
    const first = await client.putFile(PROGRESS_PATH, serializeProgress(local), 'sync progress', sha)
    if (first !== 'conflict') {
      storage.set('progressSha', first.sha)
      return { ok: true, sha: first.sha, data: local }
    }

    const remote = await client.getFile(PROGRESS_PATH)
    const merged = remote ? mergeProgress(local, parseProgress(remote.content)) : local
    const second = await client.putFile(
      PROGRESS_PATH, serializeProgress(merged), 'sync progress (merged)', remote?.sha,
    )
    if (second === 'conflict') {
      storage.set('dirty', true)
      return { ok: false, error: GIVE_UP }
    }
    storage.set('progressSha', second.sha)
    return { ok: true, sha: second.sha, data: merged }
  } catch (e) {
    storage.set('dirty', true)
    return { ok: false, error: errText(e) }
  }
}

/**
 * 推 words.json(整份覆盖)。冲突时不做字段级合并 —— 重新拉远端,
 * 把本次会话尚未落地的增删重放上去,他端并发添加的词条因此得以保留。
 */
export async function pushWords(client: SyncClient, local: Word[], ops: WordsOp[]): Promise<PushOutcome<Word[]>> {
  try {
    const sha = storage.get<string>('wordsSha') ?? undefined
    const first = await client.putFile(WORDS_PATH, serializeWords(local), 'update words', sha)
    if (first !== 'conflict') {
      storage.set('wordsSha', first.sha)
      return { ok: true, sha: first.sha, data: local }
    }

    const remote = await client.getFile(WORDS_PATH)
    const replayed = remote ? applyWordOps(parseWords(remote.content), ops) : local
    const second = await client.putFile(
      WORDS_PATH, serializeWords(replayed), 'update words (merged)', remote?.sha,
    )
    if (second === 'conflict') return { ok: false, error: GIVE_UP }
    storage.set('wordsSha', second.sha)
    return { ok: true, sha: second.sha, data: replayed }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}
