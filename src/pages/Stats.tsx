import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../components/Card'
import { Chip } from '../components/Chip'
import { Page } from '../components/Page'
import { todayStr } from '../lib/srs'
import { useApp } from '../state/store'
import type { AccuracyPoint, DayPoint } from './statsDerive'
import { accuracySeries, cumulativeTotals, dailySeries, masteryBreakdown, usageCoverage } from './statsDerive'
import { computeStreak } from './todayStats'
import './Stats.css'

const WINDOW_DAYS = 30
/** Even in an all-zero window, bars still get a "shortest but still visible" height, for the same reason as the Today page's "recent" block. */
const MIN_BAR_FRACTION = 0.04

/**
 * Task 9 implementation: reviews over the last 30 days, accuracy trend,
 * streak days with a missed-day calendar, library mastery breakdown,
 * cumulative totals.
 *
 * Every metric is derived purely from progress.dailyStats and each word's
 * state — no review log is stored, per v1.1 spec §5.1: progress.json goes
 * through the GitHub Contents API's 1 MB read limit, and a full log would
 * hit that ceiling in roughly 9 months, at which point new devices
 * couldn't sign in. So this can chart "volume" and "rate" trends, but not
 * word-level history or time-of-day analysis.
 */
export function Stats() {
  const { words, progress } = useApp()
  const today = todayStr(new Date())

  // useApp()'s context value is a new object on every provider render
  // (background sync heartbeats count too), and deriving this requires
  // iterating every entry — it shouldn't recompute when nothing actually
  // changed, the same precedent as Today.tsx.
  const { days, acc, streak, mastery, totals, coverage, hasHistory } = useMemo(() => {
    return {
      days: dailySeries(progress, today, WINDOW_DAYS),
      acc: accuracySeries(progress, today, WINDOW_DAYS),
      streak: computeStreak(progress.dailyStats, today),
      mastery: masteryBreakdown(words, progress),
      coverage: usageCoverage(words, progress),
      totals: cumulativeTotals(progress),
      // Only a complete absence of dailyStats counts as a "never studied"
      // new user — that gets the full-page empty state instead of a
      // bunch of empty charts.
      hasHistory: Object.keys(progress.dailyStats).length > 0,
    }
  }, [words, progress, today])

  if (!hasHistory) {
    return (
      <Page eyebrow="Stats" title="学习数据" back="/">
        <div className="empty-state">
          <p className="empty-state__title">还没有学习记录</p>
          <p className="empty-state__hint">复习几个词之后,这里就会有数据。</p>
          <Link className="btn btn--primary" to="/">
            回今日看看
          </Link>
        </div>
      </Page>
    )
  }

  const masteryTotal = mastery.total
  const masteryPct = (n: number) => (masteryTotal === 0 ? 0 : (n / masteryTotal) * 100)

  return (
    <Page eyebrow="Stats" title="学习数据" back="/">
      <Card>
        <p className="section-title stats-section-title">近 30 天复习量</p>
        <ReviewBars days={days} />
      </Card>

      <Card>
        <p className="section-title stats-section-title">正确率趋势</p>
        <AccuracyTrend points={acc} />
      </Card>

      <Card>
        <div className="stats-streak">
          <p className="num stats-streak__value">{streak}</p>
          <p className="stats-streak__label">连续天数</p>
        </div>
        <div className="stats-calendar" role="img" aria-label="近 30 天复习日历,填色表示当天有复习">
          {days.map(d => (
            <span
              key={d.date}
              className={`stats-calendar__cell${d.reviewed > 0 ? ' stats-calendar__cell--filled' : ''}`}
              title={`${d.date} · 复习 ${d.reviewed} 次`}
            />
          ))}
        </div>
      </Card>

      <Card>
        <p className="section-title stats-section-title">词库掌握分布</p>
        <div className="stats-mastery-bar">
          {/* Order matches visual progress: mastered comes first (furthest left), not-yet-learned comes last */}
          <span
            className="stats-mastery-bar__seg stats-mastery-bar__seg--review"
            style={{ width: `${masteryPct(mastery.review)}%` }}
          />
          <span
            className="stats-mastery-bar__seg stats-mastery-bar__seg--learning"
            style={{ width: `${masteryPct(mastery.learning)}%` }}
          />
          <span
            className="stats-mastery-bar__seg stats-mastery-bar__seg--new"
            style={{ width: `${masteryPct(mastery.new)}%` }}
          />
        </div>
        <div className="stats-mastery-chips">
          <Chip label="已掌握" count={mastery.review} interactive={false} />
          <Chip label="学习中" count={mastery.learning} interactive={false} />
          <Chip label="未学" count={mastery.new} interactive={false} />
        </div>
      </Card>

      {/* High-frequency word coverage. The "library mastery breakdown"
          card above counts the total, and totals can lie — the sense of
          achievement from finishing 300 words scoring a 3 is hollow. This
          card answers "how far along are you on the most commonly used
          words"; see statsDerive.usageCoverage for the banding logic. */}
      <Card>
        <p className="section-title stats-section-title">高频词掌握率</p>
        <div className="stats-coverage-headline">
          <p className="num stats-coverage-headline__value">{Math.round(coverage.headline.ratio * 100)}%</p>
          <p className="muted stats-coverage-headline__note">
            遇见概率 7 分以上的 <span className="num">{coverage.headline.total}</span> 个词里,
            已掌握 <span className="num">{coverage.headline.mastered}</span> 个
          </p>
        </div>
        <ul className="stats-coverage">
          {coverage.bands.map(b => (
            <li className="stats-coverage__row" key={b.label}>
              <span className="stats-coverage__label">
                {b.label}
                <span className="num faint stats-coverage__range">{b.range}</span>
              </span>
              <span className="stats-coverage__track">
                <span
                  className="stats-coverage__fill"
                  style={{ width: `${b.total === 0 ? 0 : (b.mastered / b.total) * 100}%` }}
                />
              </span>
              <span className="num muted stats-coverage__count">
                {b.mastered} / {b.total}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="stats-totals">
        <div className="stat">
          <p className="num stat__value">{totals.totalReviewed}</p>
          <p className="stat__label">总复习次数</p>
        </div>
        <div className="stat">
          <p className="num stat__value">{mastery.review}</p>
          <p className="stat__label">已掌握词数</p>
        </div>
        <div className="stat">
          <p className="num stat__value">{totals.avgNewPerActiveDay.toFixed(1)}</p>
          <p className="stat__label">日均新词</p>
        </div>
      </Card>
    </Page>
  )
}

/**
 * Bar chart of reviews over the last 30 days. Hand-rolled SVG (viewBox
 * fixes the width/height + preserveAspectRatio="none"), using vector
 * scaling instead of pixel bar widths — if 30 bars in a 375px card were
 * allocated by pixels, rounding error would accumulate into overflow on
 * narrow screens; viewBox scaling always fills the container width
 * exactly.
 */
function ReviewBars({ days }: { days: DayPoint[] }) {
  const W = 300
  const H = 90
  const n = days.length
  const colW = W / n
  const gap = colW * 0.22
  const barW = colW - gap
  const max = Math.max(0, ...days.map(d => d.reviewed))

  return (
    <svg
      className="stats-bars"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="近 30 天每日复习量柱状图"
    >
      {days.map((d, i) => {
        const fraction = max > 0 ? Math.max(MIN_BAR_FRACTION, d.reviewed / max) : MIN_BAR_FRACTION
        const barH = fraction * H
        return (
          <rect
            key={d.date}
            className="stats-bars__bar"
            x={i * colW + gap / 2}
            y={H - barH}
            width={barW}
            height={barH}
          >
            <title>{`${d.date} · 复习 ${d.reviewed} 次`}</title>
          </rect>
        )
      })}
    </svg>
  )
}

/**
 * Accuracy-trend line chart. Days with null (no review that day) must
 * break the line rather than be plotted at 0 — for the same reason as
 * accuracySeries itself: 0% would falsely claim "everything was wrong that
 * day". Approach: split consecutive non-null points into segments and draw
 * each segment as its own polyline; an isolated point (broken on both
 * sides) is drawn as a lone dot, since a single point can't form a line.
 */
function AccuracyTrend({ points }: { points: AccuracyPoint[] }) {
  const W = 300
  const H = 90
  const PAD_Y = 8
  const n = points.length
  const stepX = n > 1 ? W / (n - 1) : 0
  const yAt = (a: number) => PAD_Y + (1 - a) * (H - 2 * PAD_Y)

  const segments: { x: number; y: number }[][] = []
  let current: { x: number; y: number }[] = []
  points.forEach((p, i) => {
    if (p.accuracy === null) {
      if (current.length > 0) segments.push(current)
      current = []
      return
    }
    current.push({ x: i * stepX, y: yAt(p.accuracy) })
  })
  if (current.length > 0) segments.push(current)

  if (segments.length === 0) {
    return <p className="stats-accuracy-empty muted">这段时间还没有复习记录。</p>
  }

  return (
    <svg
      className="stats-accuracy"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="近 30 天正确率趋势,没有复习的日子不连线"
    >
      {segments.map((seg, i) => (
        <g key={i}>
          {seg.length > 1 && (
            <polyline className="stats-accuracy__line" points={seg.map(p => `${p.x},${p.y}`).join(' ')} />
          )}
          {seg.map((p, j) => (
            <circle key={j} className="stats-accuracy__dot" cx={p.x} cy={p.y} r={2.5} />
          ))}
        </g>
      ))}
    </svg>
  )
}
