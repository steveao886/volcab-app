import { describe, expect, it } from 'vitest'
import { buildPassageQuestion, MAX_BLANKS, parsePassage, parseSentence, pickDistractors, pickPassage, pushRecent, RECENT_LIMIT, selectBlanks } from './passage'
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
  it('只挖学过的词,没学过的原样留在正文里当阅读材料', () => {
    const sentences = parsePassage(passage({
      en: ['{{a}} {{b}} {{c}}'], zh: ['甲'],
    }))!
    const words = [word('a'), word('b'), word('c')]
    const progress = progressWith({ a: TODAY, b: TODAY })  // c 没学过
    const blanks = selectBlanks(sentences, byId(words), progress, TODAY)
    expect(blanks.map(b => b.wordId)).toEqual(['a', 'b'])
  })

  it('词库里查不到的词不挖 —— 仓库副本与线上词库会分叉', () => {
    const sentences = parsePassage(passage({ en: ['{{a}} {{ghost}}'], zh: ['甲'] }))!
    const progress = progressWith({ a: TODAY, ghost: TODAY })
    const blanks = selectBlanks(sentences, byId([word('a')]), progress, TODAY)
    expect(blanks.map(b => b.wordId)).toEqual(['a'])
  })

  it('同一个词一篇里最多一个空,否则候选词区会出现两个一模一样的词', () => {
    const sentences = parsePassage(passage({ en: ['{{a}} then {{a|as}}'], zh: ['甲'] }))!
    const blanks = selectBlanks(sentences, byId([word('a')]), progressWith({ a: TODAY }), TODAY)
    expect(blanks).toHaveLength(1)
    expect(blanks[0].surface).toBe('a')
  })

  it('带上句中形式与位置', () => {
    const sentences = parsePassage(passage({
      en: ['x {{refute|refuted}} y', 'z {{a}}'], zh: ['甲', '乙'],
    }))!
    const words = [word('refute'), word('a')]
    const blanks = selectBlanks(sentences, byId(words), progressWith({ refute: TODAY, a: TODAY }), TODAY)
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
    const blanks = selectBlanks(sentences, byId(words), progress, TODAY)
    expect(blanks).toHaveLength(MAX_BLANKS)
    expect(blanks.map(b => b.wordId)).toEqual(['c', 'd', 'e', 'f', 'g', 'h', 'i'])
  })
})

describe('pickDistractors', () => {
  const rng = () => 0.5

  it('优先取与某个答案易混的已学词', () => {
    const answer = { ...word('alpha'), synonyms: ['shared'] }
    const confusable = { ...word('bravo'), synonyms: ['shared'] }
    const unrelated = word('charlie')
    const words = [answer, confusable, unrelated]
    const progress = progressWith({ alpha: TODAY, bravo: TODAY, charlie: TODAY })
    const out = pickDistractors(
      new Set(['alpha']), words, progress, buildContrastPairs(words), 1, rng,
    )
    expect(out.map(w => w.id)).toEqual(['bravo'])
  })

  it('易混词不够时退回词性相同的已学词', () => {
    const words = [word('alpha', 'adj.'), word('bravo', 'adj.'), word('charlie', 'n.')]
    const progress = progressWith({ alpha: TODAY, bravo: TODAY, charlie: TODAY })
    const out = pickDistractors(new Set(['alpha']), words, progress, [], 1, rng)
    expect(out.map(w => w.id)).toEqual(['bravo'])
  })

  it('绝不选中答案自己', () => {
    const words = [word('alpha'), word('bravo')]
    const progress = progressWith({ alpha: TODAY, bravo: TODAY })
    const out = pickDistractors(new Set(['alpha', 'bravo']), words, progress, [], 2, rng)
    expect(out).toHaveLength(0)
  })

  it('没学过的词不当干扰项', () => {
    const words = [word('alpha'), word('bravo')]
    const out = pickDistractors(new Set(['alpha']), words, progressWith({ alpha: TODAY }), [], 2, rng)
    expect(out).toHaveLength(0)
  })

  it('凑不满就少给 —— 少一个干扰词只是简单些,重复选项是缺陷', () => {
    const words = [word('alpha'), word('bravo')]
    const progress = progressWith({ alpha: TODAY, bravo: TODAY })
    const out = pickDistractors(new Set(['alpha']), words, progress, [], 5, rng)
    expect(out.map(w => w.id)).toEqual(['bravo'])
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
