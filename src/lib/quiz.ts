import type { Progress, Word } from '../types'

export type QuizType = 'word2meaning' | 'meaning2word' | 'spelling'

export interface QuizQuestion {
  type: QuizType
  wordId: string
  prompt: string
  options: string[]   // spelling 题为 []
  answer: string
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

export function generateQuiz(
  words: Word[],
  progress: Progress,
  count: number,
  rng: () => number = Math.random,
): QuizQuestion[] {
  const learned = words.filter(w => progress.words[w.id] && progress.words[w.id].state !== 'new')
  const pool = learned.length >= 4 ? learned : words
  if (pool.length < 4) return []

  const picked = shuffle(pool, rng).slice(0, Math.min(count, pool.length))
  const types: QuizType[] = ['word2meaning', 'meaning2word', 'spelling']

  return picked.map((w, i) => {
    const type = types[i % types.length]
    const distractors = shuffle(pool.filter(x => x.id !== w.id), rng).slice(0, 3)
    if (type === 'word2meaning') {
      return {
        type, wordId: w.id, prompt: w.headword,
        options: shuffle([w, ...distractors].map(meaningLabel), rng),
        answer: meaningLabel(w),
      }
    }
    if (type === 'meaning2word') {
      return {
        type, wordId: w.id, prompt: meaningLabel(w),
        options: shuffle([w, ...distractors].map(x => x.headword), rng),
        answer: w.headword,
      }
    }
    return {
      type, wordId: w.id,
      prompt: `${meaningLabel(w)}  ${w.phonetic}`,
      options: [], answer: w.headword,
    }
  })
}
