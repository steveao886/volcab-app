import { RECALL_STEADY_STREAK } from './senseGroup'
import { diffDays, todayStr } from './srs'
import type { Progress, ProgressEntry } from '../types'

/**
 * What a word missed in 回想 still owes, and when.
 *
 * **Derived from `RecallStat`, never stored.** A miss sets `streak` to 0, so
 * "missed, and not yet right three times running since" is `reps > correct
 * && streak < RECALL_STEADY_STREAK` on the record 回想 already keeps: no new
 * synced field, nothing for mergeProgress to reconcile, and the same number
 * 词条详情 and 数据 call steady.
 *
 * It exists because a 回想 miss had no guaranteed re-test in the direction
 * it was missed. Measured on the live progress, 2026-11-11: 103 words on a
 * live miss, 76 of them not asked again in 回想 for 8 days or more (median
 * 20), and 69 of those 76 graded in the scheduled review meanwhile — whose
 * card is headword-front and passed them, 53 onto intervals of 21 days or
 * more. By this rule that day: 231 words owing (103 / 83 / 45 at streak
 * 0 / 1 / 2), 194 due.
 *
 * See docs/superpowers/specs/2026-11-11-recall-debt-design.md.
 */

/**
 * Days that must pass after the last 回想 answer before the word is asked
 * again, indexed by streak. A right answer minutes after a miss is
 * short-term retrieval — the hazard the 2026-08-15 spec refuses to credit —
 * so even a fresh miss waits a night.
 */
export const RECALL_DEBT_GAPS = [1, 3, 7] as const

/** Missed in 回想 and not yet steady since. */
export function hasRecallDebt(e: ProgressEntry | undefined): boolean {
  if (e === undefined || e.state === 'new') return false
  const r = e.recall
  if (r === undefined) return false
  // 太简单 is the user's own verdict and a miss retracts it (QuizRecall), so
  // one standing here was set after the miss and overrules the record.
  if (e.recallRating?.level === 'easy') return false
  if (!(r.reps > 0 && r.streak >= 0 && r.streak < RECALL_STEADY_STREAK)) return false
  // A streak of 0 on an answered word is itself a miss, and has to count
  // without the ledger: mergeRecall takes reps and correct by per-field
  // maximum and the streak from the later side, so one device's 5/5 merged
  // with another's later miss reads reps 5, correct 5, streak 0. Past 0 the
  // ledger is the only evidence there ever was a miss.
  return r.streak === 0 || r.reps > r.correct
}

/**
 * How many days past its gap the debt is; negative while it still waits,
 * undefined when nothing is owed.
 *
 * `lastAt` is an ISO instant and the gap is in local calendar days, the
 * convention every date in srs.ts follows. An unreadable `lastAt` owes
 * nothing: this comes off a synced file, and the read side skips.
 */
export function recallDebtOverdue(e: ProgressEntry | undefined, today: string): number | undefined {
  if (e === undefined || !hasRecallDebt(e)) return undefined
  const r = e.recall
  if (r === undefined) return undefined
  const at = new Date(r.lastAt)
  if (Number.isNaN(at.getTime())) return undefined
  const gap: number | undefined = RECALL_DEBT_GAPS[Math.floor(r.streak)]
  if (gap === undefined) return undefined
  return diffDays(todayStr(at), today) - gap
}

export function recallDebtDue(e: ProgressEntry | undefined, today: string): boolean {
  const over = recallDebtOverdue(e, today)
  return over !== undefined && over >= 0
}

/**
 * Word ids whose debt is due, most overdue first; ties by id so the order
 * is the same on every device. What a 回想 round opens on.
 */
export function owedRecallWords(progress: Progress, today: string): string[] {
  const out: { id: string; over: number; at: string }[] = []
  for (const [id, e] of Object.entries(progress.words)) {
    const over = recallDebtOverdue(e, today)
    if (over !== undefined && over >= 0) out.push({ id, over, at: e.recall?.lastAt ?? '' })
  }
  // Within a day, the older answer first: a round's misses all come due
  // together, and by id alone the block would open A to Z every time.
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  return out.sort((a, b) => b.over - a.over || cmp(a.at, b.at) || cmp(a.id, b.id)).map(o => o.id)
}

/**
 * Should the scheduled review show this card Chinese-first?
 *
 * Only a review-phase card that is itself due: a learning step is already
 * inside one sitting, and a card the scheduler did not ask for has no
 * business being graded.
 */
export function reviewsReversed(e: ProgressEntry | undefined, today: string): boolean {
  return e !== undefined && e.state === 'review' && e.due <= today && recallDebtDue(e, today)
}

/**
 * The headword with everything but its first letter hidden: `r••••••••••`.
 *
 * A Chinese gloss alone fits several words (称赞 is applaud, acclaim and
 * laud), and the turned card is self-graded, so without this the user would
 * have to call a correct synonym a miss. Spaces, hyphens and apostrophes
 * stay, so a phrase keeps its shape; each further word shows no letter.
 */
/**
 * A gloss as the turned front may show it: any run of Latin letters becomes
 * an ellipsis.
 *
 * `meanings[].zh` is written to be read beside the headword, and sometimes
 * says it. Counted on data/words.json, 2026-11-11: 4 words have a gloss
 * containing their own headword (premise: 常用复数premises) and 14 more carry
 * other English of three letters or more, mostly a near-twin (fallible's
 * 区别于 fallacy, beside the mask `f•••••••`). Every
 * Latin run goes, not just the headword: the twin gives the stem away too.
 */
export function maskGloss(zh: string): string {
  return zh.replace(/[A-Za-z][A-Za-z'\u2019 \-/.]*[A-Za-z]|[A-Za-z]/g, '…')
}

export function maskHeadword(headword: string): string {
  let shown = false
  let out = ''
  for (const ch of headword) {
    if (ch === ' ' || ch === '-' || ch === '’' || ch === "'") out += ch
    else if (!shown) { out += ch; shown = true }
    else out += '•'
  }
  return out
}
