import type { Progress, Word } from '../types'

export type QuizType = 'word2meaning' | 'meaning2word' | 'spelling'

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
}

const meaningLabel = (w: Word) => {
  const m = w.meanings[0]
  return `${m.pos} ${m.zh}`
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

  const types: QuizType[] = ['word2meaning', 'meaning2word', 'spelling']
  const candidates = shuffle(pool, rng)
  const questions: QuizQuestion[] = []

  for (let ci = 0; ci < candidates.length && questions.length < count; ci++) {
    const w = candidates[ci]
    const type = types[questions.length % types.length]

    if (type === 'spelling') {
      questions.push({
        type, wordId: w.id,
        prompt: meaningLabel(w),
        options: [], answer: w.headword,
        phonetic: w.phonetic,
      })
      continue
    }

    const labelFn = type === 'word2meaning' ? meaningLabel : (x: Word) => x.headword
    const answer = labelFn(w)
    const distractors = pickDistractorLabels(w, answer, labelFn, pool, words, rng)
    if (!distractors) continue // 干扰项不足 3 个去重后仍不够,跳过该词,换下一个候选词补位

    questions.push({
      type, wordId: w.id,
      prompt: type === 'word2meaning' ? w.headword : meaningLabel(w),
      options: shuffle([answer, ...distractors], rng),
      answer,
    })
  }

  return questions
}
