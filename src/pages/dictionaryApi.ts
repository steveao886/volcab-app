/**
 * api.dictionaryapi.dev 取词与响应映射。
 *
 * 全应用唯一会跟第三方、无认证公开接口打交道的地方 —— 不发送任何凭据,
 * 响应形状完全不受我们控制。映射函数是纯函数,吃什么都不抛错:任何意外
 * 形状(404 的错误体、字段缺失、类型不对)都退化成空结果,交由页面的
 * 手动表单兜底。唯一有单测覆盖的部分,见 dictionaryApi.test.ts。
 */

const ENDPOINT = 'https://api.dictionaryapi.dev/api/v2/entries/en'

export interface DictMeaning {
  pos: string
  en: string
}

export interface DictLookup {
  phonetic: string
  meanings: DictMeaning[]
}

/** 本应用对词性的缩写约定,与 data/words.json 里现有词条保持一致 */
const POS_ABBREVIATIONS: Record<string, string> = {
  noun: 'n.',
  pronoun: 'pron.',
  verb: 'v.',
  adjective: 'adj.',
  adverb: 'adv.',
  preposition: 'prep.',
  conjunction: 'conj.',
  interjection: 'interj.',
  exclamation: 'interj.',
  determiner: 'det.',
  article: 'art.',
  numeral: 'num.',
  particle: 'part.',
}

function abbreviatePos(raw: string): string {
  const pos = raw.trim()
  if (!pos) return ''
  const known = POS_ABBREVIATIONS[pos.toLowerCase()]
  if (known) return known
  // 未知词性(接口偶尔给 "phrase" 这类非标准值):退化成「词.」的通用缩写,
  // 而不是原样塞入一整个英文单词。
  return `${pos.toLowerCase()}.`
}

/** 音标统一成 /.../ 形式;接口有时已带斜杠,有时不带,偶尔是空字符串 */
function normalizePhonetic(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const bare = trimmed.replace(/^\/+/, '').replace(/\/+$/, '').trim()
  return bare ? `/${bare}/` : ''
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/**
 * 把 api.dictionaryapi.dev 的原始响应体映射成本应用需要的最小字段:
 * 音标 + 前 3 条「确实带英文释义」的 meaning(词性 + 英文释义,中文留给
 * 用户填)。只取数组第一个词条 —— 同一页面里多义词共用同一段音标区。
 *
 * 纯函数,不发请求、不抛异常:任何不符合预期的形状都安全退化成空结果。
 */
export function mapDictionaryResponse(data: unknown): DictLookup {
  const entries = Array.isArray(data) ? data : []
  const entry = entries.find(isRecord)
  if (!entry) return { phonetic: '', meanings: [] }

  let phonetic = typeof entry.phonetic === 'string' ? normalizePhonetic(entry.phonetic) : ''
  if (!phonetic && Array.isArray(entry.phonetics)) {
    for (const p of entry.phonetics) {
      if (isRecord(p) && typeof p.text === 'string') {
        const normalized = normalizePhonetic(p.text)
        if (normalized) {
          phonetic = normalized
          break
        }
      }
    }
  }

  const meanings: DictMeaning[] = []
  if (Array.isArray(entry.meanings)) {
    for (const m of entry.meanings) {
      if (meanings.length >= 3) break
      if (!isRecord(m)) continue
      const defs = Array.isArray(m.definitions) ? m.definitions : []
      const firstDef = defs.find(
        (d): d is Record<string, unknown> & { definition: string } =>
          isRecord(d) && typeof d.definition === 'string' && d.definition.trim() !== '',
      )
      if (!firstDef) continue // 该 meaning 没有可用的英文释义,不计入前 3 条配额
      const en = firstDef.definition.trim()
      const pos = typeof m.partOfSpeech === 'string' ? abbreviatePos(m.partOfSpeech) : ''
      meanings.push({ pos, en })
    }
  }

  return { phonetic, meanings }
}

export type LookupOutcome =
  | { status: 'ok'; phonetic: string; meanings: DictMeaning[] }
  | { status: 'not-found' }
  | { status: 'error'; message: string }

/**
 * 实际发请求的部分,不参与单测(网络行为,测试环境不联网,见任务说明)。
 * 无认证接口,不带任何凭据。404、非 2xx、超时、网络失败分别落到不同的
 * outcome,页面据此决定是提示重试还是直接转入全手动表单。
 */
export async function lookupWord(word: string, timeoutMs = 8000): Promise<LookupOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${ENDPOINT}/${encodeURIComponent(word)}`, { signal: controller.signal })
    if (res.status === 404) return { status: 'not-found' }
    if (!res.ok) return { status: 'error', message: `词典查询失败(HTTP ${res.status})` }
    const json = await res.json().catch(() => null)
    if (json === null) return { status: 'error', message: '词典返回的内容无法解析' }
    const mapped = mapDictionaryResponse(json)
    return { status: 'ok', phonetic: mapped.phonetic, meanings: mapped.meanings }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { status: 'error', message: '查询超时,请检查网络后重试' }
    }
    return { status: 'error', message: '网络请求失败,请检查网络后重试' }
  } finally {
    clearTimeout(timer)
  }
}
