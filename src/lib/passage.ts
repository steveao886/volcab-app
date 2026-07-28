/**
 * 短文选词填空的出题逻辑。全部纯函数 —— 渲染层只负责把这里算出来的结果画出来。
 *
 * 设计见 docs/superpowers/specs/2026-07-28-passage-cloze-design.md
 */

export interface Passage {
  id: string
  title: string
  /** 逐句英文。目标词用 {{wordId|句中形式}} 标记,形式与词头相同时简写 {{concoct}} */
  en: string[]
  /** 逐句中译,与 en 一一对应 */
  zh: string[]
}

export interface PassagesFile { version: 1; passages: Passage[] }

export type Token =
  | { kind: 'text'; text: string }
  | { kind: 'word'; wordId: string; surface: string }

/**
 * `{{wordId}}` 或 `{{wordId|句中形式}}`。
 *
 * id 与形式都不允许含 `{}|`,所以 `{{a|b|c}}` 这种写坏的标记**匹配不上**,
 * 会原样留在文本片段里 —— 下面那条残留花括号检查再把整句判死。
 */
const MARKER = /\{\{([^{}|]+)(?:\|([^{}|]+))?\}\}/g

/**
 * 解析一句。畸形标记返回 null。
 *
 * **宁可整篇跳过也不将就**:标记写坏的后果不是少一个空,是挖错空或者把
 * `{{refute` 这种半截字符串印在题面上。与 words.json 那条「写入端严格、
 * 读取端宽容」是同一条规矩 —— 校验脚本是闸门,这里是不白屏的兜底。
 */
export function parseSentence(s: string): Token[] | null {
  const out: Token[] = []
  let last = 0
  for (const m of s.matchAll(MARKER)) {
    const wordId = m[1].trim()
    const surface = (m[2] ?? m[1]).trim()
    if (wordId === '' || surface === '') return null
    if (m.index > last) out.push({ kind: 'text', text: s.slice(last, m.index) })
    out.push({ kind: 'word', wordId, surface })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ kind: 'text', text: s.slice(last) })
  if (out.some(t => t.kind === 'text' && /[{}]/.test(t.text))) return null
  return out
}

/** 逐句解析整篇。任何一句畸形、或中英句数对不上,整篇返回 null。 */
export function parsePassage(p: Passage): Token[][] | null {
  if (p.en.length === 0 || p.en.length !== p.zh.length) return null
  const out: Token[][] = []
  for (const s of p.en) {
    const tokens = parseSentence(s)
    if (tokens === null) return null
    out.push(tokens)
  }
  return out
}
