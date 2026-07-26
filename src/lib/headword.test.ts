import { describe, expect, it } from 'vitest'
import { headwordPattern, splitByHeadword } from './headword'

const hits = (s: string, h: string) => splitByHeadword(s, h).filter(x => x.hit).map(x => x.text)
const rebuild = (s: string, h: string) => splitByHeadword(s, h).map(x => x.text).join('')

describe('headwordPattern', () => {
  it('全词命中', () => {
    expect(headwordPattern('We concoct things.', 'concoct')).not.toBeNull()
  })
  it('大小写不敏感', () => {
    expect(headwordPattern('Concoct it.', 'concoct')).not.toBeNull()
  })
  it('屈折变形命中', () => {
    expect(headwordPattern('She concocted an excuse.', 'concoct')).not.toBeNull()
  })
  it('定位不到返回 null', () => {
    expect(headwordPattern('Nothing here.', 'concoct')).toBeNull()
  })
  it('原形在场时只认真实屈折词尾:mire 不命中 mirth', () => {
    expect(hits('The mire of mirth and debt.', 'mire')).toEqual(['mire'])
  })
  it('原形在场时不命中同源长词:officiate 不吃掉 officials', () => {
    expect(hits('Three officials officiate every match.', 'officiate')).toEqual(['officiate'])
  })
  it('原形在场时不命中同源长词:dystrophy 不吃掉 dystrophin', () => {
    expect(hits('muscular dystrophy weakens dystrophin', 'dystrophy')).toEqual(['dystrophy'])
  })
  it('原形缺席时才退到松散词干 —— 覆盖只有变形的那 14% 例句', () => {
    expect(hits('She concocted an excuse.', 'concoct')).toEqual(['concocted'])
  })
  it('返回的正则 lastIndex 归零 —— test() 带 g 会把它推进,不归零会漏掉首个匹配', () => {
    const re = headwordPattern('We concoct and concoct.', 'concoct')!
    expect(re.lastIndex).toBe(0)
    expect([...'We concoct and concoct.'.matchAll(re)]).toHaveLength(2)
  })
  it('空词头返回 null,不产生匹配一切的正则', () => {
    expect(headwordPattern('anything', '   ')).toBeNull()
  })
})

describe('splitByHeadword', () => {
  it('切出命中片段', () => {
    expect(hits('She concocted an excuse.', 'concoct')).toEqual(['concocted'])
  })
  it('同句里原形与变形一并命中 —— 挖空题只挖原形会把答案留在句子里', () => {
    // 真实例句(placate):「to placate passengers…, which placated almost no one」
    expect(hits('to placate passengers, which placated almost no one', 'placate'))
      .toEqual(['placate', 'placated'])
  })
  it('同一形态多次出现全部命中', () => {
    expect(hits('We concoct and we concoct.', 'concoct')).toEqual(['concoct', 'concoct'])
  })
  it('保留原文大小写,不按词头改写', () => {
    expect(hits('Concoct it.', 'concoct')).toEqual(['Concoct'])
  })
  it('片段拼回去必须与原句逐字相同', () => {
    for (const s of ['She concocted an excuse.', 'We concoct and they concocted.', 'Nothing here.', 'concoct']) {
      expect(rebuild(s, 'concoct')).toBe(s)
    }
  })
  it('定位不到时整句一个片段,例句照常显示', () => {
    expect(splitByHeadword('Nothing here.', 'concoct')).toEqual([{ text: 'Nothing here.', hit: false }])
  })
  it('句首命中时不产生空的前导片段', () => {
    expect(splitByHeadword('Concoct it.', 'concoct')[0]).toEqual({ text: 'Concoct', hit: true })
  })
  it('句尾命中时不产生空的尾随片段', () => {
    const segs = splitByHeadword('They concoct', 'concoct')
    expect(segs[segs.length - 1]).toEqual({ text: 'concoct', hit: true })
  })
  it('含正则元字符的词头不炸', () => {
    expect(() => splitByHeadword('cost (a lot) here', 'cost (a')).not.toThrow()
    expect(() => splitByHeadword('a.b.c', 'a.b')).not.toThrow()
  })
  it('含空格的短语词条(ad hoc / due diligence)照常命中', () => {
    expect(hits('An ad hoc fix shipped Friday.', 'ad hoc')).toEqual(['ad hoc'])
  })
})

describe('全库回归', () => {
  it('每个词至少有一句例句能定位到 —— 这条断言就是这套算法存在的理由', async () => {
    const lib = (await import('../../data/words.json')).default
    const missed = lib.words.filter(w => w.examples.every(ex => headwordPattern(ex, w.headword) === null))
    expect(missed.map(w => w.headword)).toEqual([])
  })

  it('全库不标错词 —— 每处标记都必须以词头的近似词干开头', async () => {
    // 松散词干那条兜底路径能匹配到 indict→industry、allude→all 这类无关词。
    // 实测在当前词库上一次都没触发(原形都在场),但新词随时可能踩上,
    // 所以把「不误伤」钉成一条全库断言,而不是靠一次性的人工核对。
    const lib = (await import('../../data/words.json')).default
    const wrong: string[] = []
    for (const w of lib.words) {
      const h = w.headword.trim().toLowerCase()
      const prefix = h.slice(0, Math.max(3, h.length - 3))
      for (const ex of w.examples) {
        for (const seg of splitByHeadword(ex, w.headword)) {
          if (seg.hit && !seg.text.toLowerCase().startsWith(prefix)) {
            wrong.push(`${w.headword} → ${seg.text}`)
          }
        }
      }
    }
    expect(wrong).toEqual([])
  })
})
