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
/** 全 0 窗口时柱子仍给一档「最矮但看得见」的高度,理由与 Today 页「最近」块一致。 */
const MIN_BAR_FRACTION = 0.04

/**
 * Task 9 实现:近 30 天复习量、正确率趋势、连续天数与断签日历、词库掌握分布、累计数据。
 *
 * 全部指标只由 progress.dailyStats 与各词的 state 派生 —— 不存复习日志,理由见
 * v1.1 spec §5.1:progress.json 走 GitHub Contents API 的 1 MB 读取上限,完整
 * 日志约 9 个月就会撞顶,届时新设备无法登录。因此这里画得出「量」和「率」的
 * 趋势,画不出单词级历史或时段分析。
 */
export function Stats() {
  const { words, progress } = useApp()
  const today = todayStr(new Date())

  // useApp() 的 context value 每次 provider 渲染都是新对象(后台同步心跳也算),
  // 派生要过一遍全部词条,值没变就不该重算 —— 与 Today.tsx 同一先例。
  const { days, acc, streak, mastery, totals, coverage, hasHistory } = useMemo(() => {
    return {
      days: dailySeries(progress, today, WINDOW_DAYS),
      acc: accuracySeries(progress, today, WINDOW_DAYS),
      streak: computeStreak(progress.dailyStats, today),
      mastery: masteryBreakdown(words, progress),
      coverage: usageCoverage(words, progress),
      totals: cumulativeTotals(progress),
      // 完全没有 dailyStats 才是「从没学过」的新用户 —— 走整页空状态,
      // 不渲染一堆空图表。
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
          {/* 顺序与视觉进度一致:已掌握在前(最靠左),未学在最后 */}
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

      {/* 高频词覆盖率。上面那张「词库掌握分布」数的是总量,而总量会说谎 ——
          学完 300 个 3 分词的成就感是假的。这一张答的是「你在最常用的那批词上
          走到哪了」,分档口径见 statsDerive.usageCoverage。 */}
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
 * 近 30 天复习量柱状图。手写 SVG(viewBox 定宽高 + preserveAspectRatio="none"),
 * 用向量缩放代替像素柱宽 —— 30 根柱子在 375px 卡片里若按像素分配,四舍五入
 * 误差会在窄屏上累积成溢出;viewBox 缩放则永远精确填满容器宽度。
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
 * 正确率趋势折线。null(当天没复习)的日子必须断开而不是画到 0 —— 理由与
 * accuracySeries 本身一致:0% 会谎称「那天全错了」。做法:把连续的非 null
 * 点分段,每段单独画一条 polyline;落单的点(前后都断开)画成一个孤立的点,
 * 因为一个点连不成线。
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
