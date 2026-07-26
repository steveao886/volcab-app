import type { Meaning } from '../types'

/**
 * 词条上两项评分类 metadata 的共用规则:义项占比(`Meaning.share`)与当代遇见
 * 概率(`Word.usageScore`)的取值范围。一处定义、三处共用:`/add` 表单、词条
 * 编辑表单、以及 `scripts/validate-words.ts` 的入库校验。
 *
 * 放在 src/lib 而不是 scripts/ 里,是因为 WordEditForm.tsx 里那条注释已经踩过一次坑
 * ——「校验必须和 scripts/validate-words.ts 对齐,否则这里存下的词条会悄悄脱离
 * schema」。两边各写一份迟早会漂移,所以让脚本反过来 import 这个模块。
 */

/** 当代遇见概率的可选值。表单渲染成下拉,于是「1–10 的整数」不可能填错。 */
export const USAGE_SCORE_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

/**
 * 占比只到整十,且不含 0 与 100。
 *
 * 这不是懒:占比是会话中 AI 依据当代用法常识估的量级,背后没有语料统计。
 * 87%/13% 会暗示有 COCA 之类的来源,那是假精度。0 和 100 也排除 —— 100% 意味着
 * 它其实是单义词(那就不该有 share),0% 意味着这条释义不该收进来。
 *
 * 表单用它渲染下拉选项,于是「整十」这条约束在结构上就不可能违反。
 */
export const SHARE_OPTIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90] as const

type HasShare = Pick<Meaning, 'share'>

const isValidShare = (s: number | undefined): boolean =>
  s !== undefined && Number.isInteger(s) && s >= 10 && s <= 90 && s % 10 === 0

/** 合计;缺 share 的义项按 0 计,好让表单的「合计 X%」能显示出还差多少。 */
export function shareSum(meanings: readonly HasShare[]): number {
  return meanings.reduce((sum, m) => sum + (m.share ?? 0), 0)
}

/**
 * 一组义项的占比是否自洽。通过返回 null,否则返回一条可直接展示给用户的中文说明。
 *
 * **不查排序**:表单允许用户随手填,落库前由 normalizeMeanings 统一按降序重排,
 * 没必要拿一个自己能修的问题去拦用户。数据文件里的顺序由 isShareOrdered 单独把关。
 */
export function validateShares(meanings: readonly HasShare[]): string | null {
  if (meanings.length === 0) return null // 「至少一条释义」是上游的校验,不在这里重复

  const filled = meanings.filter(m => m.share !== undefined)

  if (meanings.length === 1) {
    return filled.length > 0 ? '单义词不应标注义项占比(占比只对一词多义有意义)。' : null
  }

  if (filled.length !== meanings.length) {
    return `一词多义时每条释义都要标注占比(当前 ${meanings.length} 条里填了 ${filled.length} 条)。`
  }

  const bad = meanings.findIndex(m => !isValidShare(m.share))
  if (bad !== -1) {
    return `义项占比必须是 10–90 的整十,第 ${bad + 1} 条为 ${meanings[bad].share}。`
  }

  const sum = shareSum(meanings)
  if (sum !== 100) return `义项占比合计须为 100%,当前 ${sum}%。`

  return null
}

/**
 * 数据文件里的义项是否已按占比从高到低排好。
 *
 * 存储层就有序,三个渲染处(复习卡、详情页、编辑表单)才能天然一致、一处都不必
 * 现算排序;释义前的序号也顺带成为常用度序号。占比相等(50/50)算有序。
 */
export function isShareOrdered(meanings: readonly HasShare[]): boolean {
  for (let i = 1; i < meanings.length; i++) {
    const prev = meanings[i - 1].share
    const cur = meanings[i].share
    if (prev === undefined || cur === undefined) continue
    if (cur > prev) return false
  }
  return true
}

/**
 * 落库前的归一化:单义词剥掉 share,多义词按 share 降序稳定重排。不改动入参。
 *
 * 占比相等时靠稳定排序保持原有先后 —— 50/50 的词本来就分不出主次,不该因为
 * 一次无关的编辑就把两条释义调个个儿。
 */
export function normalizeMeanings<T extends HasShare>(meanings: readonly T[]): T[] {
  if (meanings.length <= 1) {
    return meanings.map(m => {
      if (m.share === undefined) return m
      const { share: _share, ...rest } = m
      return rest as T
    })
  }
  return meanings
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (b.m.share ?? 0) - (a.m.share ?? 0) || a.i - b.i)
    .map(x => x.m)
}
