import { describe, expect, it } from 'vitest'
import { headwordPattern, isInflectionOf, splitByHeadword } from './headword'

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

describe('isInflectionOf', () => {
  it('原形本身算', () => {
    expect(isInflectionOf('refute', 'refute')).toBe(true)
  })

  it('常见屈折变形算', () => {
    expect(isInflectionOf('refuted', 'refute')).toBe(true)
    expect(isInflectionOf('ratified', 'ratify')).toBe(true)
    expect(isInflectionOf('inundated', 'inundate')).toBe(true)
    expect(isInflectionOf('thwarting', 'thwart')).toBe(true)
  })

  it('大小写不敏感', () => {
    expect(isInflectionOf('Refuted', 'refute')).toBe(true)
  })

  /**
   * 这条是这个函数存在的全部理由。headwordPattern 在原形缺席时会退回
   * 松散词干 `stem + [a-z]*`,拿它做校验会把 reference 判成 refute 的变形 ——
   * 定位一整句话时那条松散规则是必要的退路,校验单个词时它是漏洞。
   */
  it('形近但无关的词不算', () => {
    expect(isInflectionOf('reference', 'refute')).toBe(false)
    expect(isInflectionOf('mirth', 'mire')).toBe(false)
    expect(isInflectionOf('officials', 'officiate')).toBe(false)
  })

  it('多余的前后缀不算', () => {
    expect(isInflectionOf('unrefuted', 'refute')).toBe(false)
    expect(isInflectionOf('refutation', 'refute')).toBe(false)
  })

  it('形近但无关的词不算(headwordPattern 松散退路会踩上的那几个,校验必须继续挡住)', () => {
    expect(isInflectionOf('president', 'preside')).toBe(false)
    expect(isInflectionOf('sapiens', 'sapient')).toBe(false)
  })

  it('空串不算', () => {
    expect(isInflectionOf('', 'refute')).toBe(false)
    expect(isInflectionOf('refute', '')).toBe(false)
  })

  /**
   * 以下是全库回归时真实测出来的漏判(见 isInflectionOf 上方注释的实测数据)。
   * 用真词命名,不是编出来的边界用例。
   */
  it('末尾辅音双写:manumit/concur/extol 的真实例句变形', () => {
    // manumit 的 5 句例句全部用 manumitted,原形从没出现过 —— 改之前这个词完全定位不到
    expect(isInflectionOf('manumitted', 'manumit')).toBe(true)
    expect(isInflectionOf('concurred', 'concur')).toBe(true)
    expect(isInflectionOf('extolled', 'extol')).toBe(true)
    expect(isInflectionOf('extolling', 'extol')).toBe(true)
  })

  it('词头不裁剪直接接 -ly:profuse/unobtrusive 的真实例句变形', () => {
    expect(isInflectionOf('profusely', 'profuse')).toBe(true)
    expect(isInflectionOf('unobtrusively', 'unobtrusive')).toBe(true)
  })

  it('元音 + y 结尾的词头,y 不该被砍:convey 的屈折变形', () => {
    expect(isInflectionOf('conveyed', 'convey')).toBe(true)
    expect(isInflectionOf('conveys', 'convey')).toBe(true)
  })
})
