import { describe, expect, it } from 'vitest'
import { checkCapture } from './stagingCapture'
import type { StagingItem, Word } from '../types'

const word = (id: string, headword = id): Word => ({
  id, headword, phonetic: `/${id}/`,
  meanings: [{ pos: 'n.', en: id, zh: id }],
  examples: [], synonyms: [], antonyms: [], collocations: [], relatedForms: [],
  sourceNote: 'manual', addedAt: '2026-07-25',
})

const item = (headword: string): StagingItem => ({ headword, addedAt: '2026-07-25' })

const LIB = [word('abrogate'), word('ad-hoc', 'ad hoc')]
const STAGE = [item('ostensible')]

describe('checkCapture', () => {
  it('空输入(含纯空白):按钮该是禁用的', () => {
    expect(checkCapture('', LIB, STAGE).kind).toBe('empty')
    expect(checkCapture('   \n ', LIB, STAGE).kind).toBe('empty')
  })

  it('新词:放行,并回传归一化后的写法', () => {
    expect(checkCapture('  perfunctory ', LIB, STAGE)).toEqual({ kind: 'ok', headword: 'perfunctory' })
    expect(checkCapture('Sine  Qua  Non', LIB, STAGE)).toEqual({ kind: 'ok', headword: 'Sine Qua Non' })
  })

  it('已在词库里:拦下,并带上词条 id 好让提示可以点过去', () => {
    expect(checkCapture('Abrogate', LIB, STAGE)).toEqual({ kind: 'in-library', id: 'abrogate', headword: 'abrogate' })
  })

  it('已在待补全列表里:拦下', () => {
    expect(checkCapture(' OSTENSIBLE ', LIB, STAGE)).toMatchObject({ kind: 'in-staging' })
  })

  it('短语词条:空格与连字符两种写法都认得出是同一个词', () => {
    // 词库里 headword 是 "ad hoc"、id 是 "ad-hoc";两种输入都不该重复入列
    expect(checkCapture('ad hoc', LIB, STAGE).kind).toBe('in-library')
    expect(checkCapture('Ad-Hoc', LIB, STAGE).kind).toBe('in-library')
    expect(checkCapture('ad   hoc', LIB, STAGE).kind).toBe('in-library')
  })

  it('词库优先于暂存区:同一个词两边都有时,提示指向已收录的那条', () => {
    expect(checkCapture('abrogate', LIB, [item('abrogate')]).kind).toBe('in-library')
  })

  it('空词库、空暂存区不报错', () => {
    expect(checkCapture('ostensible', [], []).kind).toBe('ok')
  })
})
