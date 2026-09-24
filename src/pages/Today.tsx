import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Page } from '../components/Page'
import { Icon } from '../components/Icon'
import { SyncStatus } from '../components/SyncStatus'
import { chineseDate } from '../lib/chineseDate'
import { todayStr } from '../lib/srs'
import { storage } from '../lib/storage'
import { useApp } from '../state/store'
import { accuracySeries } from './statsDerive'
import { buildDayPlan, nextAction } from './todayPlan'
import type { PlanItem } from './todayPlan'
import { computeStreak, reviewProgress } from './todayStats'
import './Today.css'

const RECENT_DAYS = 7

/**
 * Sketch 001 winner A (see the 2026-08-07 today-focus spec): one adaptive
 * "do this now" hero, an auto-derived day plan, stats compressed to one
 * footer line. The 7-day bar chart is gone — it existed as the entry
 * point to /stats before stats had a tab slot; the footer keeps the link.
 *
 * Laid out as 朱批 since 2026-09-23: the title stands in a vertical 题签 and
 * the hero's headline stands beside it (Page's `lead`); the explanation and
 * the one button run full width underneath.
 */
export function Today() {
  const { words, progress, syncStatus, syncError, syncNow } = useApp()
  const now = new Date()
  const today = todayStr(now)

  // Same memo precedent as before the rebuild: useApp()'s context value is
  // a new object on any provider re-render, and these derivations iterate
  // the whole library — they shouldn't recompute when nothing changed.
  const { plan, hero, streak, count, total } = useMemo(() => {
    const plan = buildDayPlan(words, progress, new Date(), today, {
      lapseDrilledOn: storage.get<string>('lapseDrilledOn'),
      consolidatedOn: storage.get<string>('consolidatedOn'),
    })
    const rp = reviewProgress(words, progress)
    return {
      plan,
      hero: nextAction(plan),
      streak: computeStreak(progress.dailyStats, today),
      count: rp.count,
      total: rp.total,
    }
  }, [words, progress, today])

  // Depends only on [progress, today] — doesn't recompute with library size.
  const weekAccuracy = useMemo(() => {
    const acc = accuracySeries(progress, today, RECENT_DAYS)
      .map(d => d.accuracy)
      .filter((a): a is number => a !== null)
    return acc.length === 0 ? null : acc.reduce((s, a) => s + a, 0) / acc.length
  }, [progress, today])

  return (
    <Page
      title="今日"
      lead={
        <div className="today-lead">
          <div className="today-lead__top">
            <span>{chineseDate(now)}</span>
            <SyncStatus status={syncStatus} onRetry={() => void syncNow()} />
          </div>
          {hero.kind === 'complete' ? (
            <p className="today-lead__headline">今日完成</p>
          ) : (
            <>
              <p className="today-lead__label">现在该做</p>
              {/* 顽固词 gets a noun where every other action gets a number.
                  Its pool is a stock, not a remaining count — nothing you do
                  on the screen this button opens reduces it (see the comment
                  on the lapses row in todayPlan.ts) — and a stock printed as
                  the headline under 「现在该做」 reads as work you failed to
                  clear. The size stays on the plan row below, labelled as a
                  pool. */}
              <p className="today-lead__headline">
                {hero.kind === 'lapses' ? hero.headline : (
                  <><span className="num">{hero.count}</span> {hero.unit}</>
                )}
              </p>
            </>
          )}
        </div>
      }
    >
      {/* The badge only has room for "sync failed"; the sentence the user
          actually needs (§8: export a backup before doing anything else)
          must be spelled out on the screen they open most often. */}
      {syncStatus === 'error' && syncError !== null && (
        <SyncStatus variant="note" status={syncStatus} message={syncError} onRetry={() => void syncNow()} />
      )}

      {hero.kind === 'complete' ? (
        <p className="today-go__meta">复习和巩固都清完了。想加练的话，下面的快速测试随时可以来一轮。</p>
      ) : (
        <div className="today-go">
          <p className="today-go__meta">{hero.meta}</p>
          <Link to={hero.to} className="btn btn--primary btn--lg btn--block">
            {hero.label}
          </Link>
        </div>
      )}

      <section className="today-plan">
        <h2 className="today-plan__title">今日安排</h2>
        <ul className="today-plan__list">
          {plan.map(item => (
            <PlanRow key={item.key} item={item} />
          ))}
        </ul>
      </section>

      {/* Free practice, outside the plan on purpose. Everything in 今日安排
          above is something the scheduler is asking for and can be finished;
          this can't be finished, doesn't count, and is available whether or
          not the day's work is done — putting it in that list would make it
          read as a fifth chore. It sits here because "I want to look at some
          words" is a real impulse that previously had only one home, buried
          under the library's filter bar. No mark at its start, unlike every
          plan row above: a ring would say "still to do". */}
      <Link to="/practice?pick=mixed" className="today-practice">
        <span className="today-practice__text">
          <span className="today-practice__label">随便练练</span>
          <span className="today-practice__meta">一半已掌握的随机抽，一半是最近老忘的，不计入复习</span>
        </span>
        <Icon name="chevron" size={18} />
      </Link>

      <Link to="/stats" className="today-footer">
        <span>
          连续 <span className="num">{streak}</span> 天
        </span>
        <span>
          总进度 <span className="num">{count} / {total}</span>
        </span>
        <span>
          近 {RECENT_DAYS} 天正确率{' '}
          <span className="num">{weekAccuracy === null ? '暂无' : `${Math.round(weekAccuracy * 100)}%`}</span>
        </span>
      </Link>
    </Page>
  )
}

/**
 * One plan row. Todo rows navigate; done and pending rows are inert — a link
 * to a page that will say "nothing to do" is a dead end dressed as an action —
 * except a done row the plan marks reopenable, whose page still has work on it
 * (see PlanItem.reopenable).
 */
function PlanRow({ item }: { item: PlanItem }) {
  const inner = (
    <>
      {/* State is carried by the mark's shape — ring, 勾, dashed ring — never
          color alone. The strikethrough that used to back up a filled box
          is gone: a 勾 already reads as done, and on a reopenable row a
          struck-through name said the pool behind it was empty. */}
      <span className="today-plan__mark" role="img" aria-label={MARK_LABEL[item.state]}>
        <PlanMark state={item.state} />
      </span>
      <span className="today-plan__name">{item.label}</span>
      {item.hint !== undefined && <span className="today-plan__hint">{item.hint}</span>}
      {item.count !== undefined && item.count > 0 && (
        <span className="num today-plan__count">{item.count}</span>
      )}
    </>
  )
  if (item.state === 'todo' || item.reopenable) {
    const cls = item.state === 'todo' ? 'today-plan__row--todo' : 'today-plan__row--done today-plan__row--reopenable'
    return (
      <li>
        <Link className={`today-plan__row ${cls}`} to={item.to}>
          {inner}
        </Link>
      </li>
    )
  }
  return (
    <li>
      <div className={`today-plan__row today-plan__row--${item.state}`}>{inner}</div>
    </li>
  )
}

const MARK_LABEL: Record<PlanItem['state'], string> = { todo: '待完成', done: '已完成', pending: '还没开始' }

/** An ink ring to do, a cinnabar 勾 once done, a dashed ring while it can't be started yet. */
function PlanMark({ state }: { state: PlanItem['state'] }) {
  if (state === 'done') {
    return (
      <svg width="19" height="19" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 11.5l5.5 5.5L20 3.5" />
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray={state === 'pending' ? '2 3' : undefined} aria-hidden="true">
      <circle cx="9" cy="9" r="7.5" />
    </svg>
  )
}
