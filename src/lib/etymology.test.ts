import { describe, expect, it } from 'vitest'
import { ETYMOLOGY_MAX, normalizeEtymology, validateEtymology } from './etymology'

describe('normalizeEtymology', () => {
  it('空串与纯空白都变成 undefined —— 空串会让展示层判为「有词源」然后渲染空标题', () => {
    expect(normalizeEtymology('')).toBeUndefined()
    expect(normalizeEtymology('   ')).toBeUndefined()
    expect(normalizeEtymology('\n\t ')).toBeUndefined()
  })

  it('去掉首尾空白后原样保留', () => {
    expect(normalizeEtymology('  ab-(离开) + rogare(提议) → 废除  ')).toBe('ab-(离开) + rogare(提议) → 废除')
  })

  it('不动内部空白 —— 词根拆解本来就靠空格分段', () => {
    expect(normalizeEtymology('mis-(坏) + anthrōpos(人) → 厌恶人类的')).toBe('mis-(坏) + anthrōpos(人) → 厌恶人类的')
  })
})

describe('validateEtymology', () => {
  it('不填是合法的 —— 这是唯一一个宁可不写的字段', () => {
    expect(validateEtymology('')).toBeNull()
    expect(validateEtymology('    ')).toBeNull()
  })

  it('正好 60 字放行', () => {
    expect(validateEtymology('词'.repeat(ETYMOLOGY_MAX))).toBeNull()
  })

  it('61 字拦下,并把实际字数写进错误里', () => {
    const err = validateEtymology('词'.repeat(ETYMOLOGY_MAX + 1))
    expect(err).not.toBeNull()
    expect(err).toContain(String(ETYMOLOGY_MAX + 1))
  })

  it('按去空白后的长度算,不按输入长度 —— 否则末尾几个空格就能把合法输入判成超长', () => {
    expect(validateEtymology('词'.repeat(ETYMOLOGY_MAX) + '     ')).toBeNull()
  })
})
