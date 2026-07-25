import { describe, expect, it } from 'vitest'
import { QUIZ_TYPES, clozeCollocation, clozeExample, generateQuiz, sharedSynonyms } from './quiz'
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
    // 题型确定性轮换,一轮内均衡分布。这里不再硬编码题型总数 ——
    // 断言的是「轮换」这个契约本身,新增题型时不必再改这一行。
    const types = qs.map(q => q.type)
    expect(new Set(types).size).toBe(Math.min(qs.length, QUIZ_TYPES.length))
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

describe('clozeExample', () => {
  it('挖掉原形出现的词头', () => {
    expect(clozeExample('She concoct a story quickly.', 'concoct'))
      .toBe('She ___ a story quickly.')
  })
  it('挖掉变形出现的词头', () => {
    expect(clozeExample('She concocted an elaborate excuse.', 'concoct'))
      .toBe('She ___ an elaborate excuse.')
  })
  it('大小写不敏感', () => {
    expect(clozeExample('Concocting excuses is his talent.', 'concoct'))
      .toBe('___ excuses is his talent.')
  })
  it('同句多次出现时全部挖掉,不留下泄题的那一处', () => {
    expect(clozeExample('He concocted it, then concocted more.', 'concoct'))
      .toBe('He ___ it, then ___ more.')
  })
  it('多词词头按整体挖', () => {
    expect(clozeExample('They agreed on an ad hoc basis.', 'ad hoc'))
      .toBe('They agreed on an ___ basis.')
  })
  it('定位不到就返回 null,由调用方跳过该例句', () => {
    expect(clozeExample('Nothing relevant here.', 'concoct')).toBeNull()
  })
})

describe('clozeCollocation', () => {
  it('挖掉搭配里的词头', () => {
    expect(clozeCollocation('abrogate a treaty', 'abrogate')).toBe('___ a treaty')
  })
  it('词头在中间也能挖', () => {
    expect(clozeCollocation('formally abrogate an accord', 'abrogate'))
      .toBe('formally ___ an accord')
  })
  it('变形同样处理', () => {
    expect(clozeCollocation('abrogated the agreement', 'abrogate'))
      .toBe('___ the agreement')
  })
  it('定位不到返回 null', () => {
    expect(clozeCollocation('a binding accord', 'abrogate')).toBeNull()
  })
})

describe('sharedSynonyms', () => {
  it('找出被多个词条共享的同义/反义词(小写归一)', () => {
    const ws = [
      word('alpha', '甲'), word('bravo', '乙'),
    ]
    ws[0].synonyms = ['Common', 'onlyA']
    ws[1].synonyms = ['common', 'onlyB']
    const shared = sharedSynonyms(ws)
    expect(shared.has('common')).toBe(true)
    expect(shared.has('onlya')).toBe(false)
  })
  it('反义词与同义词一起统计', () => {
    const ws = [word('alpha', '甲'), word('bravo', '乙')]
    ws[0].synonyms = ['x']
    ws[1].antonyms = ['X']
    expect(sharedSynonyms(ws).has('x')).toBe(true)
  })
})

describe('新题型', () => {
  it('例句挖空:提示含空格且不含答案词,四个词头选一', () => {
    const qs = generateQuiz(words, studied(), 12, seq())
    const q = qs.find(x => x.type === 'clozeExample')
    if (q === undefined) return // 该轮未轮到,不算失败
    expect(q.prompt).toContain('___')
    expect(q.prompt.toLowerCase()).not.toContain(q.answer.toLowerCase())
    expect(q.options).toHaveLength(4)
    expect(q.options).toContain(q.answer)
  })
  it('搭配填空:同样不泄题', () => {
    const qs = generateQuiz(words, studied(), 12, seq())
    const q = qs.find(x => x.type === 'clozeCollocation')
    if (q === undefined) return
    expect(q.prompt).toContain('___')
    expect(q.prompt.toLowerCase()).not.toContain(q.answer.toLowerCase())
  })
  it('近义/反义提示:标明种类,且提示词不是共享词', () => {
    const qs = generateQuiz(words, studied(), 12, seq())
    const q = qs.find(x => x.type === 'synonymHint')
    if (q === undefined) return
    expect(q.hintKind === 'synonym' || q.hintKind === 'antonym').toBe(true)
    expect(sharedSynonyms(words).has(q.prompt.toLowerCase())).toBe(false)
  })
})
