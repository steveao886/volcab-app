import { cleanHeadword, normalizeHeadword } from '../state/sync'
import type { StagingItem, Word } from '../types'

/**
 * 快速收词的去重判定(设计文档 §6.3:「大小写与首尾空白归一后,已在 words.json
 * 或已在 staging.json 中的词直接提示,不重复入列」)。
 *
 * 摘成纯函数是因为它要同时看两个数据源、还要区分四种结果 —— 埋在组件里就只能
 * 靠点界面来验,而「重复词被正确拦下」是本功能的验收项之一。
 */
export type CaptureCheck =
  | { kind: 'empty' }
  | { kind: 'in-library'; id: string; headword: string }
  | { kind: 'in-staging'; headword: string }
  | { kind: 'ok'; headword: string }

export function checkCapture(raw: string, words: Word[], staging: StagingItem[]): CaptureCheck {
  const headword = cleanHeadword(raw)
  if (headword === '') return { kind: 'empty' }

  const key = normalizeHeadword(headword)
  // 词库 id 把短语里的空格折成连字符("ad hoc" → "ad-hoc"),所以两种写法都要比:
  // 用户敲 "ad hoc" 或 "ad-hoc" 都该被认出是同一个已收录的词。
  const idKey = key.replace(/ /g, '-')
  const hit = words.find(w => normalizeHeadword(w.headword) === key || w.id === idKey)
  if (hit) return { kind: 'in-library', id: hit.id, headword: hit.headword }

  const staged = staging.find(s => normalizeHeadword(s.headword) === key)
  if (staged) return { kind: 'in-staging', headword: staged.headword }

  return { kind: 'ok', headword }
}
