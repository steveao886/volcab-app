/**
 * 短文选词填空的出题逻辑。全部纯函数 —— 渲染层只负责把这里算出来的结果画出来。
 *
 * 设计见 docs/superpowers/specs/2026-07-28-passage-cloze-design.md
 */

import type { Progress, Word } from '../types'
import { buildContrastPairs } from './contrast'
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
  /**
   * 绝不能当这篇干扰词的词 id。
   *
   * 干扰词来自易混词图,而那张图是**按共享近义词**建的 —— 它天然会端出
   * 「填进去也对」的词。2a 的 direct 过滤挡掉了词典级别的同义(substantiate
   * 之于 corroborate),但挡不住只共享近义词、语义却照样贴合的那种
   * (antipathy 之于 animosity、slacken 之于 abate:实测这两个各自出现在
   * 24.8% / 17.8% 的题里,而且句子读起来完全成立)。
   *
   * 这一小撮只能靠人眼:某个词能不能填进这篇的某个空,是读出来的,不是算出来的。
   * 好在候选池是**可穷举的** —— 一篇的干扰词只可能来自它标记词在易混词图上的
   * 邻居,实测两篇分别是 8 个和 12 个词。校验脚本会把这个池子打印出来给作者过目。
   */
  exclude?: string[]
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
 *
 * **导出给 scripts/validate-passages.ts 用。** 那边曾经抄了一份一模一样的字面量,
 * 而「匹配不上就等于畸形」这条行为完全依赖这个 pattern 的确切写法 —— 抄两份等于
 * 让闸门和读取端各自解释一次「什么算标记」,改一处漏一处就是漏掉一整类坏数据。
 * 跨 src/ 与 scripts/ 引用是既有做法(那边已经在 import isInflectionOf)。
 */
export const MARKER = /\{\{([^{}|]+)(?:\|([^{}|]+))?\}\}/g

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
 *
 * **超过 `MAX_BLANKS` 时组内先打乱再截断。** 原本这里是 `[...due, ...notDue]`
 * 直接 slice —— 一刀切在固定的位置上,砍掉的永远是同几个词。实测两篇各跑 200 个
 * 种子,committee-report 只出过 7 个答案词、`ratify` **一次都没被挖过**,
 * sweltering-commute 同样从没挖过 `abate`:语料里标了、校验也过了的词,永远
 * 考不到。这与 quiz.ts 的 pickCloze 那条(同一个词的挖空题面永远是同一句,
 * 实测 63 个词 0 个第二种题面)是同一类缺陷 —— 顺着数组取,取到的永远是同一批。
 *
 * 打乱只发生在**组内**:到期的仍然整组排在未到期的前面,复习优先级不受影响。
 * 截断之后本来就会按正文顺序还原,渲染顺序也不受影响。
 */
export function selectBlanks(
  sentences: Token[][],
  words: Map<string, Word>,
  progress: Progress,
  today: string,
  rng: () => number,
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
  const picked = new Set([
    ...shuffle(eligible.filter(isDue), rng),
    ...shuffle(eligible.filter(b => !isDue(b)), rng),
  ].slice(0, MAX_BLANKS))
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
 *
 * @param excludeIds 除答案外还必须排除的词 id。**这不是可有可无的洁癖**:
 *   一篇标记了 8 个词、`MAX_BLANKS` 只挖 7 个,那第 8 个词是**原样印在正文里**的
 *   ——它当干扰词时用户扫一眼正文就划掉了,两个干扰词白白废掉一个,而且看着像 bug。
 *   实测 committee-report 的 `ratify` 正是这种情况:N=471 已学词时 24.5% 的题里
 *   它当了干扰词,N=200 时 50.7%,N=100 时 100%。没学过的标记词同理(它不够格
 *   被挖空,却照样印在正文里)。
 * @param byId `words` 的 id 索引,由调用方传入。`buildPassageQuestion` 已经对
 *   同一份词表建过一遍,这里再建一遍是白建。
 */
export function pickDistractors(
  answerIds: Set<string>,
  excludeIds: Set<string>,
  words: Word[],
  byId: Map<string, Word>,
  progress: Progress,
  pairs: ContrastPair[],
  count: number,
  rng: () => number,
): Word[] {
  const learned = (id: string): boolean => {
    const e = progress.words[id]
    return e !== undefined && e.state !== 'new'
  }

  const out: Word[] = []
  const taken = new Set([...answerIds, ...excludeIds])

  const add = (id: string) => {
    if (out.length >= count || taken.has(id) || !learned(id)) return
    const w = byId.get(id)
    if (w === undefined) return
    taken.add(id)
    out.push(w)
  }

  for (const p of shuffle(pairs, rng)) {
    if (out.length >= count) break
    // **direct 的一律不要。** `direct` 的含义是一方把另一方的词头写进了自己的
    // synonyms —— 那是词典级别的「这俩是一个意思」,正是绝不能拿来当错误选项的
    // 东西。实测 committee-report 的 corroborate/substantiate 就是这样一对:
    // 「no independent team could substantiate」既是通顺英文,意思也完全对,
    // 26.6% 的题里它当了干扰词,用户会判定这题两个答案都对。
    //
    // 这只是**部分修复**:direct 只覆盖词典写死的同义,挡不住「只共享近义词、
    // 语义却照样贴合」的那种(animosity/antipathy 共享 hostility、abate/slacken
    // 共享 ease)。实测 committee-report 的歧义率从 45.4% 降到约 24.8%,剩下的
    // 那批分数与安全的干扰词完全重合(disputatious 4 分是安全的,antipathy
    // 2 分是歧义的,而 2 分里大多数安全)—— 没有阈值能把它们分开,只能靠
    // `Passage.exclude` 人工点名。
    if (p.direct) continue
    if (answerIds.has(p.a)) add(p.b)
    else if (answerIds.has(p.b)) add(p.a)
  }

  // **降级前先看还缺不缺。** 这两级各要 `shuffle` 一遍全词库,而 `shuffle` 是
  // Fisher-Yates:471 个词就是 470 次 rng。原本无条件求值,实测一道题一共消耗
  // 1268 次 rng,其中 940 次(74%)出自这两个 shuffle —— 而一级候选绝大多数
  // 时候就把名额填满了,那 940 次抽出来的结果一个都用不上。
  // 加上早退之后实测:N=471 已学词 387.5 次/题,N=100 时 586.5,N=50 时 798
  // ——已学词越多、一级候选越容易填满,这两级动用得越少。
  if (out.length < count) {
    const poses = new Set<string>()
    for (const id of answerIds) {
      const pos = byId.get(id)?.meanings[0]?.pos
      if (pos !== undefined) poses.add(pos)
    }
    for (const w of shuffle(words, rng)) {
      if (out.length >= count) break
      if (poses.has(w.meanings[0]?.pos)) add(w.id)
    }
  }

  if (out.length < count) {
    for (const w of shuffle(words, rng)) {
      if (out.length >= count) break
      add(w.id)
    }
  }

  return out
}

/** 候选词。`wordId` 用来判分,`headword` 用来显示 —— 两者不一定相同。 */
export interface Choice { wordId: string; headword: string }

export interface PassageQuestion {
  passage: Passage
  sentences: Token[][]
  /** 按正文出现顺序 */
  blanks: Blank[]
  /** 已打乱 */
  choices: Choice[]
}

/**
 * 把一篇短文组装成一道题。出不来(解析失败 / 可挖空不足)返回 null,
 * 由调用方换下一篇。
 */
export function buildPassageQuestion(
  passage: Passage,
  words: Word[],
  progress: Progress,
  today: string,
  pairs: ContrastPair[],
  rng: () => number,
): PassageQuestion | null {
  const sentences = parsePassage(passage)
  if (sentences === null) return null

  const byId = new Map(words.map(w => [w.id, w]))
  const blanks = selectBlanks(sentences, byId, progress, today, rng)
  if (blanks.length < MIN_BLANKS) return null

  const answerIds = new Set(blanks.map(b => b.wordId))
  // 正文里出现过的标记词全都不能当干扰词 —— 不只是被挖成空的那些。没挖成空的
  // 标记词(超出 MAX_BLANKS 的、或者还没学过的)是**原样印在正文里**的。
  // 再并上作者人工点名的 exclude(见 Passage.exclude):算不出来的那一小撮歧义词。
  const excluded = new Set<string>(passage.exclude)
  for (const tokens of sentences) {
    for (const t of tokens) if (t.kind === 'word') excluded.add(t.wordId)
  }
  const distractors = pickDistractors(answerIds, excluded, words, byId, progress, pairs, DISTRACTOR_COUNT, rng)

  const choices = shuffle<Choice>(
    [
      ...blanks.map(b => ({ wordId: b.wordId, headword: byId.get(b.wordId)!.headword })),
      ...distractors.map(w => ({ wordId: w.id, headword: w.headword })),
    ],
    rng,
  )

  return { passage, sentences, blanks, choices }
}

/** 到期词的权重高于已学未到期 —— 这题首先是复习工具,其次才是阅读。 */
export const DUE_WEIGHT = 3
export const LEARNED_WEIGHT = 1
/**
 * 最近做过的惩罚。**刻意压过「多一个到期词」(+3)**:宁可换一篇覆盖略差的新
 * 短文,也别连着做同一篇 —— 第二次做时你记住的是上次的答案,不是词。
 */
export const RECENT_PENALTY = 5
/** 「最近做过」记多少篇。存 localStorage,不进 progress.json。 */
export const RECENT_LIMIT = 10

export function scoreQuestion(
  q: PassageQuestion,
  progress: Progress,
  today: string,
  recentIds: string[],
): number {
  let s = 0
  for (const b of q.blanks) {
    s += progress.words[b.wordId].due <= today ? DUE_WEIGHT : LEARNED_WEIGHT
  }
  return recentIds.includes(q.passage.id) ? s - RECENT_PENALTY : s
}

/**
 * 挑一篇今天最该做的短文。一篇都出不来返回 null(由调用方给空状态文案)。
 *
 * `buildContrastPairs` 对全词库只算一次 —— 放进循环就是每篇重算一遍倒排索引。
 *
 * **每篇都完整组装一遍再打分,这是有意的**:打分要数到期词,而到期词就是
 * `selectBlanks` 的产物,先打分再组装等于把选空逻辑抄一份出来。实测这台机器上
 * 30 篇 3.7 ms、200 篇 18.0 ms(30 篇是近期语料规模,200 篇是规划规模),
 * 都在一次点击的噪声里。语料再涨过 200 篇就该改成「先算轻量分、只组装最高分的
 * 那几篇」—— 到那时再改,现在改是拿可读性换看不见的收益。
 */
export function pickPassage(
  passages: Passage[],
  words: Word[],
  progress: Progress,
  today: string,
  recentIds: string[],
  rng: () => number = Math.random,
): PassageQuestion | null {
  const pairs = buildContrastPairs(words)
  let best: PassageQuestion | null = null
  let bestScore = -Infinity
  // 先打乱:同分时取先遇到的那篇,不打乱就永远是数组里靠前的那几篇
  for (const p of shuffle(passages, rng)) {
    const q = buildPassageQuestion(p, words, progress, today, pairs, rng)
    if (q === null) continue
    const s = scoreQuestion(q, progress, today, recentIds)
    if (s > bestScore) {
      bestScore = s
      best = q
    }
  }
  return best
}

/** 把 id 推到「最近做过」的最前面,超过上限砍掉最旧的。 */
export function pushRecent(recent: string[], id: string, limit = RECENT_LIMIT): string[] {
  return [id, ...recent.filter(x => x !== id)].slice(0, limit)
}
