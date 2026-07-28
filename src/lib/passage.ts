/**
 * 短文选词填空的出题逻辑。全部纯函数 —— 渲染层只负责把这里算出来的结果画出来。
 *
 * 设计见 docs/superpowers/specs/2026-07-28-passage-cloze-design.md
 */

import type { Progress, Word } from '../types'
import type { ContrastPair } from './contrast'
import { shuffle } from './quiz'

/**
 * 故意不放进 src/types.ts:那份文件是「会同步」的数据模型 —— 跟 volcab-data
 * 仓库互相拉取推送,要过 merge/冲突处理那一套。短文是只读内容,随 App 打包
 * 一起发布,从不参与同步,不属于那份 schema 管的范围。下次别把它「归位」过去。
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
    // {{refute refuted}} 是忘了写竖线的典型笔误 —— 没有这条检查,它会被当成
    // 一个带空格的 id 直接放行。validate-words.ts 早就规定每个 Word.id
    // 必须是小写且无空白,所以任何不满足这一条的 wordId 都注定匹配不到词,
    // 与其让它混进题面查无此词,不如在这里就判成畸形标记。
    if (wordId !== wordId.toLowerCase() || /\s/.test(wordId)) return null
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

/** 一篇里至少要凑够 3 个空。两个空互为线索的推理不成立,退化成两道单句挖空。 */
export const MIN_BLANKS = 3
/** 一屏最多 7 个空,再多就做不完。 */
export const MAX_BLANKS = 7

export interface Blank {
  /** 第几句 */
  si: number
  /** 该句里第几个 token */
  ti: number
  wordId: string
  /** 句中形式,判对后填进去的就是它 */
  surface: string
}

/**
 * 选出要挖的空。
 *
 * **只挖学过的词**(`state !== 'new'`),没学过的、以及在词库里查不到的原样印出来。
 * 这条沿用辨析模式那条教训(见 quiz.ts 的 generateContrastQuiz):不拿没见过的词
 * 考你。但与辨析不同的是,没见过的词可以留在上下文里 —— 它不是题,是读物。
 */
export function selectBlanks(
  sentences: Token[][],
  words: Map<string, Word>,
  progress: Progress,
  today: string,
): Blank[] {
  const seen = new Set<string>()
  const eligible: Blank[] = []

  sentences.forEach((tokens, si) => {
    tokens.forEach((t, ti) => {
      if (t.kind !== 'word') return
      // 同一个词一篇里最多一个空 —— 否则候选词区会出现两个一模一样的词,
      // 而「用掉就划掉」的规则立刻自相矛盾。
      if (seen.has(t.wordId)) return
      if (!words.has(t.wordId)) return
      const e = progress.words[t.wordId]
      if (e === undefined || e.state === 'new') return
      seen.add(t.wordId)
      eligible.push({ si, ti, wordId: t.wordId, surface: t.surface })
    })
  })

  if (eligible.length <= MAX_BLANKS) return eligible

  // 到期的先占坑,再按正文顺序还原 —— 渲染必须按出现顺序,砍的是「挖谁」不是「怎么排」
  const isDue = (b: Blank) => progress.words[b.wordId].due <= today
  const picked = new Set([...eligible.filter(isDue), ...eligible.filter(b => !isDue(b))].slice(0, MAX_BLANKS))
  return eligible.filter(b => picked.has(b))
}

/** 候选词比空多几个。真题的选词填空一律给多,逼你排除。 */
export const DISTRACTOR_COUNT = 2

/**
 * 挑干扰词。三级降级,凑不满就少给 —— 少一个干扰词只是这篇稍微简单些,
 * 而拿一个与答案重复的选项出来是缺陷(与 quiz.ts 里 sharedSynonyms 要防的
 * 是同一类问题)。
 *
 * 1. `buildContrastPairs` 里与某个答案易混的已学词 —— 现成的易混词图
 * 2. 与某个答案主义项词性相同的已学词(词性不同的词在句子里根本不会打架)
 * 3. 任意已学词
 */
export function pickDistractors(
  answerIds: Set<string>,
  words: Word[],
  progress: Progress,
  pairs: ContrastPair[],
  count: number,
  rng: () => number,
): Word[] {
  const byId = new Map(words.map(w => [w.id, w]))
  const learned = (id: string): boolean => {
    const e = progress.words[id]
    return e !== undefined && e.state !== 'new'
  }

  const out: Word[] = []
  const taken = new Set(answerIds)

  const add = (id: string) => {
    if (out.length >= count || taken.has(id) || !learned(id)) return
    const w = byId.get(id)
    if (w === undefined) return
    taken.add(id)
    out.push(w)
  }

  for (const p of shuffle(pairs, rng)) {
    if (out.length >= count) break
    if (answerIds.has(p.a)) add(p.b)
    else if (answerIds.has(p.b)) add(p.a)
  }

  const poses = new Set<string>()
  for (const id of answerIds) {
    const pos = byId.get(id)?.meanings[0]?.pos
    if (pos !== undefined) poses.add(pos)
  }
  for (const w of shuffle(words, rng)) {
    if (out.length >= count) break
    if (poses.has(w.meanings[0]?.pos)) add(w.id)
  }

  for (const w of shuffle(words, rng)) {
    if (out.length >= count) break
    add(w.id)
  }

  return out
}
