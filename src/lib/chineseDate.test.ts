import { describe, expect, it } from 'vitest'
import { chineseDate, chineseNumber } from './chineseDate'

describe('chineseNumber', () => {
  it('writes 1–9 as single numerals', () => {
    expect(chineseNumber(1)).toBe('一')
    expect(chineseNumber(9)).toBe('九')
  })
  it('writes ten as 十, not 一十', () => expect(chineseNumber(10)).toBe('十'))
  it('writes the teens with a leading 十', () => {
    expect(chineseNumber(11)).toBe('十一')
    expect(chineseNumber(19)).toBe('十九')
  })
  it('writes round tens without a trailing digit', () => {
    expect(chineseNumber(20)).toBe('二十')
    expect(chineseNumber(30)).toBe('三十')
  })
  it('writes the other tens as tens + units', () => {
    expect(chineseNumber(23)).toBe('二十三')
    expect(chineseNumber(31)).toBe('三十一')
  })
})

describe('chineseDate', () => {
  it('reads the local month, day and weekday', () => {
    // 2026-09-23 is a Wednesday.
    expect(chineseDate(new Date(2026, 8, 23, 18, 0))).toBe('九月二十三日　星期三')
  })
  it('says 星期日 for Sunday, not 星期七', () => {
    expect(chineseDate(new Date(2026, 8, 27))).toBe('九月二十七日　星期日')
  })
  it('handles the two-digit months', () => {
    expect(chineseDate(new Date(2026, 11, 1))).toBe('十二月一日　星期二')
    expect(chineseDate(new Date(2026, 9, 10))).toBe('十月十日　星期六')
  })
})
