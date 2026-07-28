import { describe, expect, it } from 'vitest'
import { QUIZ_TYPES, clozeCollocation, clozeExample, generateAudioQuiz, generateContrastQuiz, generateQuiz, pickCloze, pickMeaning, sharedSynonyms } from './quiz'
import { emptyProgress } from '../types'
import type { Meaning, Progress, Word } from '../types'

// 字段覆盖六种题型所需的全部原料:examples/collocations 含词头原形(挖空题要能
// 定位到它),synonyms/antonyms 以 id 为前缀天然互不相同、也不与其他 fixture 词共享
// (否则会被 sharedSynonyms 排除,synonymHint 就出不来)。
const word = (id: string, zh: string): Word => ({
  id, headword: id, phonetic: `/${id}/`, meanings: [{ pos: 'v.', en: `def of ${id}`, zh }],
  examples: [`We ${id} things daily.`, `They ${id} it again.`],
  synonyms: [`${id}-syn1`, `${id}-syn2`, `${id}-syn3`],
  antonyms: [`${id}-ant1`, `${id}-ant2`],
  collocations: [`${id} a plan`, `${id} the rules`],
  relatedForms: [], sourceNote: 't', addedAt: '2026-07-01',
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

/** 多义词 fixture:释义已按占比降序排好(与 data/words.json 的存储不变式一致) */
const multi = (id: string, shares: number[]): Word => ({
  id, headword: id, phonetic: `/${id}/`,
  // zh 必须带上 id:释义标签在 pickDistractorLabels 里按显示文本去重,
  // 各词共用「义0/义1」会让干扰项全被滤掉,题一道也出不来。
  meanings: shares.map((share, i): Meaning => ({ pos: 'v.', en: `sense ${i} of ${id}`, zh: `${id}义${i}`, share })),
  examples: [`We ${id} things daily.`, `They ${id} it again.`],
  synonyms: [`${id}-syn1`], antonyms: [], collocations: [`${id} a plan`],
  relatedForms: [], sourceNote: 't', addedAt: '2026-07-01',
})

describe('pickMeaning', () => {
  it('单义词直接返回那一条', () => {
    const w = word('solo', '甲')
    expect(pickMeaning(w, () => 0.99).zh).toBe('甲')
  })

  it('按占比分段:90/10 时 rng<0.9 落第一条,≥0.9 落第二条', () => {
    const w = multi('m', [90, 10])
    expect(pickMeaning(w, () => 0).zh).toBe('m义0')
    expect(pickMeaning(w, () => 0.5).zh).toBe('m义0')
    expect(pickMeaning(w, () => 0.899).zh).toBe('m义0')
    expect(pickMeaning(w, () => 0.9).zh).toBe('m义1')
    expect(pickMeaning(w, () => 0.999).zh).toBe('m义1')
  })

  it('三义 60/30/10 的分段边界', () => {
    const w = multi('m', [60, 30, 10])
    expect(pickMeaning(w, () => 0.59).zh).toBe('m义0')
    expect(pickMeaning(w, () => 0.6).zh).toBe('m义1')
    expect(pickMeaning(w, () => 0.89).zh).toBe('m义1')
    expect(pickMeaning(w, () => 0.9).zh).toBe('m义2')
  })

  it('rng 返回接近 1 时不越界', () => {
    const w = multi('m', [50, 50])
    expect(pickMeaning(w, () => 0.9999999999).zh).toBe('m义1')
  })

  it('多义但没有占比(外部推来的旧数据)退回第一条,不凭空随机', () => {
    const w = multi('m', [50, 50])
    w.meanings = w.meanings.map(m => ({ pos: m.pos, en: m.en, zh: m.zh }))
    expect(pickMeaning(w, () => 0.99).zh).toBe('m义0')
  })

  it('占比只填了一部分也退回第一条 —— 半份数据不足以加权', () => {
    const w = multi('m', [50, 50])
    delete w.meanings[1].share
    expect(pickMeaning(w, () => 0.99).zh).toBe('m义0')
  })
})

describe('generateQuiz —— 义项占比', () => {
  const multiWords = [multi('alpha', [70, 30]), multi('bravo', [70, 30]), multi('carol', [70, 30]), multi('delta', [70, 30]), multi('echo', [70, 30]), multi('fox', [70, 30])]
  const studiedMulti = (): Progress => {
    const p = emptyProgress()
    for (const w of multiWords) {
      p.words[w.id] = { state: 'review', ease: 2.5, intervalDays: 3, due: '2026-08-01', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-20T00:00:00Z' }
    }
    return p
  }

  it('次要义项也会被考到 —— 原本写死 meanings[0],30% 的那条永远遇不到', () => {
    // rng 恒 0.95 → 每次都落在 70/30 的后 30% 段上
    const qs = generateQuiz(multiWords, studiedMulti(), 6, () => 0.95)
    const withMeaning = qs.filter(q => q.type === 'word2meaning' || q.type === 'meaning2word' || q.type === 'spelling')
    expect(withMeaning.length).toBeGreaterThan(0)
    const texts = withMeaning.map(q => (q.type === 'word2meaning' ? q.answer : q.prompt))
    expect(texts.some(t => /义1$/.test(t))).toBe(true)
  })

  it('同一个词的另一个义项绝不出现在选项里 —— 题面只有词头时两个都对', () => {
    // 必须用**会变化**的 rng:恒定 rng 下 meaningOf(w) 永远返回同一条释义,
    // 于是它总是等于 answer、被 seen 挡掉,pickDistractorLabels 里那道
    // `x.id !== w.id` 的过滤根本走不到 —— 断言会空转。(实测:去掉那道过滤,
    // 恒定 rng 的版本依然全绿。)
    const lcg = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff)
    for (let s = 1; s <= 40; s++) {
      const qs = generateQuiz(multiWords, studiedMulti(), 12, lcg(s))
      for (const q of qs.filter(q => q.type === 'word2meaning')) {
        const w = multiWords.find(x => x.id === q.wordId)!
        const ownLabels = w.meanings.map(m => `${m.pos} ${m.zh}`)
        expect(q.options.filter(o => ownLabels.includes(o))).toHaveLength(1)
      }
    }
  })
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

// --- 加练三模式 ------------------------------------------------------------

/** 易混词 fixture:两个词共享近义词,例句里各自含自己的词头、不含对方的。 */
const pairWord = (id: string, syns: string[], pos = 'v.'): Word => ({
  id, headword: id, phonetic: `/${id}/`,
  meanings: [{ pos, en: `def of ${id}`, zh: `${id}义` }],
  examples: [`The board voted to ${id} the policy.`, `They ${id} it every spring.`],
  synonyms: syns, antonyms: [], collocations: [`${id} a plan`],
  relatedForms: [], sourceNote: 't', addedAt: '2026-07-01',
})

const studiedOf = (ws: Word[]): Progress => {
  const p = emptyProgress()
  for (const w of ws) {
    p.words[w.id] = { state: 'review', ease: 2.5, intervalDays: 3, due: '2026-08-01', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-20T00:00:00Z' }
  }
  return p
}

describe('generateContrastQuiz', () => {
  const pairWords = [
    pairWord('alpha', ['shared1', 'shared2', 'shared3']),
    pairWord('bravo', ['shared1', 'shared2', 'shared3']),
    pairWord('carol', ['other1', 'other2', 'other3']),
    pairWord('delta', ['other1', 'other2', 'other3']),
  ]

  it('只出两个选项 —— 辨析是二选一,不是四选一', () => {
    const qs = generateContrastQuiz(pairWords, studiedOf(pairWords), 4, seq())
    expect(qs.length).toBeGreaterThan(0)
    for (const q of qs) {
      expect(q.type).toBe('contrast')
      expect(q.options).toHaveLength(2)
      expect(q.options).toContain(q.answer)
    }
  })

  it('题面挖空且不泄露答案词', () => {
    const qs = generateContrastQuiz(pairWords, studiedOf(pairWords), 4, seq())
    for (const q of qs) {
      expect(q.prompt).toContain('___')
      expect(q.prompt.toLowerCase()).not.toContain(q.answer.toLowerCase())
    }
  })

  it('contrastId 指向对照词,且不等于本题的词', () => {
    const qs = generateContrastQuiz(pairWords, studiedOf(pairWords), 4, seq())
    for (const q of qs) {
      expect(q.contrastId).toBeDefined()
      expect(q.contrastId).not.toBe(q.wordId)
      // 两个选项恰好是这两个词的词头
      const ids = [q.wordId, q.contrastId]
      const heads = ids.map(id => pairWords.find(w => w.id === id)?.headword)
      expect([...q.options].sort()).toEqual([...heads as string[]].sort())
    }
  })

  it('两个词都在句中就不出这题 —— 挖掉一个另一个还杵在那儿,答案不言自明', () => {
    // **两边的例句都同时含两个词**,所以无论哪个当答案都必须被守卫挡掉,唯一
    // 正确的结果是一道题也出不来。早先只让一边泄题,生成器随机挑到干净的那边
    // 就绕过了守卫,断言等于没写(变异测试抓到过)。
    const both = ['We alpha and bravo together.', 'They alpha then bravo.']
    const leaky = [
      { ...pairWord('alpha', ['s1']), examples: both },
      { ...pairWord('bravo', ['s1']), examples: both },
    ]
    expect(generateContrastQuiz(leaky, studiedOf(leaky), 4, seq())).toEqual([])
  })

  it('一边挖不出空时换另一边当答案,不浪费这一对', () => {
    const noSelfMention = { ...pairWord('alpha', ['s1']), examples: ['Nothing here matches.', 'Still nothing.'] }
    const ws = [noSelfMention, pairWord('bravo', ['s1'])]
    // 两个常量 rng 分别走「先试 alpha」与「先试 bravo」两条分支,两条都得出得来题
    for (const r of [() => 0.1, () => 0.9]) {
      const qs = generateContrastQuiz(ws, studiedOf(ws), 4, r)
      expect(qs).toHaveLength(1)
      expect(qs[0].answer).toBe('bravo')
    }
  })

  it('配不出词对时返回空数组,不抛错', () => {
    const lonely = [pairWord('alpha', ['x']), pairWord('bravo', ['y'])]
    expect(generateContrastQuiz(lonely, studiedOf(lonely), 4, seq())).toEqual([])
  })

  it('不超过请求的题数', () => {
    expect(generateContrastQuiz(pairWords, studiedOf(pairWords), 1, seq())).toHaveLength(1)
  })
})

describe('generateAudioQuiz', () => {
  it('听音选义:四个释义选一,prompt 是要朗读的词头', () => {
    const qs = generateAudioQuiz(words, studied(), 6, seq())
    const q = qs.find(x => x.type === 'audio2meaning')
    expect(q).toBeDefined()
    expect(q!.options).toHaveLength(4)
    expect(q!.options).toContain(q!.answer)
    // prompt 存的是词头(朗读内容),**不是**给人看的题面
    expect(words.some(w => w.headword === q!.prompt)).toBe(true)
  })

  it('听音拼写:没有选项,答案是词头,并带上音标供揭晓时显示', () => {
    const qs = generateAudioQuiz(words, studied(), 6, seq())
    const q = qs.find(x => x.type === 'audio2spelling')
    expect(q).toBeDefined()
    expect(q!.options).toEqual([])
    expect(q!.answer).toBe(q!.prompt)
    expect(q!.phonetic).toBeDefined()
  })

  it('两种题型轮换,不会整轮只出一种', () => {
    const qs = generateAudioQuiz(words, studied(), 6, seq())
    expect(new Set(qs.map(q => q.type)).size).toBe(2)
  })

  it('词库不足 4 个词时返回空数组', () => {
    expect(generateAudioQuiz(words.slice(0, 3), emptyProgress(), 4, seq())).toEqual([])
  })
})

describe('generateQuiz 的题型限制(极速模式用)', () => {
  it('只出指定题型', () => {
    const qs = generateQuiz(words, studied(), 6, seq(), ['word2meaning'])
    expect(qs.length).toBeGreaterThan(0)
    expect(qs.every(q => q.type === 'word2meaning')).toBe(true)
  })

  it('限定两种时两种都出得来', () => {
    const qs = generateQuiz(words, studied(), 6, seq(), ['word2meaning', 'meaning2word'])
    expect(new Set(qs.map(q => q.type))).toEqual(new Set(['word2meaning', 'meaning2word']))
  })

  it('空题型列表返回空数组,不死循环也不落回默认题型', () => {
    expect(generateQuiz(words, studied(), 6, seq(), [])).toEqual([])
  })

  it('不传这个参数时行为不变 —— 六种题型仍在轮换', () => {
    const qs = generateQuiz(words, studied(), 6, seq())
    expect(new Set(qs.map(q => q.type)).size).toBeGreaterThan(1)
    expect(qs.every(q => QUIZ_TYPES.includes(q.type))).toBe(true)
  })
})

// --- 挖空题面的多样性 ------------------------------------------------------
// 实测(拿用户真实进度跑 400 轮):63 个出过挖空题的词,**没有一个**出现过第二种
// 题面,而其中 297/471 的词有 3 句例句。根因是取例句的循环命中第一条就 break。
// 多写例句之前必须先修这里,否则新句子一句也用不上。

describe('pickCloze', () => {
  const three = ['We alpha the plan.', 'They alpha it twice.', 'She alpha nothing.']

  it('挑出的句子来自候选,且已挖空', () => {
    const got = pickCloze(three, 'alpha', () => 0.4)
    expect(got).not.toBeNull()
    expect(got).toContain('___')
    expect(got!.toLowerCase()).not.toContain('alpha')
  })

  it('**不同 rng 给出不同的句子** —— 这条就是这个函数存在的理由', () => {
    const a = pickCloze(three, 'alpha', () => 0)
    const b = pickCloze(three, 'alpha', () => 0.99)
    expect(a).not.toBe(b)
  })

  it('只有一句能挖空时,不管 rng 都返回那一句', () => {
    const mixed = ['Nothing here.', 'They alpha it twice.', 'Still nothing.']
    expect(pickCloze(mixed, 'alpha', () => 0)).toBe(pickCloze(mixed, 'alpha', () => 0.99))
    expect(pickCloze(mixed, 'alpha', () => 0.5)).toContain('___')
  })

  it('一句都定位不到时返回 null,不返回没有空格的题面', () => {
    expect(pickCloze(['Nothing.', 'Still nothing.'], 'alpha', () => 0.5)).toBeNull()
    expect(pickCloze([], 'alpha', () => 0.5)).toBeNull()
  })
})

// --- 辨析模式只考学过的词 --------------------------------------------------
// 实测:排序不等于过滤。用户 63 个已学词只配得出 7 对,排完就掉进未学词,
// 53.7% 的题考的是从没见过的词。综合与听音靠 questionPool 硬过滤,都是 0%。

describe('generateContrastQuiz 只考学过的词', () => {
  const ws = [
    pairWord('alpha', ['s1']),
    pairWord('bravo', ['s1']),
    pairWord('carol', ['s2']),
    pairWord('delta', ['s2']),
  ]
  const learnedOnly = (ids: string[]): Progress => {
    const p = emptyProgress()
    for (const id of ids) {
      p.words[id] = { state: 'review', ease: 2.5, intervalDays: 3, due: '2026-08-01', stepIndex: 0, reps: 1, lapses: 0, lastReviewedAt: '2026-07-20T00:00:00Z' }
    }
    return p
  }

  it('两个词都学过才出题', () => {
    const qs = generateContrastQuiz(ws, learnedOnly(['alpha', 'bravo']), 10, seq())
    expect(qs.length).toBeGreaterThan(0)
    for (const q of qs) {
      expect(['alpha', 'bravo']).toContain(q.wordId)
      expect(['alpha', 'bravo']).toContain(q.contrastId)
    }
  })

  it('宁可少出几题也不掺未学词 —— 只有一对学过就只出一题', () => {
    expect(generateContrastQuiz(ws, learnedOnly(['alpha', 'bravo']), 10, seq())).toHaveLength(1)
  })

  it('只学过一对里的一个,那一对也不出 —— 选项里同样不该有没见过的词', () => {
    expect(generateContrastQuiz(ws, learnedOnly(['alpha', 'carol']), 10, seq())).toEqual([])
  })

  it('一个词都没学过时出空,**不退回全库** —— 空状态有说明,超纲题只会浪费时间', () => {
    expect(generateContrastQuiz(ws, emptyProgress(), 4, seq())).toEqual([])
  })

  it('同一对词反复出题时会换句子,不是永远同一句', () => {
    // 只有一对词、答案侧固定,变的只有例句 —— 否则「题面不同」可能只是因为
    // 这一轮换了个词当答案,断言就测不到打乱本身。
    const three = {
      ...pairWord('alpha', ['s1']),
      examples: [
        'The board voted to alpha the policy.',
        'They alpha it every spring.',
        'Nobody wanted to alpha anything.',
      ],
    }
    const pair = [three, pairWord('bravo', ['s1'])]
    const p = studiedOf(pair)
    // rng 调用次序:①选哪边当答案 ②③例句打乱(3 个元素两次交换) ④选项打乱
    const seqOf = (vals: number[]) => { let i = 0; return () => vals[i++ % vals.length] }
    const a = generateContrastQuiz(pair, p, 1, seqOf([0.1, 0, 0, 0.5]))
    const b = generateContrastQuiz(pair, p, 1, seqOf([0.1, 0.99, 0.99, 0.5]))
    expect(a[0].answer).toBe('alpha')
    expect(b[0].answer).toBe('alpha')   // 答案侧一致,确认变的确实是句子
    expect(a[0].prompt).not.toBe(b[0].prompt)
  })
})
