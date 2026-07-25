import { describe, expect, it } from 'vitest'
import { generateQuiz } from './quiz'
import { emptyProgress } from '../types'
import type { Progress, Word } from '../types'

const word = (id: string, zh: string): Word => ({
  id, headword: id, phonetic: `/${id}/`, meanings: [{ pos: 'v.', en: `def of ${id}`, zh }],
  examples: ['a', 'b'], synonyms: [], antonyms: [], collocations: [], relatedForms: [], sourceNote: 't', addedAt: '2026-07-01',
})
const words = [word('alpha', '甲'), word('bravo', '乙'), word('carol', '丙'), word('delta', '丁'), word('echo', '戊'), word('fox', '己')]

const studied = (): Progress => {
  const p = emptyProgress()
  for (const w of words) {
    p.words[w.id] = { state: 'review', ease: 2.5, intervalDays: 3, due: '2026-08-01', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-20T00:00:00Z' }
  }
  return p
}
const seq = () => { let i = 0; return () => ((i = (i + 7) % 13), i / 13) }

const wordP = (id: string, pos: string, zh: string): Word => ({
  id, headword: id, phonetic: `/${id}/`, meanings: [{ pos, en: `def of ${id}`, zh }],
  examples: ['a', 'b'], synonyms: [], antonyms: [], collocations: [], relatedForms: [], sourceNote: 't', addedAt: '2026-07-01',
})

describe('generateQuiz', () => {
  it('生成指定数量,题型轮换,不重复选词', () => {
    const qs = generateQuiz(words, studied(), 6, seq())
    expect(qs).toHaveLength(6)
    expect(new Set(qs.map(q => q.wordId)).size).toBe(6)
    expect(new Set(qs.map(q => q.type)).size).toBe(3)
  })
  it('选择题 4 个选项且含正确答案,选项不重复', () => {
    const qs = generateQuiz(words, studied(), 6, seq())
    for (const q of qs.filter(q => q.type !== 'spelling')) {
      expect(q.options).toHaveLength(4)
      expect(new Set(q.options).size).toBe(4)
      expect(q.options).toContain(q.answer)
    }
  })
  it('拼写题无选项,答案为词头', () => {
    const qs = generateQuiz(words, studied(), 6, seq())
    const sp = qs.find(q => q.type === 'spelling')!
    expect(sp.options).toEqual([])
    expect(sp.answer).toBe(sp.wordId)
  })
  it('已学词不足 4 个时回退用全词库', () => {
    const qs = generateQuiz(words, emptyProgress(), 4, seq())
    expect(qs).toHaveLength(4)
  })
  it('词库不足 4 个时返回空', () => {
    expect(generateQuiz(words.slice(0, 3), emptyProgress(), 5, seq())).toEqual([])
  })
  it('拼写题携带独立的 phonetic 字段,prompt 不再拼接音标', () => {
    const qs = generateQuiz(words, studied(), 6, seq())
    const sp = qs.find(q => q.type === 'spelling')!
    const w = words.find(x => x.id === sp.wordId)!
    expect(sp.phonetic).toBe(w.phonetic)
    expect(sp.prompt).not.toContain(w.phonetic)
  })
  it('选择题不携带 phonetic 字段', () => {
    const qs = generateQuiz(words, studied(), 6, seq())
    for (const q of qs.filter(q => q.type !== 'spelling')) {
      expect(q.phonetic).toBeUndefined()
    }
  })
  it('干扰项按显示文本去重,近义词共享释义时不出现重复选项或重复正确答案', () => {
    // abolish/rescind 共享同一 meaningLabel("v. 废除")。只学习前 4 个词(含这对近义词 +
    // 2 个不同释义的词),使已学词池里非碰撞候选不足 3 个,必须从全词库(含未学的
    // delta/echo)补足干扰项,才能凑出 4 个互不相同的选项。
    const collisionWords = [
      wordP('abolish', 'v.', '废除'),
      wordP('rescind', 'v.', '废除'), // 与 abolish 共享同一 meaningLabel
      wordP('bravo', 'n.', '乙'),
      wordP('carol', 'n.', '丙'),
      wordP('delta', 'n.', '丁'),
      wordP('echo', 'n.', '戊'),
    ]
    const p = emptyProgress()
    for (const w of collisionWords.slice(0, 4)) {
      p.words[w.id] = { state: 'review', ease: 2.5, intervalDays: 3, due: '2026-08-01', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-20T00:00:00Z' }
    }
    const zeroRng = () => 0
    for (const count of [1, 2, 3, 4]) {
      const qs = generateQuiz(collisionWords, p, count, zeroRng)
      for (const q of qs.filter(q => q.type !== 'spelling')) {
        expect(new Set(q.options).size).toBe(4)
        expect(q.options.filter(o => o === q.answer).length).toBe(1)
      }
    }
  })
})
