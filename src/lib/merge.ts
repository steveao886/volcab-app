import type { Progress, SprintRecord } from '../types'

/**
 * 极速赛纪录取分高者;**同分取日期早的** —— 先达成的那次才是纪录,后来再打平
 * 不该把日期改写成今天。任一方缺席取另一方(旧版 App 推上来的 progress 没有
 * 这个字段),都缺返回 undefined。
 */
function pickBestSprint(a: SprintRecord | undefined, b: SprintRecord | undefined): SprintRecord | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  if (a.score !== b.score) return a.score > b.score ? a : b
  return a.date <= b.date ? a : b
}

export function mergeProgress(local: Progress, remote: Progress): Progress {
  const words: Progress['words'] = { ...remote.words }
  for (const [id, le] of Object.entries(local.words)) {
    const re = words[id]
    if (!re || le.lastReviewedAt >= re.lastReviewedAt) words[id] = le
  }

  const dailyStats: Progress['dailyStats'] = {}
  const days = new Set([...Object.keys(local.dailyStats), ...Object.keys(remote.dailyStats)])
  for (const day of days) {
    const a = local.dailyStats[day], b = remote.dailyStats[day]
    if (!a || !b) { dailyStats[day] = a ?? b; continue }
    dailyStats[day] = {
      reviewed: Math.max(a.reviewed, b.reviewed),
      newLearned: Math.max(a.newLearned, b.newLearned),
      correct: Math.max(a.correct, b.correct),
      quizTaken: Math.max(a.quizTaken, b.quizTaken),
    }
  }

  // settings 按 updatedAt 判优,整体搬运。
  // 曾经是「一律取本地」,那让设置在设备间永远无法同步:A 改了推上去,B 合并时
  // 本地赢、再推回去就把 A 的改动冲掉。缺时间戳视为最旧 —— 于是「从未改过设置
  // 的设备」会跟随「改过的设备」,而不是把自己的默认值推回去。
  const lt = local.settings.updatedAt ?? ''
  const rt = remote.settings.updatedAt ?? ''
  const settings = rt > lt ? remote.settings : local.settings

  const bestSprint = pickBestSprint(local.bestSprint, remote.bestSprint)

  // 两边都没有纪录时**整个键不写**,而不是写一个 `bestSprint: undefined`:
  // 后者会让 `Object.hasOwn(p, 'bestSprint')` 为真,也会在结构相等的断言里
  // 与一份真正没有这个键的 progress 判为不等。
  return bestSprint === undefined
    ? { version: 1, settings, words, dailyStats }
    : { version: 1, settings, words, dailyStats, bestSprint }
}
