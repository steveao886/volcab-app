import type { Progress, Word } from '../types'

export interface DailyQueue { due: string[]; fresh: string[] }

export function buildQueue(words: Word[], progress: Progress, today: string): DailyQueue {
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
      return a.localeCompare(b)
    })

  const learnedToday = progress.dailyStats[today]?.newLearned ?? 0
  const budget = Math.max(0, progress.settings.newPerDay - learnedToday)
  const fresh = words
    .filter(w => !progress.words[w.id] || progress.words[w.id].state === 'new')
    .slice(0, budget)
    .map(w => w.id)

  return { due, fresh }
}
