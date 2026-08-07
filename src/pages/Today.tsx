import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Page } from '../components/Page'
import { SyncStatus } from '../components/SyncStatus'
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
 */
export function Today() {
  const { words, progress, syncStatus, syncError, syncNow } = useApp()
  const today = todayStr(new Date())

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
      eyebrow="Today"
      title="今日"
      actions={<SyncStatus status={syncStatus} onRetry={() => void syncNow()} />}
    >
      {/* The badge only has room for "sync failed"; the sentence the user
          actually needs (§8: export a backup before doing anything else)
          must be spelled out on the screen they open most often. */}
      {syncStatus === 'error' && syncError !== null && (
        <SyncStatus variant="note" status={syncStatus} message={syncError} onRetry={() => void syncNow()} />
      )}

      <section className="card today-hero">
        <p className="today-hero__eyebrow">现在该做</p>
        {hero.kind === 'complete' ? (
          <>
            <p className="today-hero__done">今日完成 🎉</p>
            <p className="today-hero__meta muted">复习和巩固都清完了。想加练的话,下面的快速测试随时可以来一轮。</p>
          </>
        ) : (
          <>
            <p className="num today-hero__count">
              {hero.count}
              <span className="today-hero__unit">{hero.unit}</span>
            </p>
            <p className="today-hero__meta muted">{hero.meta}</p>
            <Link to={hero.to} className="btn btn--primary btn--lg btn--block">
              {hero.label}
            </Link>
          </>
        )}
      </section>

      <section className="card today-plan">
        <p className="today-plan__title">今日安排</p>
        <ul className="today-plan__list">
          {plan.map(item => (
            <PlanRow key={item.key} item={item} />
          ))}
        </ul>
      </section>

      <Link to="/stats" className="card card--interactive today-footer">
        <span>
          连续 <span className="num today-footer__accent">{streak}</span> 天
        </span>
        <span>
          总进度 <span className="num">{count}/{total}</span>
        </span>
        <span>
          近 {RECENT_DAYS} 天正确率{' '}
          <span className="num">{weekAccuracy === null ? '暂无' : `${Math.round(weekAccuracy * 100)}%`}</span>
        </span>
      </Link>
    </Page>
  )
}

/** One plan row. Only todo rows navigate; done/pending rows are inert — a link to a page that will say "nothing to do" is a dead end dressed as an action. */
function PlanRow({ item }: { item: PlanItem }) {
  const inner = (
    <>
      {/* State is carried by the glyph + strikethrough, never color alone. */}
      <span className="today-plan__box" role="img" aria-label={item.state === 'done' ? '已完成' : '待完成'}>
        {item.state === 'done' ? '✓' : ''}
      </span>
      <span className="today-plan__name">{item.label}</span>
      {item.hint !== undefined && <span className="today-plan__hint">{item.hint}</span>}
      {item.count !== undefined && item.count > 0 && (
        <span className="num today-plan__count">{item.count}</span>
      )}
    </>
  )
  if (item.state === 'todo') {
    return (
      <li>
        <Link className="today-plan__row today-plan__row--todo" to={item.to}>
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
