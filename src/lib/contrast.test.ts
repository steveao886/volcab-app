import { describe, expect, it } from 'vitest'
import { buildContrastPairs } from './contrast'
import type { Word } from '../types'

/**
 * 配对只看 synonyms,**不看 antonyms** —— 这是设计前提,不是省事。
 * 一个词把 X 当近义、另一个词把 X 当反义,说明这两个词是对立的,不是易混的。
 */
const w = (
  id: string,
  synonyms: string[],
  pos = 'adj.',
): Word => ({
  id, headword: id, phonetic: `/${id}/`,
  meanings: [{ pos, en: `def of ${id}`, zh: `${id}义` }],
  examples: [`We saw something ${id} today.`, `It felt ${id} again.`],
  synonyms, antonyms: [`${id}-ant`], collocations: [`${id} thing`],
  relatedForms: [], sourceNote: 't', addedAt: '2026-07-01',
})

const find = (pairs: ReturnType<typeof buildContrastPairs>, x: string, y: string) => {
  const [a, b] = x < y ? [x, y] : [y, x]
  return pairs.find(p => p.a === a && p.b === b)
}

describe('buildContrastPairs', () => {
  it('共享一个近义词就成对', () => {
    const pairs = buildContrastPairs([w('alpha', ['shared']), w('bravo', ['shared'])])
    expect(pairs).toHaveLength(1)
    expect(find(pairs, 'alpha', 'bravo')?.shared).toEqual(['shared'])
  })

  it('没有交集就不成对', () => {
    expect(buildContrastPairs([w('alpha', ['x']), w('bravo', ['y'])])).toEqual([])
  })

  it('词对内部按字典序规范化,同一对不会出现两次', () => {
    const pairs = buildContrastPairs([w('zulu', ['shared']), w('alpha', ['shared'])])
    expect(pairs).toHaveLength(1)
    expect(pairs[0].a).toBe('alpha')
    expect(pairs[0].b).toBe('zulu')
  })

  it('一方把另一方的词头列为近义词 → direct,且不要求有共享词', () => {
    const pairs = buildContrastPairs([w('alpha', ['bravo']), w('bravo', ['nothing-in-common'])])
    const p = find(pairs, 'alpha', 'bravo')
    expect(p?.direct).toBe(true)
    expect(p?.shared).toEqual([])
  })

  it('大小写与首尾空白不影响匹配', () => {
    const pairs = buildContrastPairs([w('alpha', ['  Shared  ']), w('bravo', ['SHARED'])])
    expect(find(pairs, 'alpha', 'bravo')?.shared).toEqual(['shared'])
  })

  it('打分:共享数 + 互为近义 2 分 + 同词性 1 分', () => {
    // 共享 2 个 + 同为 adj. = 3
    const twoShared = buildContrastPairs([w('alpha', ['s1', 's2']), w('bravo', ['s1', 's2'])])
    expect(find(twoShared, 'alpha', 'bravo')?.score).toBe(3)

    // 共享 1 个 + 词性不同 = 1
    const diffPos = buildContrastPairs([w('alpha', ['s1'], 'adj.'), w('bravo', ['s1'], 'v.')])
    expect(find(diffPos, 'alpha', 'bravo')?.score).toBe(1)

    // 互为近义(0 共享)+ 同词性 = 3
    const direct = buildContrastPairs([w('alpha', ['bravo']), w('bravo', ['zzz'])])
    expect(find(direct, 'alpha', 'bravo')?.score).toBe(3)
  })

  it('同一个词内部重复写了同一个近义词,只算一次', () => {
    const pairs = buildContrastPairs([w('alpha', ['dup', 'DUP', ' dup ']), w('bravo', ['dup'])])
    expect(find(pairs, 'alpha', 'bravo')?.shared).toEqual(['dup'])
    expect(find(pairs, 'alpha', 'bravo')?.score).toBe(2) // 1 共享 + 同词性
  })

  it('空串近义词不参与配对 —— 否则所有有空项的词会互相成对', () => {
    const pairs = buildContrastPairs([w('alpha', ['', '  ']), w('bravo', ['', ''])])
    expect(pairs).toEqual([])
  })

  it('三个词共享同一个近义词 → 三对两两组合', () => {
    const pairs = buildContrastPairs([w('alpha', ['s']), w('bravo', ['s']), w('carol', ['s'])])
    expect(pairs).toHaveLength(3)
  })

  it('按 score 降序', () => {
    const pairs = buildContrastPairs([
      w('alpha', ['weak']),
      w('bravo', ['weak']),
      w('carol', ['s1', 's2', 's3']),
      w('delta', ['s1', 's2', 's3']),
    ])
    expect(pairs[0].a).toBe('carol') // 3 共享 + 同词性 = 4,排最前
    expect(pairs[0].score).toBeGreaterThan(pairs[1].score)
  })

  it('同分时的次序不随词库顺序变化 —— 出题的候选池必须可复现', () => {
    // 这里必须换**输入顺序**来验,而不是把同一份输入跑两遍:Map 的迭代序跟插入序
    // 走,同一份输入跑两遍本来就一样,那样的断言是空转(变异测试抓到过一次)。
    const mk = () => [
      w('delta', ['tie']),
      w('carol', ['tie']),
      w('bravo', ['tie']),
      w('alpha', ['tie']),
    ]
    const forward = buildContrastPairs(mk())
    const reversed = buildContrastPairs([...mk()].reverse())
    expect(reversed).toEqual(forward)
    // 六对全同分,顺序只能由 id 字典序决定
    expect(forward.map(p => `${p.a}|${p.b}`)).toEqual([
      'alpha|bravo', 'alpha|carol', 'alpha|delta',
      'bravo|carol', 'bravo|delta', 'carol|delta',
    ])
  })

  it('不因 antonyms 成对 —— 共享的是反义关系,那是对立不是易混', () => {
    const a = { ...w('alpha', []), antonyms: ['shared'] }
    const b = { ...w('bravo', []), antonyms: ['shared'] }
    expect(buildContrastPairs([a, b])).toEqual([])
  })

  it('词条把自己的词头写进 synonyms 时不与自己成对', () => {
    // 校验脚本本来就禁止这么写,但读取端不该因为一条脏数据产出 a===b 的自我对照题
    const self = w('alpha', ['alpha'])
    expect(buildContrastPairs([self]).every(p => p.a !== p.b)).toBe(true)
  })
})

describe('buildContrastPairs 在真实规模上', () => {
  // 倒排索引的结果必须和朴素双重循环一致 —— 索引是性能优化,不该改变语义。
  it('与朴素双重循环等价', () => {
    const words = Array.from({ length: 40 }, (_, i) =>
      w(`w${String(i).padStart(2, '0')}`, [`s${i % 7}`, `s${i % 5}`], i % 2 ? 'adj.' : 'v.'),
    )
    const pairs = buildContrastPairs(words)

    const norm = (s: string) => s.trim().toLowerCase()
    const naive = new Set<string>()
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 1; j < words.length; j++) {
        const A = new Set(words[i].synonyms.map(norm))
        const B = new Set(words[j].synonyms.map(norm))
        const overlap = [...A].some(x => x !== '' && B.has(x))
        const direct = A.has(norm(words[j].headword)) || B.has(norm(words[i].headword))
        if (overlap || direct) naive.add(`${words[i].id}|${words[j].id}`)
      }
    }
    expect(new Set(pairs.map(p => `${p.a}|${p.b}`))).toEqual(naive)
  })
})
