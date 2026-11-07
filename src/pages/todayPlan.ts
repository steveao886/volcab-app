import {
  buildConsolidateQueue, buildQueue,
  CONSOLIDATE_DELAY_HOURS, CONSOLIDATE_MAX_INTERVAL_DAYS, newQuota, reviewCap, strugglingPracticePool,
} from '../lib/queue'
import { todayStr } from '../lib/srs'
import { dueTangles, TANGLE_DAILY_CAP } from '../lib/tangle'
import type { Progress, Word } from '../types'

export type PlanKey = 'due' | 'fresh' | 'consolidate' | 'lapses' | 'untangle' | 'quiz'

/** Where 专攻顽固词 goes. One constant because the plan row and the hero card must never send you to two different screens. */
const STRUGGLING_WALK = '/practice?pick=struggling'
export type PlanState = 'todo' | 'done' | 'pending'

export interface PlanItem {
  key: PlanKey
  label: string
  /** Remaining count. Absent on rows where a number would be noise (快速测试). */
  count?: number
  /**
   * 复习到期 only, and only when the daily review cap kept words out of today
   * (DailyQueue.heldBack). nextAction reads it so the hero's 今日完成 does not
   * say the reviews are cleared while words still wait for tomorrow.
   */
  heldBack?: number
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

/** The local done-markers, read from storage by the caller — passed in so this module stays pure and testable. */
export interface LocalMarks {
  lapseDrilledOn: string | null
  consolidatedOn: string | null
  /**
   * Tangle sessions finished on `day`. A count rather than a date like the two
   * above, because 拆开缠在一起的词 is done after TANGLE_DAILY_CAP sessions, not
   * after one. Written by Untangle.tsx through bumpUntangleSessions.
   */
  untangleSessions: { day: string; n: number } | null
}

/**
 * How many tangle sessions the mark says ran on `today`. A mark from another
 * day is none. Lenient, since the caller hands over whatever JSON
 * localStorage held: a mark whose `n` is not a positive integer counts as
 * none rather than as sessions done, so a broken mark errs toward offering
 * the day's sessions again and never toward hiding work that is owed.
 */
export function untangleSessionsToday(mark: LocalMarks['untangleSessions'], today: string): number {
  if (typeof mark !== 'object' || mark === null || mark.day !== today) return 0
  return Number.isInteger(mark.n) && mark.n > 0 ? mark.n : 0
}

/** The mark after one more session finished on `today`. */
export function bumpUntangleSessions(mark: LocalMarks['untangleSessions'], today: string): { day: string; n: number } {
  return { day: today, n: untangleSessionsToday(mark, today) + 1 }
}

/**
 * `due` tangles split by today's share of TANGLE_DAILY_CAP sessions, with
 * `sessions` already run today: `today` is what the share still holds, oldest
 * first, and `beyond` is the rest, still due but past the day's default.
 *
 * **One function because two screens print it.** 今日's row counts `today` and,
 * past the share, hints `beyond`; /untangle's end screen says the same after
 * each session. The end screen used to print every due tangle — five due and
 * one session run, it said 还有 4 团 while 今日 said 2 — and kept 下一团 as its
 * Enter past the cap, which made the default a wall it walked straight through.
 */
export function untangleShare(due: number, sessions: number): { today: number; beyond: number } {
  const today = Math.max(0, Math.min(due, TANGLE_DAILY_CAP - sessions))
  return { today, beyond: due - today }
}

/**
 * The 复习到期 row's hint on a day the review cap binds: the cap, and how many
 * words wait for tomorrow. A done row with words still due says why — the
 * same silence that made the 顽固词 count read as broken until 2026-09-22.
 * See docs/superpowers/specs/2026-11-05-daily-review-cap-design.md.
 *
 * **The learning-phase words are named, because the count includes them and
 * the cap does not.** buildQueue serves the learning block whole, on top of
 * the cap (a word left between its steps must be able to finish them, and
 * one that lapsed was counted already, on its review-phase card). On
 * 2026-11-07 that put 89 beside 上限 88, which the user reported as a broken
 * cap: 108 review words due, 88 served, and one word (`adverse`) whose
 * relearning card was still waiting after a 重来 the day before.
 */
export function dueHint(heldBack: number, cap: number, learning = 0): string | undefined {
  if (heldBack <= 0) return undefined
  const extra = learning > 0 ? `（不含 ${learning} 个没学完的）` : ''
  return `上限 ${cap}${extra}，另 ${heldBack} 个留到明天`
}

/**
 * The 学习新词 row's hint.
 *
 * **A quota cut by carried-over reviews says why.** Each review carried in
 * from an earlier day takes a new word's place (newQuota), so a day after a
 * missed one can have no new words at all, and the row would be a bare tick:
 * the 顽固词 counter read as broken for the same silence until 2026-09-22.
 * Only a cut the backlog made is explained — a quota the user set to 0 is
 * not blamed on it.
 *
 * `已学 N` stays: fresh.length only says what's left, and after the session a
 * "done" with no number would erase the morning's work.
 *
 * **A day the review cap holds words back names the cap instead.** buildQueue
 * zeroes the new words on such a day whatever was carried over, so the
 * carried-over sentence would understate the cut (前几天剩 5 张，新词少学 5 个
 * on a day that learns none).
 */
export function freshHint(carriedOver: number, newPerDay: number, newLearned: number, heldBack = 0): string | undefined {
  const parts: string[] = []
  const cut = newPerDay - newQuota(newPerDay, carriedOver)
  if (heldBack > 0 && newPerDay > 0) {
    parts.push('复习超出每天上限，今天不学新词')
  } else if (cut > 0) {
    parts.push(`前几天剩 ${carriedOver} 张复习`)
    parts.push(newQuota(newPerDay, carriedOver) === 0 ? '今天不学新词' : `新词少学 ${cut} 个`)
  }
  if (newLearned > 0) parts.push(`已学 ${newLearned}`)
  return parts.length > 0 ? parts.join('，') : undefined
}

/**
 * The Today page's day plan. Every state is derived from the same queue
 * functions the review page runs — if a row and the page it links to ever
 * printed different numbers, one of them would be lying — plus the local
 * markers (LocalMarks) and dailyStats[today]. Nothing here is toggled by
 * hand: a checkbox the user could flip records nothing and goes stale the
 * moment sync moves the queue.
 */
export function buildDayPlan(
  words: Word[], progress: Progress, now: Date, today: string, marks: LocalMarks,
): PlanItem[] {
  const q = buildQueue(words, progress, today)
  const stat = progress.dailyStats[today]
  const items: PlanItem[] = []

  // The count is what the daily review cap leaves for today, and the hint
  // says what it kept back — before the cap is reached as well as after, so
  // the tick at the end is never a bare one over words still due.
  const learning = q.due.filter(id => progress.words[id]?.state === 'learning').length
  items.push({
    key: 'due', label: '复习到期', count: q.due.length,
    state: q.due.length === 0 ? 'done' : 'todo', to: '/review',
    ...(q.heldBack > 0
      ? { hint: dueHint(q.heldBack, reviewCap(progress.settings), learning), heldBack: q.heldBack }
      : {}),
  })
  items.push({
    key: 'fresh', label: '学习新词', count: q.fresh.length,
    state: q.fresh.length === 0 ? 'done' : 'todo', to: '/review',
    hint: freshHint(q.carriedOver, progress.settings.newPerDay, stat?.newLearned ?? 0, q.heldBack),
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

  // 拆开缠在一起的词 (forget-moment spec §3, day 2). Liveness is the word
  // list, not progress.words: a deleted word's entry can outlive it, and a
  // tangle left with one live word is never due (dueTangles).
  //
  // **Unlike 顽固词, `count` is right here.** A session takes its tangle off
  // today's list whatever the answers — finished, or due again tomorrow — so
  // the number falls by one per session and reaches zero. It counts today's
  // share (untangleShare), at most TANGLE_DAILY_CAP minus the sessions
  // already run: the cap is a default, not a wall, so past it the row is done
  // but stays a link while more are due, the remainder in the hint.
  //
  // **Done with nothing due is still a row** once a session ran today:
  // finished work must not vanish from the plan, the same reason 巩固's row
  // stays as done.
  const dueTangleCount = dueTangles(progress.tangles, today, new Set(words.map(w => w.id))).length
  const sessions = untangleSessionsToday(marks.untangleSessions, today)
  const share = untangleShare(dueTangleCount, sessions)
  if (share.today > 0) {
    items.push({
      key: 'untangle', label: '拆开缠在一起的词', count: share.today,
      state: 'todo', to: '/untangle',
    })
  } else if (share.beyond > 0) {
    items.push({
      key: 'untangle', label: '拆开缠在一起的词', state: 'done', to: '/untangle',
      hint: `还有 ${share.beyond} 团`, reopenable: true,
    })
  } else if (sessions > 0) {
    items.push({ key: 'untangle', label: '拆开缠在一起的词', state: 'done', to: '/untangle' })
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
  // heldBack: what the daily review cap left for tomorrow, present only when
  // it left something, so the complete line never says the reviews are cleared
  // over words still due.
  | { kind: 'complete'; heldBack?: number }
  | { kind: 'review' | 'consolidate' | 'untangle'; count: number; unit: string; meta: string; to: string; label: string }
  // No count, for the reason the plan row has no count: the stubborn pool is
  // a stock. The hero's number slot says how much is left to do today, and
  // answering 顽固词 does not reduce it — so it gets a noun instead, and the
  // size stays on the plan row where it is labelled as a pool.
  | { kind: 'lapses'; headline: string; meta: string; to: string; label: string }

/**
 * The hero card's one action, in priority order review → consolidate →
 * untangle → lapses. The quiz row never becomes the hero: the plan labels it
 * 可选, and promoting an optional task to "现在该做" would contradict the label.
 *
 * Untangle sits before lapses because it can be finished and the stubborn
 * walk cannot, and it has to be here at all: left out, a day with only
 * tangles due printed 今日完成 above a todo row. Only a todo row counts; past
 * the daily cap the row is done (if reopenable), and a hero asking for work
 * the plan calls done would be the same contradiction the other way round.
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
  const u = get('untangle')
  if (u?.state === 'todo') {
    return {
      kind: 'untangle', count: u.count ?? 0, unit: '团',
      meta: '复习时混过的近义词，并排分清', to: '/untangle', label: '开始拆解',
    }
  }
  const l = get('lapses')
  if (l?.state === 'todo') {
    return {
      kind: 'lapses', headline: '顽固词',
      meta: '从最不牢的开始，练到不想练为止', to: STRUGGLING_WALK, label: '专攻顽固词',
    }
  }
  const heldBack = due?.heldBack ?? 0
  return heldBack > 0 ? { kind: 'complete', heldBack } : { kind: 'complete' }
}
