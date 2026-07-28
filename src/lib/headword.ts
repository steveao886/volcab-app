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
 * **不走 headwordPattern 的松散退路。** 那条退路(`stem + [a-z]*`)是为了在
 * 一整句话里定位得到词头而存在的,校验单个词时它会把 `reference` 判成
 * `refute` 的变形、把 `mirth` 判成 `mire` 的变形。校验时候选只有一个词,没有
 * 「定位不到就漏题」的压力,该用严格的词尾枚举。
 *
 * **比 tightPattern 宽,这是故意的。** tightPattern 要在一整句话里扫,base
 * 选错一个字就可能连带命中句子里别的无关词;这里只拿一个已知词头去核对
 * 一个候选词,没有「扫描整句」的误伤半径,所以能多试三种候选 base,只要
 * 任意一种拼出 `base + SUFFIX` 能等于 surface 就算数:
 *
 * 1. 词头本身,不做任何裁剪 —— 补上 `-ly` 接在以 e 结尾的词头后面的写法
 *    (profuse→profusely、unobtrusive→unobtrusively:SUFFIX 里本来就有
 *    `ly`,只是旧代码先把词头的 e 砍掉,`profus`+`ly` 拼不出 `profusely`),
 *    以及词头以「元音+y」结尾时 y 不该被砍的写法(convey→conveyed/conveys,
 *    砍成 `conve` 后这两个原本永远匹配不上)。
 * 2. 词头去掉结尾的 e/y(原有规则)—— 保 refuted、ratified。
 * 3. 词头末尾双写辅音,仅当词头以「辅音+元音+辅音」结尾且末尾辅音不是
 *    w/x/y(标准英语双写条件)—— 补 manumit→manumitted、concur→concurred、
 *    extol→extolled/extolling。限制这个条件是为了不给不会双写的词凭空
 *    发明一个 base。
 *
 * 实测(全库 471 词,拿 splitByHeadword 从每个词自己的例句里取出真实出现
 * 的变形,共 2356 处):补三条 base 之前 18 处被判定不是屈折变形,其中 13 处
 * 是**真变形被冤枉**(去重后 6 个组合:manumit→manumitted、concur→concurred、
 * extol→extolled/extolling、profuse→profusely、unobtrusive→unobtrusively)。
 * manumit 尤其致命 —— 它的原形从没在自己的例句里出现过,5 句全军覆没,
 * 校验脚本会判这个词完全不可用。
 *
 * 补完之后被拒的只剩 5 处,而那 5 处恰恰是 headwordPattern 松散退路造成的
 * 真误标(preside→president、sapient→sapiens、indict→industry、allude→all、
 * introspection→introspective)—— 它们**本来就该被拒**,新规则没跟着放宽,
 * 双写的 CVC 限制也没让它们的词干拼出这些词。
 * 471×470 词头两两组合全扫过,假阳性精确 1 处(precipitous ← precipitously),
 * 而那一对本就是同源的形容词/副词,判 true 没问题。
 *
 * SUFFIX 和 tightPattern 都没动:两者是共用的,tightPattern 还要负责整句
 * 扫描时挖空 / 高亮选谁,放宽它会静默改变全站的挖空效果;这里只做单词对
 * 单词的一次性校验,双写辅音这类规则放在这儿足够安全,放到 tightPattern
 * 就不一定了。
 *
 * 只给写入端的校验脚本用(scripts/validate-passages.ts)。
 */
export function isInflectionOf(surface: string, headword: string): boolean {
  const s = surface.trim().toLowerCase()
  const h = headword.trim().toLowerCase()
  if (s === '' || h === '') return false
  if (s === h) return true

  const bases = [h]
  if (/[ey]$/.test(h)) bases.push(h.slice(0, -1))
  if (/[^aeiou][aeiou][^aeiouwxy]$/.test(h)) bases.push(h + h.slice(-1))

  return bases.some(base => new RegExp(`^${escapeRe(base)}${SUFFIX}$`, 'i').test(s))
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
