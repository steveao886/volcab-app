import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../components/Card'
import { Chip } from '../components/Chip'
import { Page } from '../components/Page'
import { todayStr } from '../lib/srs'
import { useApp } from '../state/store'
import { AccuracyTrend, ReviewBars } from './statsCharts'
import {
  accuracySeries, accuracyStats, cumulativeTotals, dailySeries, dueForecast, forecastLabel,
  masteryBreakdown, retentionStats, shortDate, strugglingSummary, usageCoverage, windowSummary,
} from './statsDerive'
import { computeStreak, longestStreak } from './todayStats'
import './Stats.css'

const WINDOW_DAYS = 30
const FORECAST_DAYS = 7
/** Five is enough to recognise the pattern; the full list is one tap away in the lapse session. */
const TOP_STRUGGLING = 5

const pct = (ratio: number) => Math.round(ratio * 100)

/**
 * Reviews over the last 30 days, accuracy trend, streak, upcoming review
 * load, library mastery, stubborn words, cumulative totals.
 *
 * Every metric is derived purely from progress.dailyStats and each word's
 * state — no review log is stored, per v1.1 spec §5.1: progress.json goes
 * through the GitHub Contents API's 1 MB read limit, and a full log would
 * hit that ceiling in roughly 9 months, at which point new devices
 * couldn't sign in. So this can chart "volume" and "rate" trends, but not
 * word-level history or time-of-day analysis.
 *
 * **Every chart is annotated with the numbers it is drawn from.** The page
 * used to be shapes only — an unlabelled bar chart, an unlabelled line, and
 * a calendar of filled squares — which meant it could show that a month was
 * busier than another but never how much, and a reader had no way to check
 * a trend against a figure. Axis labels, headline totals and per-row counts
 * are not decoration here; they are the content.
 */
export function Stats() {
  const { words, progress } = useApp()
  const today = todayStr(new Date())

  // useApp()'s context value is a new object on every provider render
  // (background sync heartbeats count too), and deriving this requires
  // iterating every entry — it shouldn't recompute when nothing actually
  // changed, the same precedent as Today.tsx.
  const derived = useMemo(() => {
    const days = dailySeries(progress, today, WINDOW_DAYS)
    return {
      days,
      acc: accuracySeries(progress, today, WINDOW_DAYS),
      summary: windowSummary(days),
      accStats: accuracyStats(days),
      retention: retentionStats(progress, today, WINDOW_DAYS),
      streak: computeStreak(progress.dailyStats, today),
      best: longestStreak(progress.dailyStats),
      mastery: masteryBreakdown(words, progress),
      coverage: usageCoverage(words, progress),
      forecast: dueForecast(words, progress, today, FORECAST_DAYS),
      struggling: strugglingSummary(words, progress, TOP_STRUGGLING),
      totals: cumulativeTotals(progress),
      // Only a complete absence of dailyStats counts as a "never studied"
      // new user — that gets the full-page empty state instead of a
      // bunch of empty charts.
      hasHistory: Object.keys(progress.dailyStats).length > 0,
    }
  }, [words, progress, today])
  const {
    days, acc, summary, accStats, retention, streak, best, mastery,
    totals, coverage, forecast, struggling, hasHistory,
  } = derived

  if (!hasHistory) {
    return (
      <Page eyebrow="Stats" title="学习数据">
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
  const xLeft = shortDate(days[0].date)
  const peak = summary.peak
  const forecastWeek = forecast.days.reduce((n, d) => n + d.count, 0)
  // The bars are scaled against the busiest day rather than the total, so a
  // quiet week next to one heavy day still reads as quiet.
  const forecastMax = Math.max(1, ...forecast.days.map(d => d.count))

  return (
    <Page eyebrow="Stats" title="学习数据">
      <Card>
        <p className="section-title stats-section-title">近 {WINDOW_DAYS} 天复习量</p>
        <div className="stats-headline">
          <p className="num stats-headline__value">{summary.reviewed}</p>
          <p className="muted stats-headline__note">
            次复习,覆盖 <span className="num">{summary.activeDays}</span> / {WINDOW_DAYS} 天
            {peak !== null && (
              <>
                {' · '}最多的一天 <span className="num">{peak.reviewed}</span> 次({shortDate(peak.date)})
              </>
            )}
          </p>
        </div>
        <ReviewBars days={days} max={peak?.reviewed ?? 0} xLeft={xLeft} xRight="今天" />
        <ul className="stats-legend">
          <li>
            <span className="stats-legend__swatch stats-legend__swatch--review" />
            复习旧词 <span className="num">{summary.reviewed - summary.newLearned}</span>
          </li>
          <li>
            <span className="stats-legend__swatch stats-legend__swatch--new" />
            学习新词 <span className="num">{summary.newLearned}</span>
          </li>
          <li>
            <span className="stats-legend__swatch stats-legend__swatch--zero" />
            没有学习
          </li>
        </ul>
      </Card>

      {/* Retention is the number that says whether the schedule is right,
          and it is not the accuracy below it. Kept on its own card, above
          the chart, because putting two percentages side by side without
          explaining the difference is how the wrong one gets acted on —
          the accuracy figure runs several points lower purely because
          every new word costs two learning-step grades. */}
      {retention.rate !== null && (
        <Card>
          <p className="section-title stats-section-title">真实留存率</p>
          <div className="stats-headline">
            <p className="num stats-headline__value">{pct(retention.rate)}%</p>
            <p className="muted stats-headline__note">
              到期复习的词里记住的比例 · 近 {WINDOW_DAYS} 天 <span className="num">{retention.correct}</span> /{' '}
              <span className="num">{retention.reviewed}</span> 次
            </p>
          </div>
          <p className="faint stats-note">
            只统计已毕业的词,不含新词的学习步骤,也不含练习。间隔重复通常以 90% 为目标 —— 明显高于它,说明可以把间隔放长。
          </p>
        </Card>
      )}

      <Card>
        <p className="section-title stats-section-title">答题正确率趋势</p>
        {accStats.average === null ? (
          <p className="stats-accuracy-empty muted">这段时间还没有复习记录。</p>
        ) : (
          <>
            <div className="stats-headline">
              <p className="num stats-headline__value">{pct(accStats.average)}%</p>
              <p className="muted stats-headline__note">
                近 {WINDOW_DAYS} 天平均,含新词的学习步骤 · <span className="num">{accStats.ratedDays}</span> 天有记录
              </p>
            </div>
            <AccuracyTrend points={acc} average={accStats.average} xLeft={xLeft} xRight="今天" />
            <ul className="stats-legend">
              {accStats.best !== null && (
                <li>
                  最高 <span className="num">{pct(accStats.best.accuracy)}%</span>
                  <span className="num faint">{shortDate(accStats.best.date)}</span>
                </li>
              )}
              {accStats.worst !== null && (
                <li>
                  最低 <span className="num">{pct(accStats.worst.accuracy)}%</span>
                  <span className="num faint">{shortDate(accStats.worst.date)}</span>
                </li>
              )}
              {accStats.latest !== null && (
                <li>
                  最近 <span className="num">{pct(accStats.latest.accuracy)}%</span>
                  <span className="num faint">{shortDate(accStats.latest.date)}</span>
                </li>
              )}
            </ul>
          </>
        )}
      </Card>

      <Card className="stats-tiles">
        <div className="stat">
          <p className="num stat__value stat__value--accent">
            {streak}
            <span className="stats-unit">天</span>
          </p>
          <p className="stat__label">当前连续</p>
        </div>
        <div className="stat">
          <p className="num stat__value">
            {best}
            <span className="stats-unit">天</span>
          </p>
          <p className="stat__label">最长连续</p>
        </div>
        <div className="stat">
          <p className="num stat__value">
            {totals.activeDays}
            <span className="stats-unit">天</span>
          </p>
          <p className="stat__label">累计学习</p>
        </div>
      </Card>

      {/* The only forward-looking card on the page. Everything else scores
          what already happened; this one answers "what does the coming week
          cost me", which is the question that can still change a decision.
          The counts come from the same due rule as buildQueue, so today's
          row always matches the Today page's "due today". */}
      <Card>
        <p className="section-title stats-section-title">未来 {FORECAST_DAYS} 天待复习</p>
        <div className="stats-headline">
          <p className="num stats-headline__value">{forecastWeek}</p>
          <p className="muted stats-headline__note">
            个词将在 {FORECAST_DAYS} 天内到期 · 更远的还有 <span className="num">{forecast.beyond}</span> 个,
            已排期共 <span className="num">{forecast.total}</span> 个
          </p>
        </div>
        <ul className="stats-rows">
          {forecast.days.map(d => (
            <li className="stats-row" key={d.date}>
              <span className="stats-row__label">
                {forecastLabel(d.date, today)}
                <span className="num faint stats-row__sub">{shortDate(d.date)}</span>
              </span>
              <span className="stats-row__track">
                <span className="stats-row__fill" style={{ width: `${(d.count / forecastMax) * 100}%` }} />
              </span>
              <span className="num stats-row__count">{d.count}</span>
            </li>
          ))}
        </ul>
        <p className="faint stats-note">“今天”一栏含已经过期的词。</p>
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
        {/* The percentage rides on the chip label rather than replacing the
            count: the count is what you compare against the library size,
            the percentage is what you compare against the bar above. */}
        <div className="stats-mastery-chips">
          <Chip
            label={<>已掌握 <span className="num faint">{pct(masteryPct(mastery.review) / 100)}%</span></>}
            count={mastery.review}
            interactive={false}
          />
          <Chip
            label={<>学习中 <span className="num faint">{pct(masteryPct(mastery.learning) / 100)}%</span></>}
            count={mastery.learning}
            interactive={false}
          />
          <Chip
            label={<>未学 <span className="num faint">{pct(masteryPct(mastery.new) / 100)}%</span></>}
            count={mastery.new}
            interactive={false}
          />
        </div>
        <p className="faint stats-note">
          词库共 <span className="num">{mastery.total}</span> 个词。
        </p>
      </Card>

      {/* High-frequency word coverage. The "library mastery breakdown"
          card above counts the total, and totals can lie — the sense of
          achievement from finishing 300 words scoring a 3 is hollow. This
          card answers "how far along are you on the most commonly used
          words"; see statsDerive.usageCoverage for the banding logic. */}
      <Card>
        <p className="section-title stats-section-title">高频词掌握率</p>
        <div className="stats-headline">
          <p className="num stats-headline__value">{pct(coverage.headline.ratio)}%</p>
          <p className="muted stats-headline__note">
            遇见概率 7 分以上的 <span className="num">{coverage.headline.total}</span> 个词里,
            已掌握 <span className="num">{coverage.headline.mastered}</span> 个
          </p>
        </div>
        <ul className="stats-rows">
          {coverage.bands.map(b => (
            <li className="stats-row" key={b.label}>
              <span className="stats-row__label">
                {b.label}
                <span className="num faint stats-row__sub">{b.range}</span>
              </span>
              <span className="stats-row__track">
                <span
                  className="stats-row__fill"
                  style={{ width: `${b.total === 0 ? 0 : (b.mastered / b.total) * 100}%` }}
                />
              </span>
              <span className="stats-row__count">
                <span className="num">{b.total === 0 ? 0 : pct(b.mastered / b.total)}%</span>
                <span className="num faint stats-row__sub">
                  {b.mastered}/{b.total}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {/* Names the words that aren't sticking *right now*, ranked by the
          scheduler's own difficulty estimate — not the lifetime lapse
          ledger this card used to be, which visibly never changed (see the
          2026-08-05 struggling-words spec). An absent card honestly means
          nothing is currently shaky. The row tag stays in lapse counts
          because "忘 3 次" is self-explanatory where an ease number is
          jargon; "偏难" marks the words that were only ever graded hard. */}
      {struggling.total > 0 && (
        <Card>
          <div className="stats-card-head">
            <p className="section-title stats-section-title">还没记牢的词</p>
            <Link to="/review?mode=lapses" className="stats-card-head__link">
              专攻 →
            </Link>
          </div>
          <ul className="stats-lapses">
            {struggling.top.map(({ word, lapses: n }) => (
              <li key={word.id}>
                <Link to={`/word/${word.id}`} className="stats-lapse">
                  <span className="word stats-lapse__word" lang="en">
                    {word.headword}
                  </span>
                  <span className="muted stats-lapse__zh">{word.meanings[0]?.zh ?? ''}</span>
                  <span className="num stats-lapse__count">{n > 0 ? `忘 ${n} 次` : '偏难'}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="faint stats-note">
            共 <span className="num">{struggling.total}</span> 个词还没记牢。
          </p>
        </Card>
      )}

      <Card className="stats-tiles">
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
        <div className="stat">
          <p className="num stat__value">{totals.totalQuizzes}</p>
          <p className="stat__label">测验次数</p>
        </div>
        {/* Only shown once a sprint has actually been run: a personal best
            of 0 isn't a record, it's a reminder that you haven't played. */}
        {progress.bestSprint !== undefined && (
          <div className="stat">
            <p className="num stat__value">{progress.bestSprint.score}</p>
            <p className="stat__label">冲刺纪录</p>
          </div>
        )}
      </Card>
    </Page>
  )
}
