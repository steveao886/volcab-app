import { describe, expect, it } from 'vitest'
import { buildPassageQuestion, DUE_WEIGHT, LEARNED_WEIGHT, MAX_BLANKS, parsePassage, parseSentence, pickDistractors, pickPassage, pushRecent, RECENT_LIMIT, RECENT_PENALTY, scoreQuestion, selectBlanks } from './passage'
import type { Passage } from './passage'
import { emptyProgress } from '../types'
import type { Progress, Word } from '../types'
import { buildContrastPairs } from './contrast'

/**
 * 短文出题的纯逻辑。UI 不写组件测试(照仓库约定,见 store.test.tsx 顶部),
 * 所以值得测的分支必须全部落在这个文件里。
 */

const passage = (over: Partial<Passage> = {}): Passage => ({
  id: 'p1',
  title: '测试短文',
  en: ['The board was {{contentious}} about it.'],
  zh: ['董事会对此争议不小。'],
  ...over,
})

/** 造一个够用的词条。测试只关心 id / headword / meanings[0].pos。 */
const word = (id: string, pos = 'v.'): Word => ({
  id, headword: id, phonetic: '',
  meanings: [{ pos, en: '', zh: id }],
  examples: [], synonyms: [], antonyms: [], collocations: [], relatedForms: [],
  sourceNote: 'test', addedAt: '2026-01-01',
})

/** state=review、到期日可控的进度。ids 里的词算学过。 */
const progressWith = (entries: Record<string, string>): Progress => {
  const p = emptyProgress()
  for (const [id, due] of Object.entries(entries)) {
    p.words[id] = {
      state: 'review', ease: 2.5, intervalDays: 5, due,
      stepIndex: 0, reps: 3, lapses: 0, lastReviewedAt: '2026-01-01T00:00:00.000Z',
    }
  }
  return p
}

const byId = (ws: Word[]) => new Map(ws.map(w => [w.id, w]))

const TODAY = '2026-07-28'

/**
 * 可复现的伪随机数。**不要用 `() => 0.5` 代替**:那样 `shuffle` 的
 * `Math.floor(0.5 * (i+1))` 退化成一条固定的置换,测出来的「随机」其实一步都没走。
 */
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('parseSentence', () => {
  it('简写标记:词头即句中形式', () => {
    expect(parseSentence('a {{refute}} b')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'word', wordId: 'refute', surface: 'refute' },
      { kind: 'text', text: ' b' },
    ])
  })

  it('带竖线的标记:句中形式与词头不同', () => {
    expect(parseSentence('they {{refute|refuted}} it')).toEqual([
      { kind: 'text', text: 'they ' },
      { kind: 'word', wordId: 'refute', surface: 'refuted' },
      { kind: 'text', text: ' it' },
    ])
  })

  it('一句里多个标记', () => {
    expect(parseSentence('{{a}} and {{b|bs}}')).toEqual([
      { kind: 'word', wordId: 'a', surface: 'a' },
      { kind: 'text', text: ' and ' },
      { kind: 'word', wordId: 'b', surface: 'bs' },
    ])
  })

  it('标记在句首:前面不出现空 text 片段', () => {
    expect(parseSentence('{{a}} b')).toEqual([
      { kind: 'word', wordId: 'a', surface: 'a' },
      { kind: 'text', text: ' b' },
    ])
  })

  it('标记在句尾:后面不出现空 text 片段', () => {
    expect(parseSentence('a {{b}}')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'word', wordId: 'b', surface: 'b' },
    ])
  })

  it('相邻标记之间没有内容:不出现空 text 片段', () => {
    expect(parseSentence('{{a}}{{b}}')).toEqual([
      { kind: 'word', wordId: 'a', surface: 'a' },
      { kind: 'word', wordId: 'b', surface: 'b' },
    ])
  })

  it('没有标记时整句一个 text 片段', () => {
    expect(parseSentence('plain text')).toEqual([{ kind: 'text', text: 'plain text' }])
  })

  it('畸形标记返回 null —— 宁可整篇跳过,不出一道挖错空的题', () => {
    expect(parseSentence('a {{b} c')).toBeNull()       // 括号没配对
    expect(parseSentence('a {{b|c|d}} e')).toBeNull()  // 两根竖线
    expect(parseSentence('a {{}} b')).toBeNull()       // 空 id
    expect(parseSentence('a {{b|}} c')).toBeNull()     // 空形式
    expect(parseSentence('a {{ }} b')).toBeNull()      // id 全是空白,trim 后为空
    expect(parseSentence('a {{b| }} c')).toBeNull()    // 形式全是空白,trim 后为空
    // 忘了写竖线:{{refute refuted}} 会被当成一个带空格的 id,
    // 而这样的 id 永远匹配不到 words.json 里任何一个小写无空白的 Word.id
    expect(parseSentence('a {{refute refuted}} b')).toBeNull()
    expect(parseSentence('a {{Refute}} b')).toBeNull() // id 带大写,同样匹配不到词
  })
})

describe('parsePassage', () => {
  it('逐句解析,句数与 zh 一致时返回二维 token', () => {
    const r = parsePassage(passage({ en: ['{{a}} x.', 'y {{b}}.'], zh: ['甲', '乙'] }))
    expect(r).toEqual([
      [
        { kind: 'word', wordId: 'a', surface: 'a' },
        { kind: 'text', text: ' x.' },
      ],
      [
        { kind: 'text', text: 'y ' },
        { kind: 'word', wordId: 'b', surface: 'b' },
        { kind: 'text', text: '.' },
      ],
    ])
  })

  it('中译句数对不上返回 null —— 读取端对坏数据宽容,跳过这一篇', () => {
    expect(parsePassage(passage({ en: ['a', 'b'], zh: ['甲'] }))).toBeNull()
  })

  it('空短文返回 null', () => {
    expect(parsePassage(passage({ en: [], zh: [] }))).toBeNull()
  })

  it('任何一句畸形,整篇返回 null', () => {
    expect(parsePassage(passage({ en: ['ok {{a}}', 'bad {{b}'], zh: ['甲', '乙'] }))).toBeNull()
  })
})

describe('selectBlanks', () => {
  /** 每次现造一个,种子固定 —— 不共享状态,断言不依赖用例执行顺序。 */
  const rng = () => mulberry32(1)

  it('只挖学过的词,没学过的原样留在正文里当阅读材料', () => {
    const sentences = parsePassage(passage({
      en: ['{{a}} {{b}} {{c}}'], zh: ['甲'],
    }))!
    const words = [word('a'), word('b'), word('c')]
    const progress = progressWith({ a: TODAY, b: TODAY })  // c 没学过
    const blanks = selectBlanks(sentences, byId(words), progress, TODAY, rng())
    expect(blanks.map(b => b.wordId)).toEqual(['a', 'b'])
  })

  it('词库里查不到的词不挖 —— 仓库副本与线上词库会分叉', () => {
    const sentences = parsePassage(passage({ en: ['{{a}} {{ghost}}'], zh: ['甲'] }))!
    const progress = progressWith({ a: TODAY, ghost: TODAY })
    const blanks = selectBlanks(sentences, byId([word('a')]), progress, TODAY, rng())
    expect(blanks.map(b => b.wordId)).toEqual(['a'])
  })

  it('同一个词一篇里最多一个空,否则候选词区会出现两个一模一样的词', () => {
    const sentences = parsePassage(passage({ en: ['{{a}} then {{a|as}}'], zh: ['甲'] }))!
    const blanks = selectBlanks(sentences, byId([word('a')]), progressWith({ a: TODAY }), TODAY, rng())
    expect(blanks).toHaveLength(1)
    expect(blanks[0].surface).toBe('a')
  })

  it('带上句中形式与位置', () => {
    const sentences = parsePassage(passage({
      en: ['x {{refute|refuted}} y', 'z {{a}}'], zh: ['甲', '乙'],
    }))!
    const words = [word('refute'), word('a')]
    const blanks = selectBlanks(sentences, byId(words), progressWith({ refute: TODAY, a: TODAY }), TODAY, rng())
    expect(blanks[0]).toMatchObject({ si: 0, ti: 1, wordId: 'refute', surface: 'refuted' })
    expect(blanks[1]).toMatchObject({ si: 1, wordId: 'a' })
  })

  it('超过上限时到期的优先,但仍按正文顺序返回', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    const sentences = parsePassage(passage({
      en: [ids.map(i => `{{${i}}}`).join(' ')], zh: ['甲'],
    }))!
    const words = ids.map(i => word(i))
    // 前两个未到期,其余到期 —— 9 个候选砍到 7 个,应该砍掉前两个
    const progress = progressWith(Object.fromEntries(
      ids.map((i, n) => [i, n < 2 ? '2099-01-01' : TODAY]),
    ))
    // 组内打乱不影响这条:到期的正好 7 个 = MAX_BLANKS,无论怎么洗都整组入选,
    // 未到期的两个无论怎么洗都在 7 名开外。断言的是「到期优先」+「正文顺序」两条
    // 不变量,与组内顺序无关 —— 所以这里不需要为了让测试过而放宽。
    const blanks = selectBlanks(sentences, byId(words), progress, TODAY, rng())
    expect(blanks).toHaveLength(MAX_BLANKS)
    expect(blanks.map(b => b.wordId)).toEqual(['c', 'd', 'e', 'f', 'g', 'h', 'i'])
  })

  it('截断砍掉的不总是同几个词 —— 语料里标了的词不该永远考不到', () => {
    const ids = Array.from({ length: MAX_BLANKS + 3 }, (_, i) => `w${i}`)
    const sentences = parsePassage(passage({
      en: [ids.map(i => `{{${i}}}`).join(' ')], zh: ['甲'],
    }))!
    const words = ids.map(i => word(i))
    const progress = progressWith(Object.fromEntries(ids.map(i => [i, TODAY])))

    const sets = new Set<string>()
    const everChosen = new Set<string>()
    for (let seed = 1; seed <= 100; seed++) {
      const blanks = selectBlanks(sentences, byId(words), progress, TODAY, mulberry32(seed))
      expect(blanks).toHaveLength(MAX_BLANKS)
      // 正文顺序这条不变量在打乱之后依然成立
      expect(blanks.map(b => b.si * 100 + b.ti)).toEqual([...blanks.map(b => b.si * 100 + b.ti)].sort((x, y) => x - y))
      sets.add(blanks.map(b => b.wordId).join(','))
      for (const b of blanks) everChosen.add(b.wordId)
    }
    // 断言的是「有变化」而不是某一种具体结果
    expect(sets.size).toBeGreaterThan(1)
    // 每个标记词都得有被挖到的机会,一个都不能永远出局
    expect([...everChosen].sort()).toEqual([...ids].sort())
  })
})

describe('pickDistractors', () => {
  const rng = () => 0.5
  const none = new Set<string>()

  it('优先取与某个答案易混的已学词', () => {
    const answer = { ...word('alpha'), synonyms: ['shared'] }
    const confusable = { ...word('bravo'), synonyms: ['shared'] }
    const unrelated = word('charlie')
    const words = [answer, confusable, unrelated]
    const progress = progressWith({ alpha: TODAY, bravo: TODAY, charlie: TODAY })
    const out = pickDistractors(
      new Set(['alpha']), none, words, byId(words), progress, buildContrastPairs(words), 1, rng,
    )
    expect(out.map(w => w.id)).toEqual(['bravo'])
  })

  it('互为词典近义(direct)的那一对不当干扰词 —— 填进去也对', () => {
    // bravo 把 alpha 的词头写进了自己的 synonyms → direct 对
    const answer = word('alpha')
    const same = { ...word('bravo'), synonyms: ['alpha'] }
    // charlie 只是与 alpha 共享一个近义词,不是 direct,应该被选中
    const answerShared = { ...answer, synonyms: ['shared'] }
    const near = { ...word('charlie'), synonyms: ['shared'] }
    const words = [answerShared, same, near]
    const progress = progressWith({ alpha: TODAY, bravo: TODAY, charlie: TODAY })
    const pairs = buildContrastPairs(words)
    expect(pairs.find(p => p.a === 'alpha' && p.b === 'bravo')?.direct).toBe(true)
    const out = pickDistractors(new Set(['alpha']), none, words, byId(words), progress, pairs, 1, rng)
    expect(out.map(w => w.id)).toEqual(['charlie'])
  })

  it('易混词不够时退回词性相同的已学词', () => {
    const words = [word('alpha', 'adj.'), word('bravo', 'adj.'), word('charlie', 'n.')]
    const progress = progressWith({ alpha: TODAY, bravo: TODAY, charlie: TODAY })
    const out = pickDistractors(new Set(['alpha']), none, words, byId(words), progress, [], 1, rng)
    expect(out.map(w => w.id)).toEqual(['bravo'])
  })

  it('绝不选中答案自己', () => {
    const words = [word('alpha'), word('bravo')]
    const progress = progressWith({ alpha: TODAY, bravo: TODAY })
    const out = pickDistractors(new Set(['alpha', 'bravo']), none, words, byId(words), progress, [], 2, rng)
    expect(out).toHaveLength(0)
  })

  it('没学过的词不当干扰项', () => {
    const words = [word('alpha'), word('bravo')]
    const out = pickDistractors(new Set(['alpha']), none, words, byId(words), progressWith({ alpha: TODAY }), [], 2, rng)
    expect(out).toHaveLength(0)
  })

  it('凑不满就少给 —— 少一个干扰词只是简单些,重复选项是缺陷', () => {
    const words = [word('alpha'), word('bravo')]
    const progress = progressWith({ alpha: TODAY, bravo: TODAY })
    const out = pickDistractors(new Set(['alpha']), none, words, byId(words), progress, [], 5, rng)
    expect(out.map(w => w.id)).toEqual(['bravo'])
  })

  it('excludeIds 里的词不当干扰项', () => {
    const words = [word('alpha'), word('bravo'), word('charlie')]
    const progress = progressWith({ alpha: TODAY, bravo: TODAY, charlie: TODAY })
    const out = pickDistractors(new Set(['alpha']), new Set(['bravo']), words, byId(words), progress, [], 5, rng)
    expect(out.map(w => w.id)).toEqual(['charlie'])
  })
})

describe('buildPassageQuestion', () => {
  const rng = () => 0.5
  const ids = ['a', 'b', 'c', 'd', 'e']
  const words = ids.map(i => word(i))
  const allLearned = progressWith(Object.fromEntries(ids.map(i => [i, TODAY])))
  const threeBlank = passage({ en: ['{{a}} {{b}} {{c}}'], zh: ['甲'] })

  it('候选词 = 全部答案 + 干扰词', () => {
    const q = buildPassageQuestion(threeBlank, words, allLearned, TODAY, [], rng)!
    expect(q.blanks).toHaveLength(3)
    expect(q.choices).toHaveLength(3 + 2)
    expect(new Set(q.choices.map(c => c.wordId)).size).toBe(5)  // 无重复
    for (const b of q.blanks) {
      expect(q.choices.some(c => c.wordId === b.wordId)).toBe(true)
    }
  })

  it('候选词带词头原形,给界面显示用', () => {
    const q = buildPassageQuestion(threeBlank, words, allLearned, TODAY, [], rng)!
    expect(q.choices.every(c => c.headword !== '')).toBe(true)
  })

  it('可挖空不足 3 个返回 null', () => {
    const p = passage({ en: ['{{a}} {{b}}'], zh: ['甲'] })
    expect(buildPassageQuestion(p, words, allLearned, TODAY, [], rng)).toBeNull()
  })

  it('解析失败返回 null,不抛错', () => {
    const p = passage({ en: ['{{a}} {{b} {{c}}'], zh: ['甲'] })
    expect(buildPassageQuestion(p, words, allLearned, TODAY, [], rng)).toBeNull()
  })

  it('exclude 点名的词不当干扰词 —— 算不出来的歧义只能靠人眼点名', () => {
    const p = passage({ en: ['{{a}} {{b}} {{c}}'], zh: ['甲'], exclude: ['d'] })
    for (let seed = 1; seed <= 50; seed++) {
      const q = buildPassageQuestion(p, words, allLearned, TODAY, [], mulberry32(seed))!
      expect(q.choices.map(c => c.wordId)).not.toContain('d')
    }
  })

  it('标记了但没挖成空的词不当干扰词 —— 它就印在正文里,一眼就被划掉', () => {
    const marked = Array.from({ length: MAX_BLANKS + 1 }, (_, i) => `m${i}`)
    const spare = ['s0', 's1', 's2']
    const all = [...marked, ...spare]
    const ws = all.map(i => word(i))
    const progress = progressWith(Object.fromEntries(all.map(i => [i, TODAY])))
    const p = passage({ en: [marked.map(i => `{{${i}}}`).join(' ')], zh: ['甲'] })

    for (let seed = 1; seed <= 50; seed++) {
      const q = buildPassageQuestion(p, ws, progress, TODAY, [], mulberry32(seed))!
      const answers = new Set(q.blanks.map(b => b.wordId))
      // 每一轮都真的有一个标记词落选了,否则这条断言是空跑
      expect(answers.size).toBe(MAX_BLANKS)
      const leaked = q.choices.filter(c => !answers.has(c.wordId) && marked.includes(c.wordId))
      expect(leaked).toEqual([])
    }
  })
})

describe('pickPassage', () => {
  const rng = () => 0.5
  const ids = ['a', 'b', 'c', 'd', 'e', 'f']
  const words = ids.map(i => word(i))

  const p1 = passage({ id: 'p1', en: ['{{a}} {{b}} {{c}}'], zh: ['甲'] })
  const p2 = passage({ id: 'p2', en: ['{{d}} {{e}} {{f}}'], zh: ['乙'] })

  it('挑今天到期词最多的那篇', () => {
    const progress = progressWith({
      a: TODAY, b: TODAY, c: TODAY,        // p1:三个都到期
      d: TODAY, e: '2099-01-01', f: '2099-01-01',  // p2:只有一个到期
    })
    expect(pickPassage([p1, p2], words, progress, TODAY, [], rng)?.passage.id).toBe('p1')
  })

  it('最近做过的要让位 —— 第二次做记住的是上次的答案,不是词', () => {
    const progress = progressWith({
      a: TODAY, b: TODAY, c: TODAY,
      d: TODAY, e: TODAY, f: '2099-01-01',  // p2 分数本来比 p1 低
    })
    expect(pickPassage([p1, p2], words, progress, TODAY, ['p1'], rng)?.passage.id).toBe('p2')
  })

  it('一篇都出不来时返回 null', () => {
    const progress = progressWith({ a: TODAY })  // 每篇最多一个空
    expect(pickPassage([p1, p2], words, progress, TODAY, [], rng)).toBeNull()
  })

  it('坏数据的那篇被跳过,不影响别的篇', () => {
    const broken = passage({ id: 'bad', en: ['{{a} {{b}} {{c}}'], zh: ['甲'] })
    const progress = progressWith({ a: TODAY, b: TODAY, c: TODAY })
    expect(pickPassage([broken, p1], words, progress, TODAY, [], rng)?.passage.id).toBe('p1')
  })

  it('同一个种子跑两次结果一模一样 —— 整套出题都建立在可复现上', () => {
    // 用超过 MAX_BLANKS 的一篇,让选空、选干扰词、排序三处随机全都真的动起来
    const many = Array.from({ length: MAX_BLANKS + 3 }, (_, i) => `w${i}`)
    const spare = ['x0', 'x1', 'x2']
    const ws = [...many, ...spare].map(i => word(i))
    const progress = progressWith(Object.fromEntries([...many, ...spare].map(i => [i, TODAY])))
    const big = passage({ id: 'big', en: [many.map(i => `{{${i}}}`).join(' ')], zh: ['甲'] })

    expect(pickPassage([big, p1], ws, progress, TODAY, [], mulberry32(42)))
      .toEqual(pickPassage([big, p1], ws, progress, TODAY, [], mulberry32(42)))

    // 换个种子确实会给出别的结果,否则上面那条断言是废话
    const a = pickPassage([big, p1], ws, progress, TODAY, [], mulberry32(42))!
    const b = pickPassage([big, p1], ws, progress, TODAY, [], mulberry32(7))!
    expect(a.choices).not.toEqual(b.choices)
  })
})

describe('scoreQuestion', () => {
  const ids = ['a', 'b', 'c']
  const words = ids.map(i => word(i))
  const p = passage({ id: 'p1', en: ['{{a}} {{b}} {{c}}'], zh: ['甲'] })
  const build = (progress: Progress) =>
    buildPassageQuestion(p, words, progress, TODAY, [], mulberry32(3))!

  const threeDue = progressWith({ a: TODAY, b: TODAY, c: TODAY })
  const twoDue = progressWith({ a: TODAY, b: TODAY, c: '2099-01-01' })

  it('到期词权重高于已学未到期 —— 这题首先是复习工具,其次才是阅读', () => {
    expect(scoreQuestion(build(threeDue), threeDue, TODAY, [])).toBe(DUE_WEIGHT * 3)
    expect(scoreQuestion(build(twoDue), twoDue, TODAY, [])).toBe(DUE_WEIGHT * 2 + LEARNED_WEIGHT)
    expect(DUE_WEIGHT).toBeGreaterThan(LEARNED_WEIGHT)
  })

  it('最近做过的惩罚压得过「多一个到期词」—— 宁可换一篇覆盖略差的', () => {
    // 多一个到期词只值 DUE_WEIGHT - LEARNED_WEIGHT 分,惩罚必须比它重
    expect(RECENT_PENALTY).toBeGreaterThan(DUE_WEIGHT - LEARNED_WEIGHT)
    const recent = scoreQuestion(build(threeDue), threeDue, TODAY, ['p1'])
    const fresh = scoreQuestion(build(twoDue), twoDue, TODAY, [])
    expect(recent).toBeLessThan(fresh)
  })

  it('不在最近列表里就不扣分', () => {
    expect(scoreQuestion(build(threeDue), threeDue, TODAY, ['other']))
      .toBe(scoreQuestion(build(threeDue), threeDue, TODAY, []))
  })
})

describe('pushRecent', () => {
  it('新的排在最前', () => {
    expect(pushRecent(['b', 'c'], 'a')).toEqual(['a', 'b', 'c'])
  })

  it('已在列表里的挪到最前而不是留两份', () => {
    expect(pushRecent(['b', 'a', 'c'], 'a')).toEqual(['a', 'b', 'c'])
  })

  it('超过上限时砍掉最旧的', () => {
    const long = Array.from({ length: RECENT_LIMIT }, (_, i) => `p${i}`)
    const out = pushRecent(long, 'new')
    expect(out).toHaveLength(RECENT_LIMIT)
    expect(out[0]).toBe('new')
    expect(out).not.toContain(`p${RECENT_LIMIT - 1}`)
  })
})
