import { describe, expect, it } from 'vitest'
import { parsePassage, parseSentence } from './passage'
import type { Passage } from './passage'

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
    const tokens = parseSentence('{{a}} and {{b|bs}}')
    expect(tokens?.filter(t => t.kind === 'word')).toHaveLength(2)
  })

  it('没有标记时整句一个 text 片段', () => {
    expect(parseSentence('plain text')).toEqual([{ kind: 'text', text: 'plain text' }])
  })

  it('畸形标记返回 null —— 宁可整篇跳过,不出一道挖错空的题', () => {
    expect(parseSentence('a {{b} c')).toBeNull()       // 括号没配对
    expect(parseSentence('a {{b|c|d}} e')).toBeNull()  // 两根竖线
    expect(parseSentence('a {{}} b')).toBeNull()       // 空 id
    expect(parseSentence('a {{b|}} c')).toBeNull()     // 空形式
  })
})

describe('parsePassage', () => {
  it('逐句解析,句数与 zh 一致时返回二维 token', () => {
    const r = parsePassage(passage({ en: ['{{a}} x.', 'y {{b}}.'], zh: ['甲', '乙'] }))
    expect(r).toHaveLength(2)
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
