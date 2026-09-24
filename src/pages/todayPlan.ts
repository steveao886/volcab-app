import {
  buildConsolidateQueue, buildQueue,
  CONSOLIDATE_DELAY_HOURS, CONSOLIDATE_MAX_INTERVAL_DAYS, strugglingPracticePool,
} from '../lib/queue'
import { todayStr } from '../lib/srs'
import type { Progress, Word } from '../types'

export type PlanKey = 'due' | 'fresh' | 'consolidate' | 'lapses' | 'quiz'

/** Where 专攻顽固词 goes. One constant because the plan row and the hero card must never send you to two different screens. */
const STRUGGLING_WALK = '/practice?pick=struggling'
export type PlanState = 'todo' | 'done' | 'pending'

export interface PlanItem {
  key: PlanKey
  label: string
  /** Remaining count. Absent on rows where a number would be noise (快速测试). */
  count?: number
  state: PlanState
  to: string
  hint?: string
  /**
   * A done row that still leads somewhere worth going. Done rows are inert
   * because for every other row done means empty, and a link to "nothing to
   * do" is a dead end. 专攻顽固词 is the one row where done means something
   * else — you sat down with them today — while the pool behind it is as
   * full as it was.
   */
  reopenable?: boolean
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

  // 顽固词 is the endless walk now, and "done" can only mean the local
  // marker: there is no state of the data that says you finished, because
  // the walk does not end. Practice.tsx writes the marker when a batch is
  // finished.
  //
  // **The pool size is a hint, not a `count`.** It went in the count slot
  // until 2026-09-22, beside 复习到期 and 学习新词, where every number is
  // work you can finish — and this one cannot be finished by doing the
  // thing the row links to. Every exit from the pool (ease back to initial,
  // the interval reaching maturity, a settled miss) is written by a
  // scheduled review; the walk passes settle: false and its own misses only
  // add. Playing it all day leaves the number where it was, which read as a
  // broken counter. Measured on the live library that day: 227 words, of
  // which 182 were waiting on ease or interval and 45 on a miss alone.
  //
  // **Ticked is not closed.** Until 2026-09-22 a ticked row went inert like
  // every other, and 今日 carried a separate 顽固词加练 card as the way back
  // in — so on a day with nothing due the page offered the same walk three
  // times: the hero, this row and the card. The card existed only because
  // this row stopped being a link, so the row stays one instead, for as long
  // as the pool has anything in it.
  const pool = strugglingPracticePool(words, progress, today)
  const poolHint = pool.length > 0 ? `池子里 ${pool.length} 个` : undefined
  if (marks.lapseDrilledOn === today) {
    items.push({
      key: 'lapses', label: '专攻顽固词', state: 'done', to: STRUGGLING_WALK,
      ...(pool.length > 0 ? { hint: poolHint, reopenable: true } : {}),
    })
  } else if (pool.length > 0) {
    items.push({
      key: 'lapses', label: '专攻顽固词', hint: poolHint,
      state: 'todo', to: STRUGGLING_WALK,
    })
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
  | { kind: 'review' | 'consolidate'; count: number; unit: string; meta: string; to: string; label: string }
  // No count, for the reason the plan row has no count: the stubborn pool is
  // a stock. The hero's number slot says how much is left to do today, and
  // answering 顽固词 does not reduce it — so it gets a noun instead, and the
  // size stays on the plan row where it is labelled as a pool.
  | { kind: 'lapses'; headline: string; meta: string; to: string; label: string }

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
      meta: `到期 ${dueN}，新词 ${freshN}`, to: '/review', label: '开始复习',
    }
  }
  const c = get('consolidate')
  if (c?.state === 'todo') {
    return {
      kind: 'consolidate', count: c.count ?? 0, unit: '个词',
      meta: '今天学的词，趁遗忘前再取一次', to: '/review?mode=consolidate', label: '开始巩固',
    }
  }
  const l = get('lapses')
  if (l?.state === 'todo') {
    return {
      kind: 'lapses', headline: '顽固词',
      meta: '从最不牢的开始，练到不想练为止', to: STRUGGLING_WALK, label: '专攻顽固词',
    }
  }
  return { kind: 'complete' }
}
