/**
 * 在句子里定位词头(含屈折变形)。
 *
 * 这套算法原本长在 quiz.ts 的挖空题里,是那边实测出来的:476 词的例句中 86%
 * 含词头原形,14% 只含变形(concocted / concocting),0% 完全定位不到 ——
 * 只做全词匹配会漏掉 68 个词。既然挖空和高亮找的是同一个东西,就不该有两份实现。
 */

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 英语屈折词尾。枚举而不是 `[a-z]*`,理由见 tightPattern。 */
const SUFFIX = '(?:e|y|s|d|es|ed|ly|ies|ied|ing|ying|ings|ers|er|est)?'

/**
 * 原形在场时用的紧规则:词头去掉结尾的 e/y,后面只允许接一个真实的屈折词尾。
 *
 * 为什么不用 `[a-z]*` 或 `[a-z]{0,3}`:
 * - `mire` 的词干 `mir` 会命中 **mirth**;
 * - `officiate` 的词干会命中 **officials**;
 * - `dystrophy` 会命中 **dystrophin**。
 * 枚举词尾把这些全挡掉。实测全库 476 词 / 1251 处标记,换成枚举后**零丢失、
 * 零误伤、只多标 1 处** —— 那 1 处正是下面要说的漏题。
 *
 * 构造上保证它一定能匹配原形本身(base 至多去掉一个 e/y,词尾集合含 e、y 与空)。
 */
const tightPattern = (h: string): RegExp => {
  const base = /[ey]$/.test(h) ? h.slice(0, -1) : h
  return new RegExp(`\\b${escapeRe(base)}${SUFFIX}\\b`, 'gi')
}

/**
 * 返回能匹配句中全部出现位置的 global 正则;定位不到返回 null。
 *
 * 两段:
 * 1. **原形在场** → 用紧规则,原形与它的屈折变形一起命中。
 *    这一段是为了修一个真实的漏题:placate 的例句是
 *    「to placate passengers…, which **placated** almost no one」,
 *    原本只挖掉原形,变形还留在句子里,答案直接白给 —— 正是 quiz.ts 里
 *    「同句多次出现全部挖掉」那条注释要防的情况,只是它没防住变形。
 * 2. **只有变形**(实测占 14%,如 concocted / concocting)→ 退回松散词干,
 *    保住 100% 的定位覆盖率。松散规则会误伤,但它只在原形缺席时才走,
 *    实测在全库上一次都没有真的误伤。
 */
export function headwordPattern(sentence: string, headword: string): RegExp | null {
  const h = headword.trim().toLowerCase()
  if (h === '') return null

  // test() 带 g 会推进 lastIndex,所以探测与返回各用一个正则对象,互不干扰
  if (new RegExp(`\\b${escapeRe(h)}\\b`, 'i').test(sentence)) return tightPattern(h)

  const stem = h.length > 5 ? h.slice(0, h.length - 3) : h
  const loose = new RegExp(`\\b${escapeRe(stem)}[a-z]*\\b`, 'gi')
  return loose.test(sentence) ? new RegExp(loose.source, 'gi') : null
}

/**
 * `surface` 是不是 `headword` 的一个屈折变形。
 *
 * **只用紧规则,不走 headwordPattern 的松散退路。** 那条退路(`stem + [a-z]*`)
 * 是为了在一整句话里定位得到词头而存在的,校验单个词时它会把 `reference` 判成
 * `refute` 的变形、把 `mirth` 判成 `mire` 的变形。校验时候选只有一个词,没有
 * 「定位不到就漏题」的压力,该用严格的词尾枚举。
 *
 * 只给写入端的校验脚本用(scripts/validate-passages.ts)。
 */
export function isInflectionOf(surface: string, headword: string): boolean {
  const s = surface.trim().toLowerCase()
  const h = headword.trim().toLowerCase()
  if (s === '' || h === '') return false
  if (s === h) return true
  const base = /[ey]$/.test(h) ? h.slice(0, -1) : h
  return new RegExp(`^${escapeRe(base)}${SUFFIX}$`, 'i').test(s)
}

export interface Segment { text: string; hit: boolean }

/**
 * 把句子按词头切成片段,`hit` 标出命中的那些,供渲染层包 <mark>。
 * 定位不到就返回整句一个片段(hit=false)—— 高亮是锦上添花,不该因为定位失败
 * 就不显示例句。
 */
export function splitByHeadword(sentence: string, headword: string): Segment[] {
  const re = headwordPattern(sentence, headword)
  if (re === null) return [{ text: sentence, hit: false }]

  const out: Segment[] = []
  let last = 0
  for (const m of sentence.matchAll(re)) {
    if (m.index > last) out.push({ text: sentence.slice(last, m.index), hit: false })
    out.push({ text: m[0], hit: true })
    last = m.index + m[0].length
  }
  if (last < sentence.length) out.push({ text: sentence.slice(last), hit: false })
  return out
}
