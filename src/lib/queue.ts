import type { Progress, Word } from '../types'

export interface DailyQueue { due: string[]; fresh: string[] }

/**
 * 遇见概率,缺省算 0。
 *
 * **未评分不等于高频**,所以缺省要排在最后而不是中间:词库里凡是经过补全流程
 * 的词都有分,没分的要么是老数据要么是别处推来的,拿不准的东西不该插队。
 */
const score = (w: Word): number => w.usageScore ?? 0

export function buildQueue(words: Word[], progress: Progress, today: string): DailyQueue {
  const byId = new Map(words.map(w => [w.id, w]))
  const due = words
    .filter(w => {
      const e = progress.words[w.id]
      return e && e.state !== 'new' && e.due <= today
    })
    .map(w => w.id)
    .sort((a, b) => {
      const ea = progress.words[a], eb = progress.words[b]
      if (ea.state !== eb.state) return ea.state === 'learning' ? -1 : 1
      if (ea.due !== eb.due) return ea.due < eb.due ? -1 : 1
      // 末位 tiebreaker 从字母序换成遇见概率:到这一步的两个词学习状态与到期日
      // 完全相同,先看谁都不违反 SRS —— 那就该先看更常用的那个。会话没做完时
      // 这个顺序决定了你今天到底复习到了什么。字母序在这里纯属没有信息量。
      const d = score(byId.get(b)!) - score(byId.get(a)!)
      return d !== 0 ? d : a.localeCompare(b)  // 分数也相同才回到字母序,保证确定性
    })

  const learnedToday = progress.dailyStats[today]?.newLearned ?? 0
  const budget = Math.max(0, progress.settings.newPerDay - learnedToday)
  // 新词按遇见概率降序取,而不是词库数组顺序。每天只学 newPerDay 个,
  // 取哪几个直接决定这份投入的回报 —— 先学 formidable(8 分)还是
  // criticality(2 分),不该由它们进词库的先后决定。
  // 分数相同时保持词库原有顺序(下面靠下标做稳定排序),不无端打乱。
  const fresh = words
    .filter(w => !progress.words[w.id] || progress.words[w.id].state === 'new')
    .map((w, i) => ({ w, i }))
    .sort((a, b) => score(b.w) - score(a.w) || a.i - b.i)
    .slice(0, budget)
    .map(x => x.w.id)

  return { due, fresh }
}
