import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Page } from '../components/Page'
import { StateDot } from '../components/StateDot'
import { MATURE_INTERVAL_DAYS } from '../lib/queue'
import { RECALL_STEADY_STREAK } from '../lib/senseGroup'
import { todayStr } from '../lib/srs'
import { useApp } from '../state/store'
import { ReviewBars } from './statsCharts'
import {
  cumulativeTotals, dailySeries, dueForecast, forecastLabel, masteryBreakdown, maturitySplit,
  MODE_ACCURACY_MIN, modeAccuracy, recallProduction, retentionStats, shortDate, usageCoverage,
  windowSummary,
} from './statsDerive'
import { computeStreak, longestStreak } from './todayStats'
import './Stats.css'

const WINDOW_DAYS = 30
const FORECAST_DAYS = 7

const pct = (ratio: number) => Math.round(ratio * 100)

/**
 * Reviews over the last 30 days, retention, streak, upcoming review load,
 * library mastery, how much is held long-term, 回想 production,
 * high-frequency coverage, per-mode accuracy, cumulative totals.
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
      summary: windowSummary(days),
      retention: retentionStats(progress, today, WINDOW_DAYS),
      streak: computeStreak(progress.dailyStats, today),
      best: longestStreak(progress.dailyStats),
      mastery: masteryBreakdown(words, progress),
      maturity: maturitySplit(words, progress),
      production: recallProduction(words, progress),
      coverage: usageCoverage(words, progress),
      forecast: dueForecast(words, progress, today, FORECAST_DAYS),
      totals: cumulativeTotals(progress),
      modes: modeAccuracy(progress),
      // Only a complete absence of dailyStats counts as a "never studied"
      // new user — that gets the full-page empty state instead of a
      // bunch of empty charts.
      hasHistory: Object.keys(progress.dailyStats).length > 0,
    }
  }, [words, progress, today])
  const {
    days, summary, retention, streak, best, mastery, maturity, production,
    totals, modes, coverage, forecast, hasHistory,
  } = derived

  if (!hasHistory) {
    return (
      <Page title="学习数据">
        <div className="empty-state">
          <p className="empty-state__title">还没有学习记录</p>
          <p className="empty-state__hint">复习几个词之后，这里就会有数据。</p>
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
    <Page title="学习数据">
      {/* Every section is a ruled head and its content on the paper; the
          cards they sat in went with round 2 of 朱批. Each leads with one
          .readout — the number in ink, its label under it — and a sentence
          of context beside it. */}
      <section className="section">
        <h2 className="section-head">近 {WINDOW_DAYS} 天复习量</h2>
        <div className="stats-lead">
          <div className="readout">
            <p className="readout__value">{summary.reviewed}</p>
            <p className="readout__label">次复习</p>
          </div>
          <p className="stats-lead__note">
            覆盖 <span className="num">{summary.activeDays}</span> / {WINDOW_DAYS} 天
            {peak !== null && (
              <>
                ，最多的一天 <span className="num">{peak.reviewed}</span> 次（{shortDate(peak.date)}）
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
      </section>

      {/* Retention is the number that says whether the schedule is right.
          It is not raw answer accuracy, which runs several points lower
          purely because every new word costs two learning-step grades —
          that figure had its own trend chart here until 2026-09-23. */}
      {retention.rate !== null && (
        <section className="section">
          <h2 className="section-head">真实留存率</h2>
          <div className="stats-lead">
            <div className="readout">
              <p className="readout__value">{pct(retention.rate)}%</p>
              <p className="readout__label">到期复习记住的</p>
            </div>
            <p className="stats-lead__note">
              近 {WINDOW_DAYS} 天 <span className="num">{retention.correct}</span> /{' '}
              <span className="num">{retention.reviewed}</span> 次
            </p>
          </div>
          <p className="faint stats-note">
            只统计已毕业的词，不含新词的学习步骤，也不含练习。间隔重复通常以 90% 为目标 —— 明显高于它，说明可以把间隔放长。
          </p>
        </section>
      )}

      {/* 答题正确率趋势 stood here: a 30-day accuracy line with its average,
          best, worst and latest day. Removed on 2026-09-23 at the user's
          request. It ran several points under retention purely because new
          words' learning steps count, and the retention figure above is the
          one that says whether the schedule is right. */}

      {/* Three readouts under 界栏 rules. The current streak used to be the
          one cinnabar number on the page; a streak is not a mark. */}
      <section className="section">
        <h2 className="section-head">连续学习</h2>
        <div className="readouts">
          <div className="readout">
            <p className="readout__value">
              {streak}
              <span className="stats-unit">天</span>
            </p>
            <p className="readout__label">当前连续</p>
          </div>
          <div className="readout">
            <p className="readout__value">
              {best}
              <span className="stats-unit">天</span>
            </p>
            <p className="readout__label">最长连续</p>
          </div>
          <div className="readout">
            <p className="readout__value">
              {totals.activeDays}
              <span className="stats-unit">天</span>
            </p>
            <p className="readout__label">累计学习</p>
          </div>
        </div>
      </section>

      {/* The only forward-looking section on the page. Everything else scores
          what already happened; this one answers "what does the coming week
          cost me", which is the question that can still change a decision.
          The counts come from the same due rule as buildQueue, so today's
          row always matches the Today page's "due today". */}
      <section className="section">
        <h2 className="section-head">未来 {FORECAST_DAYS} 天待复习</h2>
        <div className="stats-lead">
          <div className="readout">
            <p className="readout__value">{forecastWeek}</p>
            <p className="readout__label">个词将到期</p>
          </div>
          <p className="stats-lead__note">
            更远的还有 <span className="num">{forecast.beyond}</span> 个，已排期共{' '}
            <span className="num">{forecast.total}</span> 个
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
      </section>

      <section className="section">
        <h2 className="section-head">词库掌握分布</h2>
        {/* A state breakdown is status, not a category: it keeps the
            --state-* colors every state mark in the app uses, and the legend
            under it prints each state's mark shape and name, so no segment
            is told apart by color alone. */}
        <div className="stats-mastery-bar">
          {/* Order matches visual progress: mastered comes first (furthest
              left), not-yet-learned comes last. An empty state draws no
              segment at all, so it takes no 2px gap of its own. */}
          {(['review', 'learning', 'new'] as const).map(s => mastery[s] > 0 && (
            <span
              key={s}
              className={`stats-mastery-bar__seg stats-mastery-bar__seg--${s}`}
              style={{ width: `${masteryPct(mastery[s])}%` }}
            />
          ))}
        </div>
        {/* The percentage rides beside the count rather than replacing it:
            the count is what you compare against the library size, the
            percentage is what you compare against the bar above. */}
        <ul className="stats-legend stats-mastery-legend">
          <li>
            <StateDot state="review" />
            已掌握 <span className="num">{mastery.review}</span>
            <span className="num faint">{pct(masteryPct(mastery.review) / 100)}%</span>
          </li>
          <li>
            <StateDot state="learning" />
            学习中 <span className="num">{mastery.learning}</span>
            <span className="num faint">{pct(masteryPct(mastery.learning) / 100)}%</span>
          </li>
          <li>
            <StateDot state="new" />
            未学 <span className="num">{mastery.new}</span>
            <span className="num faint">{pct(masteryPct(mastery.new) / 100)}%</span>
          </li>
        </ul>
        <p className="faint stats-note">
          词库共 <span className="num">{mastery.total}</span> 个词。
        </p>
      </section>

      {/* 已掌握 above only says a word finished its learning steps, which it
          does after a day — on 2026-09-23 every studied word in the live
          library was 已掌握. This is how many of them are held long-term, at
          the app's own line for "known" (MATURE_INTERVAL_DAYS, queue.ts). */}
      {maturity.studied > 0 && (
        <section className="section">
          <h2 className="section-head">记牢程度</h2>
          <div className="stats-lead">
            <div className="readout">
              <p className="readout__value">{pct(maturity.mature / maturity.studied)}%</p>
              <p className="readout__label">间隔已过 {MATURE_INTERVAL_DAYS} 天</p>
            </div>
            <p className="stats-lead__note">
              学过的 <span className="num">{maturity.studied}</span> 个词里有{' '}
              <span className="num">{maturity.mature}</span> 个；其余{' '}
              <span className="num">{maturity.young}</span> 个间隔还不到 {MATURE_INTERVAL_DAYS} 天，仍在巩固
            </p>
          </div>
          <p className="faint stats-note">
            {MATURE_INTERVAL_DAYS} 天是间隔重复里“记牢”的通行分界。上面的“已掌握”只说明词走完了新词步骤，第二天就算。
          </p>
        </section>
      )}

      {/* Recognition is what the schedule measures; 回想 measures whether the
          word comes to mind from Chinese, and the two come apart. The record
          has been kept per word since 回想 shipped and was only ever shown one
          word at a time, on 词条详情. Absent until 回想 has asked anything. */}
      {production.asked > 0 && (
        <section className="section">
          <h2 className="section-head">回想说出</h2>
          <div className="readouts">
            <div className="readout">
              <p className="readout__value">{production.asked}</p>
              <p className="readout__label">回想问过</p>
            </div>
            <div className="readout">
              <p className="readout__value">{production.steady}</p>
              <p className="readout__label">连对 {RECALL_STEADY_STREAK} 次以上</p>
            </div>
            <div className="readout">
              <p className="readout__value">{production.lastMissed}</p>
              <p className="readout__label">上次没说出</p>
            </div>
          </div>
          <p className="faint stats-note">
            复习考的是认不认得，回想考的是说不说得出：一个词可以排到一个月后，却仍然说不出来。
          </p>
        </section>
      )}

      {/* High-frequency word coverage. The "library mastery breakdown"
          section above counts the total, and totals can lie — the sense of
          achievement from finishing 300 words scoring a 3 is hollow. This
          section answers "how far along are you on the most commonly used
          words"; see statsDerive.usageCoverage for the banding logic. */}
      <section className="section">
        <h2 className="section-head">高频词掌握率</h2>
        <div className="stats-lead">
          <div className="readout">
            <p className="readout__value">{pct(coverage.headline.ratio)}%</p>
            <p className="readout__label">高频词已掌握</p>
          </div>
          <p className="stats-lead__note">
            遇见概率 7 分以上的 <span className="num">{coverage.headline.total}</span> 个词里，已掌握{' '}
            <span className="num">{coverage.headline.mastered}</span> 个
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
      </section>

      {/* The 还没记牢的词 card stood here, listing the five worst words with
          a 专攻 → link to /review?mode=lapses. Both halves failed. The link
          landed on an empty page as often as not — the drill is a daily
          task, so it filters out anything already reviewed today, refuses a
          second pass, and caps at 20, none of which a card offering "these
          54 words, now" can honour. And the list itself was not what the
          user wanted from it: practising those words was, which is what
          /practice is for. Removed rather than repaired, on the user's call.

          The ranking is untouched — rankStrugglingWords still drives the
          drill queue, the Today row and tuning. It just no longer has a
          page that names it. */}

      {/* Per-mode, never blended: the seven surfaces test different things
          at different difficulties, so one combined figure moves more when
          you switch modes than when your recall changes. Absent entirely
          until a mode has been played — no data is a different claim from
          no success. */}
      {modes.length > 0 && (
        <section className="section">
          <h2 className="section-head">各模式正确率</h2>
          <ul className="stats-modes">
            {modes.map(m => (
              <li key={m.mode} className="stats-mode">
                <span className="stats-mode__label">{m.label}</span>
                <span className="stats-mode__bar" aria-hidden="true">
                  <span
                    className="stats-mode__fill"
                    style={{ width: m.asked >= MODE_ACCURACY_MIN ? `${m.rate * 100}%` : '0%' }}
                  />
                </span>
                {/* Under the floor the percentage is suppressed rather than
                    the row: one miss out of five swings it 20 points, which
                    reads as a skill change and isn't one. */}
                <span className="num stats-mode__rate">
                  {m.asked >= MODE_ACCURACY_MIN ? `${Math.round(m.rate * 100)}%` : '题量不足'}
                </span>
                <span className="muted num stats-mode__count">{m.correct}/{m.asked}</span>
              </li>
            ))}
          </ul>
          {/* 猜词 counts a clue-assisted solve as correct — that is the
              mode's own definition (see its spec: solved with clues still
              counts as retrieved) and keeping it makes the column
              comparable across modes. But it does mean the figure runs
              high, so the sharper number is named here rather than left to
              be inferred. */}
          {modes.some(m => m.mode === 'guess') && (
            <p className="faint stats-note">猜词按「答出来了」计，买了线索也算 —— 零线索的成绩见下方纪录。</p>
          )}
        </section>
      )}

      {/* The totals as a readout grid, 界栏 rules between the cells: three
          to a row at 375px, however many records exist. */}
      <section className="section">
        <h2 className="section-head">累计</h2>
        <div className="readouts">
          <div className="readout">
            <p className="readout__value">{totals.totalReviewed}</p>
            <p className="readout__label">总复习次数</p>
          </div>
          <div className="readout">
            <p className="readout__value">{mastery.review}</p>
            <p className="readout__label">已掌握词数</p>
          </div>
          <div className="readout">
            <p className="readout__value">{totals.avgNewPerActiveDay.toFixed(1)}</p>
            <p className="readout__label">日均新词</p>
          </div>
          <div className="readout">
            <p className="readout__value">{totals.totalQuizzes}</p>
            <p className="readout__label">测验次数</p>
          </div>
          {/* "A personal best of 0 isn't a record, it's a reminder that you
              haven't played" — which is what this comment always said, while
              the condition only checked for the field's absence. Both
              settlements write a record on the first session whatever the
              score (`bestX === undefined || score > bestX.score`), so a
              first round scoring nothing produced a proud 0. Guess made it
              visible: zero unaided solves is an ordinary beginner's round,
              not a rarity like scoring nothing in a 60-second sprint. */}
          {progress.bestSprint !== undefined && progress.bestSprint.score > 0 && (
            <div className="readout">
              <p className="readout__value">{progress.bestSprint.score}</p>
              <p className="readout__label">冲刺纪录</p>
            </div>
          )}
          {/* The unaided count, on the same terms as the sprint record. Its
              own spec calls this the only honest scoreboard a single-player
              app has — and it had been stored and merged since the mode
              shipped without ever being displayed anywhere. It is also the
              number the accuracy row above cannot give: solving with every
              clue bought still counts as solved there. */}
          {progress.bestGuess !== undefined && progress.bestGuess.score > 0 && (
            <div className="readout">
              <p className="readout__value">{progress.bestGuess.score}</p>
              <p className="readout__label">猜词零线索</p>
            </div>
          )}
        </div>
      </section>
    </Page>
  )
}
