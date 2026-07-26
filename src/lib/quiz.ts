import type { Meaning, Progress, Word } from '../types'

export type QuizType =
  | 'word2meaning' | 'meaning2word' | 'spelling'
  | 'clozeExample' | 'clozeCollocation' | 'synonymHint'

export const QUIZ_TYPES: readonly QuizType[] = [
  'word2meaning', 'meaning2word', 'spelling',
  'clozeExample', 'clozeCollocation', 'synonymHint',
]

export interface QuizQuestion {
  type: QuizType
  wordId: string
  prompt: string
  options: string[]   // spelling 题为 []
  answer: string
  /** 仅 spelling 题携带:释义与音标是两个独立字段,不再拼进 prompt 字符串里
   *  ——调用方（渲染层)不该靠正则从 prompt 里"抠"音标出来,那是在为一个
   *  拼接细节维护一份没人签字的隐性契约。 */
  phonetic?: string
  /** 仅 synonymHint 题携带:提示词是近义还是反义,界面必须标明,
   *  否则用户无从判断该选意思相同的还是相反的。 */
  hintKind?: 'synonym' | 'antonym'
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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 把例句里的词头挖成空格。
 *
 * 实测 476 词中 86% 的例句含词头原形,14% 只含变形(concocted / concocting),
 * 0% 完全定位不到 —— 所以必须同时处理变形,只做全词匹配会漏掉 68 个词。
 * 做法:取词干(去掉尾部至多 3 个字母)后允许跟任意字母后缀。
 *
 * 同句多次出现全部挖掉:留下任何一处都会直接泄题。
 * 定位不到返回 null —— 宁可跳过这条例句,也不出一道没有空格的挖空题。
 */
export function clozeExample(sentence: string, headword: string): string | null {
  const h = headword.trim().toLowerCase()
  const exact = new RegExp(`\\b${escapeRe(h)}\\b`, 'gi')
  if (exact.test(sentence)) return sentence.replace(exact, BLANK)

  // 变形:词干 + 任意字母后缀。短词不截断,避免 "act" 命中 "action" 一类误伤。
  const stem = h.length > 5 ? h.slice(0, h.length - 3) : h
  const inflected = new RegExp(`\\b${escapeRe(stem)}[a-z]*\\b`, 'gi')
  if (inflected.test(sentence)) return sentence.replace(inflected, BLANK)

  return null
}

/** 搭配挖空。规则与 clozeExample 相同,单列一个函数是因为搭配是短语、语义不同。 */
export function clozeCollocation(collocation: string, headword: string): string | null {
  return clozeExample(collocation, headword)
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

export function generateQuiz(
  words: Word[],
  progress: Progress,
  count: number,
  rng: () => number = Math.random,
): QuizQuestion[] {
  const learned = words.filter(w => progress.words[w.id] && progress.words[w.id].state !== 'new')
  const pool = learned.length >= 4 ? learned : words
  if (pool.length < 4) return []

  // 共享词集合对全词库只算一次 —— 放进循环会变成 O(n²)
  const sharedSynonymsCache = sharedSynonyms(words)

  const types = QUIZ_TYPES
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
      let prompt: string | null = null
      for (const s of sources) {
        prompt = clozeExample(s, w.headword)
        if (prompt !== null) break
      }
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
