const DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/**
 * 1–99 in Chinese numerals, the way a date is written: 十 alone for ten and
 * the teens (十一, never 一十一), 二十 with no trailing digit. Only the range a
 * month or a day needs — nothing here writes 百.
 */
export function chineseNumber(n: number): string {
  const tens = Math.floor(n / 10)
  const units = n % 10
  if (tens === 0) return DIGITS[units]
  return `${tens === 1 ? '' : DIGITS[tens]}十${DIGITS[units]}`
}

/**
 * The date line beside 今日's title slip: 九月二十三日　星期三. Local time,
 * because "today" everywhere else in the app (`todayStr`) is local too. The
 * separator is a full-width space rather than a middle dot — the dot-joined
 * meta string is one of the template tells the 朱批 redesign removes.
 */
export function chineseDate(d: Date): string {
  const md = `${chineseNumber(d.getMonth() + 1)}月${chineseNumber(d.getDate())}日`
  return `${md}　星期${WEEKDAYS[d.getDay()]}`
}
