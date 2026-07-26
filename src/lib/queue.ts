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

/** 顽固词专项一次最多带几个词。20 个大约是一次能坐下来清完的量。 */
export const LAPSE_SESSION_SIZE = 20

/**
 * 顽固词:失误次数最多的那批,**不看到期日**。
 *
 * progress 里一直记着 lapses,统计页也画出来了,但没有任何入口能直接冲这批词 ——
 * SRS 会让常错的词自然多来几次,可用户想主动清算的时候没工具。
 *
 * 失误为 0 的不算(那不叫顽固);失误次数相同时看遇见概率,常用的先来。
 */
export function buildLapseQueue(words: Word[], progress: Progress, limit = LAPSE_SESSION_SIZE): string[] {
  return words
    .filter(w => (progress.words[w.id]?.lapses ?? 0) > 0)
    .sort((a, b) => {
      const la = progress.words[a.id].lapses, lb = progress.words[b.id].lapses
      if (la !== lb) return lb - la
      const d = score(b) - score(a)
      return d !== 0 ? d : a.id.localeCompare(b.id)
    })
    .slice(0, limit)
    .map(w => w.id)
}
