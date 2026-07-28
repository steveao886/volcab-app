import { buildContrastPairs } from './contrast'
import { headwordPattern } from './headword'
import type { Meaning, Progress, Word } from '../types'

export type QuizType =
  | 'word2meaning' | 'meaning2word' | 'spelling'
  | 'clozeExample' | 'clozeCollocation' | 'synonymHint'
  | 'contrast' | 'audio2meaning' | 'audio2spelling'

/**
 * 「综合」模式的轮换题型。
 *
 * **新增的 contrast / audio2* 刻意不在这里** —— 它们有各自的生成函数与各自的
 * 模式入口。混进综合模式会改变用户每天都走的那条路(而且音频题在静音环境里
 * 是道死题)。这个常量现在同时是 generateQuiz 的默认题型集与其合法取值域。
 */
export const QUIZ_TYPES: readonly QuizType[] = [
  'word2meaning', 'meaning2word', 'spelling',
  'clozeExample', 'clozeCollocation', 'synonymHint',
]

/** 听音模式轮换的两种题型:音→义、音→形。 */
export const AUDIO_TYPES: readonly QuizType[] = ['audio2meaning', 'audio2spelling']

export interface QuizQuestion {
  type: QuizType
  wordId: string
  /**
   * 题面文本。
   *
   * **音频题(audio2meaning / audio2spelling)例外:这里存的是要朗读的词头,
   * 渲染层绝不能把它显示出来** —— 显示了就是直接把答案印在题面上。渲染层见到
   * 这两种类型必须画播放按钮而不是文字。
   */
  prompt: string
  options: string[]   // spelling / audio2spelling 题为 []
  answer: string
  /** spelling 与 audio2spelling 题携带:释义与音标是两个独立字段,不再拼进 prompt
   *  字符串里 ——调用方（渲染层)不该靠正则从 prompt 里"抠"音标出来,那是在为一个
   *  拼接细节维护一份没人签字的隐性契约。
   *  audio2spelling **答题时不显示音标**(刚听过发音,再给 IPA 就没什么可考的),
   *  只在揭晓答案时显示。 */
  phonetic?: string
  /** 仅 synonymHint 题携带:提示词是近义还是反义,界面必须标明,
   *  否则用户无从判断该选意思相同的还是相反的。 */
  hintKind?: 'synonym' | 'antonym'
  /** 仅 contrast 题携带:对照词的 id。渲染层据此在揭晓答案后并排展示两个词的
   *  释义/例句/搭配 —— 那张对比卡才是辨析模式的真正价值。 */
  contrastId?: string
}

/**
 * 按义项占比抽一条释义。
 *
 * 原本这里写死 `w.meanings[0]`,后果是**次要义项永远不会被考到** —— `rhetoric`
 * 的「修辞学」、`mire` 的「泥沼」再也遇不到。按 share 加权之后,70% 的义项七成
 * 概率出场,30% 的三成,与真实语境里遇到它们的比例一致。
 *
 * 没有占比(单义词,或外部设备推来的未标注多义词)一律退回第一条:数据不全时
 * 不凭空随机,保持原有行为。半份占比(只有部分义项有 share)同样按不全处理 ——
 * 拿一份残缺的权重去抽,比不抽更糟。
 */
export function pickMeaning(w: Word, rng: () => number): Meaning {
  const ms = w.meanings
  if (ms.length === 1 || ms.some(m => m.share === undefined)) return ms[0]

  const total = ms.reduce((s, m) => s + (m.share ?? 0), 0)
  let r = rng() * total
  for (const m of ms) {
    r -= m.share ?? 0
    if (r < 0) return m
  }
  return ms[ms.length - 1] // 浮点误差兜底:rng 返回极接近 1 时可能一格都不触发
}

const meaningLabel = (m: Meaning) => `${m.pos} ${m.zh}`

const BLANK = '___'

/**
 * 把例句里的词头挖成空格。定位规则见 lib/headword.ts —— 挖空与复习卡上的高亮
 * 找的是同一个东西,共用一份实现。
 *
 * **同句里原形与变形必须一起挖掉**:留下任何一处都会直接泄题。这条以前没做到,
 * placate 的例句「to placate passengers…, which placated almost no one」只挖掉了
 * 原形,答案就明晃晃留在句子里。
 *
 * 定位不到返回 null —— 宁可跳过这条例句,也不出一道没有空格的挖空题。
 */
export function clozeExample(sentence: string, headword: string): string | null {
  const re = headwordPattern(sentence, headword)
  return re === null ? null : sentence.replace(re, BLANK)
}

/** 搭配挖空。规则与 clozeExample 相同,单列一个函数是因为搭配是短语、语义不同。 */
export function clozeCollocation(collocation: string, headword: string): string | null {
  return clozeExample(collocation, headword)
}

/**
 * 从若干候选句里**随机**挑一句能挖空的,一句都挑不出返回 null。
 *
 * **随机不是锦上添花。** 原本这里是「顺着数组取第一条能挖空的」,而几乎每个词的
 * `examples[0]` 都定位得到词头 —— 于是同一个词的挖空题面**永远是同一句**。
 * 实测拿真实进度跑 400 轮,63 个出过挖空题的词里**没有一个**出现过第二种题面,
 * 尽管 297/471 的词写了 3 句例句:写好的句子有三分之二从没被用过。
 */
export function pickCloze(sources: string[], headword: string, rng: () => number): string | null {
  for (const s of shuffle(sources, rng)) {
    const prompt = clozeExample(s, headword)
    if (prompt !== null) return prompt
  }
  return null
}

/**
 * 被一个以上词条共享的近义/反义词(全部小写)。
 *
 * 实测 1597 个同义词里有 228 个出现在多个词条(overbearing、decree、flexibility……)。
 * 拿它们当提示会出现「两个选项都对」,用户会判定测验有缺陷 —— 所以出题时必须排除。
 */
export function sharedSynonyms(words: Word[]): Set<string> {
  const count = new Map<string, number>()
  for (const w of words) {
    for (const s of [...w.synonyms, ...w.antonyms]) {
      const k = s.trim().toLowerCase()
      count.set(k, (count.get(k) ?? 0) + 1)
    }
  }
  return new Set([...count.entries()].filter(([, c]) => c > 1).map(([k]) => k))
}

export function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 按 labelFn 渲染后的显示文本去重收集干扰项,排除 w 自身与 answerLabel。
// 先从 pool 里找,不够 3 个再从全词库 fallback 补足;去重后仍不足 3 个则返回 null,
// 由调用方跳过该候选词——绝不允许输出带重复选项(或重复正确答案)的题目。
function pickDistractorLabels(
  w: Word,
  answerLabel: string,
  labelFn: (word: Word) => string,
  pool: Word[],
  fallback: Word[],
  rng: () => number,
): string[] | null {
  const seen = new Set<string>([answerLabel])
  const result: string[] = []

  const collect = (list: Word[]) => {
    for (const cand of shuffle(list.filter(x => x.id !== w.id), rng)) {
      if (result.length >= 3) break
      const label = labelFn(cand)
      if (seen.has(label)) continue
      seen.add(label)
      result.push(label)
    }
  }

  collect(pool)
  if (result.length < 3) collect(fallback)

  return result.length === 3 ? result : null
}

/** 出题的候选池:学过的词优先,不足 4 个就退回全词库。三个生成函数共用。 */
function questionPool(words: Word[], progress: Progress): Word[] | null {
  const learned = words.filter(w => progress.words[w.id] && progress.words[w.id].state !== 'new')
  const pool = learned.length >= 4 ? learned : words
  return pool.length < 4 ? null : pool
}

/**
 * @param types 轮换的题型,**必须是 `QUIZ_TYPES` 的子集** —— 函数体只处理那六种,
 *   contrast 与 audio2* 有各自的生成函数。极速模式靠这个参数把题型收窄到两种
 *   四选一(拼写题会拖垮 60 秒的节奏)。
 */
export function generateQuiz(
  words: Word[],
  progress: Progress,
  count: number,
  rng: () => number = Math.random,
  types: readonly QuizType[] = QUIZ_TYPES,
): QuizQuestion[] {
  const pool = questionPool(words, progress)
  if (pool === null) return []
  // 空题型列表要在这里挡住:下面 `types[questions.length % types.length]` 会得到
  // undefined,然后每个候选词都走到最后那个分支、生成一堆 type 为 undefined 的题。
  if (types.length === 0) return []

  // 共享词集合对全词库只算一次 —— 放进循环会变成 O(n²)
  const sharedSynonymsCache = sharedSynonyms(words)

  const candidates = shuffle(pool, rng)
  const questions: QuizQuestion[] = []

  for (let ci = 0; ci < candidates.length && questions.length < count; ci++) {
    const w = candidates[ci]
    const type = types[questions.length % types.length]

    if (type === 'spelling') {
      questions.push({
        type, wordId: w.id,
        prompt: meaningLabel(pickMeaning(w, rng)),
        options: [], answer: w.headword,
        phonetic: w.phonetic,
      })
      continue
    }

    const headwordLabel = (x: Word) => x.headword

    if (type === 'clozeExample' || type === 'clozeCollocation') {
      const sources = type === 'clozeExample' ? w.examples : w.collocations
      const prompt = pickCloze(sources, w.headword, rng)
      if (prompt === null) continue // 这条词的例句/搭配都定位不到词头,换下一个候选词
      const distractors = pickDistractorLabels(w, w.headword, headwordLabel, pool, words, rng)
      if (!distractors) continue
      questions.push({
        type, wordId: w.id, prompt,
        options: shuffle([w.headword, ...distractors], rng),
        answer: w.headword,
      })
      continue
    }

    if (type === 'synonymHint') {
      const shared = sharedSynonymsCache
      const syn = w.synonyms.find(s => !shared.has(s.trim().toLowerCase()))
      const ant = w.antonyms.find(s => !shared.has(s.trim().toLowerCase()))
      const hint = syn ?? ant
      if (hint === undefined) continue // 该词的近反义词全被共享,换下一个候选词
      const distractors = pickDistractorLabels(w, w.headword, headwordLabel, pool, words, rng)
      if (!distractors) continue
      questions.push({
        type, wordId: w.id, prompt: hint,
        options: shuffle([w.headword, ...distractors], rng),
        answer: w.headword,
        hintKind: syn !== undefined ? 'synonym' : 'antonym',
      })
      continue
    }

    // 这个词本次出场用哪条释义:按占比抽,不再写死 meanings[0]。
    const ownMeaning = meaningLabel(pickMeaning(w, rng))
    // 干扰项的释义同样按占比抽 —— 别让四个选项里三个都是别人的主流义、唯独正确
    // 答案是个冷僻义,那本身就成了一条题外线索。
    // pickDistractorLabels 已经把 w 自己排除在外(见其 collect 里的 filter),
    // **这一点不能改**:word2meaning 的题面只有词头,把 mire 的两个义项都放进选项
    // 就是两个都对,与 sharedSynonyms 要防的是同一类缺陷。
    const meaningOf = (x: Word) => meaningLabel(pickMeaning(x, rng))
    const labelFn = type === 'word2meaning' ? meaningOf : (x: Word) => x.headword
    const answer = type === 'word2meaning' ? ownMeaning : w.headword
    const distractors = pickDistractorLabels(w, answer, labelFn, pool, words, rng)
    if (!distractors) continue // 干扰项不足 3 个去重后仍不够,跳过该词,换下一个候选词补位

    questions.push({
      type, wordId: w.id,
      prompt: type === 'word2meaning' ? w.headword : ownMeaning,
      options: shuffle([answer, ...distractors], rng),
      answer,
    })
  }

  return questions
}

/**
 * 辨析题的紧密度门槛。
 *
 * 2 分以下都是「共享一个近义词、其余毫无关系」的杂质:`promulgate` 与
 * `metastasize` 共享 `disseminate`,但一个是颁布法令、一个是癌细胞扩散,摆成
 * 二选一是送分题。实测 476 词里 3 分及以上有 140 对,够出题了。
 */
export const CONTRAST_MIN_SCORE = 3

/**
 * 一道辨析题:挖掉 `answer` 例句里的词头,让用户在 answer / other 之间二选一。
 * 出不来返回 null,由调用方换一边或换一对。
 */
function contrastQuestion(answer: Word, other: Word, rng: () => number): QuizQuestion | null {
  // 与 pickCloze 一样先打乱 —— 顺着取第一条会让同一对词的题面永远是同一句。
  // 这里没直接用 pickCloze,是因为多一道「对方词头不能留在句子里」的过滤。
  for (const s of shuffle(answer.examples, rng)) {
    const prompt = clozeExample(s, answer.headword)
    if (prompt === null) continue
    // **对方的词头不能留在句子里**:两个候选词同时出现在题面上,这题就没得选了
    // (「We alpha and bravo together」挖掉 alpha,bravo 还在,答案不言自明)。
    // 用与挖空同一套定位规则,连变形一起挡 —— 宁可跳过这条例句。
    if (headwordPattern(prompt, other.headword) !== null) continue
    return {
      type: 'contrast',
      wordId: answer.id,
      prompt,
      options: shuffle([answer.headword, other.headword], rng),
      answer: answer.headword,
      contrastId: other.id,
    }
  }
  return null
}

/**
 * 辨析模式出题:从易混词对里抽,**两个选项**,靠搭配与语境判断。
 *
 * 高阶词汇真正的难点不是「认识」,是「知道该用哪个」—— 这是现有六种题型完全没
 * 覆盖的一块,而数据(近义词重叠)一直躺在词库里。
 */
export function generateContrastQuiz(
  words: Word[],
  progress: Progress,
  count: number,
  rng: () => number = Math.random,
): QuizQuestion[] {
  const all = buildContrastPairs(words)
  if (all.length === 0) return []

  const isLearned = (id: string) => {
    const e = progress.words[id]
    return e !== undefined && e.state !== 'new'
  }

  // **两个词都学过才出题**,与综合/听音靠 questionPool 硬过滤是同一条规矩。
  //
  // 原本这里只是把「都学过」的排到前面 —— **排序不是保证**:实测用户 63 个已学词
  // 在 471 词的库里只配得出 7 对,排完就掉进未学词,53.7% 的题考的是从没见过的词
  // (同一份进度下综合与听音都是 0%)。辨析考的是「该用哪个」,拿两个没学过的词
  // 问这个问题没有意义。
  //
  // **没有「学过的词配不出对就退回全库」这条兜底**,这是刻意的。曾经写过一版,
  // 结果正是用户报的那个问题:学了 20 个词、恰好一对都没凑出来时,整轮题全是
  // 没见过的词。空模式不是故障 —— 它有一句说明告诉你为什么(见 Quiz.tsx 的
  // EMPTY_HINT.contrast);而超纲题是在默默浪费时间,还会让人不再信任整个测验。
  const base = all.filter(p => isLearned(p.a) && isLearned(p.b))
  const tight = base.filter(p => p.score >= CONTRAST_MIN_SCORE)
  // 紧密对不够一轮时退回这批词里的全部词对 —— 松一点的**学过的**词对,
  // 好过紧密但没学过的。
  const pool = tight.length >= count ? tight : base

  const byId = new Map(words.map(w => [w.id, w]))

  const questions: QuizQuestion[] = []
  for (const pair of shuffle(pool, rng)) {
    if (questions.length >= count) break
    const wa = byId.get(pair.a)
    const wb = byId.get(pair.b)
    if (wa === undefined || wb === undefined) continue
    // 哪个词当答案随机,否则字典序在前的那个永远是答案 —— 用户会学会这条规律
    const [first, second] = rng() < 0.5 ? [wa, wb] : [wb, wa]
    const q = contrastQuestion(first, second, rng) ?? contrastQuestion(second, first, rng)
    if (q !== null) questions.push(q)
  }
  return questions
}

/**
 * 听音模式出题:音→义 与 音→形 轮换。
 *
 * `prompt` 存的是**要朗读的词头**,不是给人看的题面 —— 见 QuizQuestion.prompt 的注释。
 */
export function generateAudioQuiz(
  words: Word[],
  progress: Progress,
  count: number,
  rng: () => number = Math.random,
): QuizQuestion[] {
  const pool = questionPool(words, progress)
  if (pool === null) return []

  const candidates = shuffle(pool, rng)
  const questions: QuizQuestion[] = []

  for (let ci = 0; ci < candidates.length && questions.length < count; ci++) {
    const w = candidates[ci]
    const type = AUDIO_TYPES[questions.length % AUDIO_TYPES.length]

    if (type === 'audio2spelling') {
      questions.push({
        type, wordId: w.id,
        prompt: w.headword,
        options: [], answer: w.headword,
        phonetic: w.phonetic,
      })
      continue
    }

    const answer = meaningLabel(pickMeaning(w, rng))
    const distractors = pickDistractorLabels(w, answer, x => meaningLabel(pickMeaning(x, rng)), pool, words, rng)
    if (!distractors) continue
    questions.push({
      type, wordId: w.id,
      prompt: w.headword,
      options: shuffle([answer, ...distractors], rng),
      answer,
    })
  }

  return questions
}
