import {
  buildConsolidateQueue, buildLapseQueue, buildQueue,
  CONSOLIDATE_DELAY_HOURS, CONSOLIDATE_MAX_INTERVAL_DAYS, rankStrugglingWords,
} from '../lib/queue'
import { todayStr } from '../lib/srs'
import type { Progress, Word } from '../types'

export type PlanKey = 'due' | 'fresh' | 'consolidate' | 'lapses' | 'quiz'
export type PlanState = 'todo' | 'done' | 'pending'

export interface PlanItem {
  key: PlanKey
  label: string
  /** Remaining count. Absent on rows where a number would be noise (快速测试). */
  count?: number
  state: PlanState
  to: string
  hint?: string
}

/** The two local done-markers, read from storage by the caller — passed in so this module stays pure and testable. */
export interface LocalMarks { lapseDrilledOn: string | null; consolidatedOn: string | null }

/**
 * The Today page's day plan. Every state is derived from the same queue
 * functions the review page runs — if a row and the page it links to ever
 * printed different numbers, one of them would be lying — plus the two
 * local drill markers and dailyStats[today]. Nothing here is toggled by
 * hand: a checkbox the user could flip records nothing and goes stale the
 * moment sync moves the queue.
 */
export function buildDayPlan(
  words: Word[], progress: Progress, now: Date, today: string, marks: LocalMarks,
): PlanItem[] {
  const q = buildQueue(words, progress, today)
  const stat = progress.dailyStats[today]
  const items: PlanItem[] = []

  items.push({
    key: 'due', label: '复习到期', count: q.due.length,
    state: q.due.length === 0 ? 'done' : 'todo', to: '/review',
  })
  items.push({
    key: 'fresh', label: '学习新词', count: q.fresh.length,
    state: q.fresh.length === 0 ? 'done' : 'todo', to: '/review',
    // fresh.length only says what's left; after the session, "done" with no
    // number would erase the morning's work — newLearned supplies it.
    hint: (stat?.newLearned ?? 0) > 0 ? `已学 ${stat.newLearned}` : undefined,
  })

  if (marks.consolidatedOn === today) {
    items.push({ key: 'consolidate', label: '巩固今天的新词', state: 'done', to: '/review?mode=consolidate' })
  } else {
    const ready = buildConsolidateQueue(words, progress, now, today)
    if (ready.length > 0) {
      items.push({
        key: 'consolidate', label: '巩固今天的新词', count: ready.length,
        state: 'todo', to: '/review?mode=consolidate',
      })
    } else if (hasConsolidationComing(words, progress, now, today)) {
      // Without this state the row simply doesn't exist until three hours
      // after learning, which reads as "the feature is gone".
      items.push({
        key: 'consolidate', label: '巩固今天的新词', state: 'pending',
        to: '/review?mode=consolidate', hint: `学完 ${CONSOLIDATE_DELAY_HOURS} 小时后出现`,
      })
    }
  }

  if (marks.lapseDrilledOn === today) {
    items.push({ key: 'lapses', label: '专攻顽固词', state: 'done', to: '/review?mode=lapses' })
  } else if (rankStrugglingWords(words, progress).length > 0) {
    const lapse = buildLapseQueue(words, progress, today)
    // Queue empty while struggling words exist means they were all already
    // reviewed today — that's "done for today", not "no stubborn words".
    if (lapse.length > 0) {
      items.push({
        key: 'lapses', label: '专攻顽固词', count: lapse.length,
        state: 'todo', to: '/review?mode=lapses',
      })
    } else {
      items.push({ key: 'lapses', label: '专攻顽固词', state: 'done', to: '/review?mode=lapses' })
    }
  }

  items.push({
    key: 'quiz', label: '快速测试一轮', state: (stat?.quizTaken ?? 0) > 0 ? 'done' : 'todo',
    to: '/quiz', hint: '可选',
  })
  return items
}

/**
 * Words learned today still inside the 3-hour fade window. Mirrors
 * buildConsolidateQueue's filter with the time test inverted; if the two
 * drift, the pending row would promise a pass that never opens (or hide
 * one that will).
 */
function hasConsolidationComing(words: Word[], progress: Progress, now: Date, today: string): boolean {
  const readyBefore = now.getTime() - CONSOLIDATE_DELAY_HOURS * 3600_000
  return words.some(w => {
    const e = progress.words[w.id]
    if (!e || e.state === 'new') return false
    if (e.intervalDays > CONSOLIDATE_MAX_INTERVAL_DAYS) return false
    const last = new Date(e.lastReviewedAt)
    return todayStr(last) === today && last.getTime() > readyBefore
  })
}

export type HeroAction =
  | { kind: 'complete' }
  | { kind: 'review' | 'consolidate' | 'lapses'; count: number; unit: string; meta: string; to: string; label: string }

/**
 * The hero card's one action, in priority order review → consolidate →
 * lapses. The quiz row never becomes the hero: the plan labels it 可选,
 * and promoting an optional task to "现在该做" would contradict the label.
 */
export function nextAction(plan: PlanItem[]): HeroAction {
  const get = (k: PlanKey) => plan.find(p => p.key === k)
  const due = get('due'), fresh = get('fresh')
  const dueN = due?.state === 'todo' ? due.count ?? 0 : 0
  const freshN = fresh?.state === 'todo' ? fresh.count ?? 0 : 0
  if (dueN + freshN > 0) {
    return {
      kind: 'review', count: dueN + freshN, unit: '张卡',
      meta: `到期 ${dueN} · 新词 ${freshN}`, to: '/review', label: '开始复习',
    }
  }
  const c = get('consolidate')
  if (c?.state === 'todo') {
    return {
      kind: 'consolidate', count: c.count ?? 0, unit: '个词',
      meta: '今天学的词,趁遗忘前再取一次', to: '/review?mode=consolidate', label: '开始巩固',
    }
  }
  const l = get('lapses')
  if (l?.state === 'todo') {
    return {
      kind: 'lapses', count: l.count ?? 0, unit: '个词',
      meta: '最近最不牢的一批', to: '/review?mode=lapses', label: '专攻顽固词',
    }
  }
  return { kind: 'complete' }
}
