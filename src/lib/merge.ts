import type { Progress } from '../types'

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

  return { version: 1, settings, words, dailyStats }
}
