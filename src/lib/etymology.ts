/**
 * 词源字段的规则。**脚本与两个表单共用这一份** —— 和 senseShare.ts 同样的理由:
 * 校验脚本(入库闸门)与 App 内的表单各写一份,迟早悄悄漂移,然后表单里存下的
 * 词条让 data/words.json 脱离 schema,等跑校验时才发现。
 */

/** 词源是复习卡背面的一行边注,不是词源学词条。超了该删,不是折行。 */
export const ETYMOLOGY_MAX = 60

/**
 * 表单输入 → 存储值。
 *
 * 空白返回 undefined 而不是空串:调用方据此**整个不写这个键**。空串会让展示层的
 * `word.etymology !== undefined` 判为「有词源」,然后渲染一个只有标题没有内容的小节。
 */
export function normalizeEtymology(input: string): string | undefined {
  const v = input.trim()
  return v === '' ? undefined : v
}

/**
 * 返回错误信息,合法返回 null。
 *
 * **不填是合法的** —— 词源是唯一一个宁可不写的字段(见 docs/word-entry-spec.md):
 * 不是所有词都有可拆解的词源,编一个比留空糟得多。
 */
export function validateEtymology(input: string): string | null {
  const v = normalizeEtymology(input)
  if (v === undefined) return null
  return v.length > ETYMOLOGY_MAX
    ? `词源不超过 ${ETYMOLOGY_MAX} 字(当前 ${v.length} 字),它是一句话不是一段考据`
    : null
}
