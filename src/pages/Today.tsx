import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import { SyncStatus } from '../components/SyncStatus'
import { buildLapseQueue, buildQueue } from '../lib/queue'
import { todayStr } from '../lib/srs'
import { useApp } from '../state/store'
import { accuracySeries, dailySeries } from './statsDerive'
import { computeStreak, reviewProgress } from './todayStats'
import './Today.css'

const RECENT_DAYS = 7
/** Even in an all-zero week, bars still get a "shortest but still visible" height, otherwise a row of zero-height bars would look like the page is broken. */
const MIN_BAR_PCT = 6

/** Task 16 implementation: due/new word counts, streak days, overall progress, start review / quick quiz, sync badge. */
export function Today() {
  const { words, progress, syncStatus, syncError, syncNow } = useApp()

  const today = todayStr(new Date())
  // useApp()'s context value is a new object on any provider re-render
  // (e.g. syncStatus flipping), and all three of these derivations require
  // iterating 476 words — they shouldn't recompute when nothing actually
  // changed. Library's search will later follow this same precedent for an
  // array recomputed on every keystroke, so the rule is established here
  // first.
  const { due, fresh, streak, count, total, ratio, queueEmpty, lapseCount } = useMemo(() => {
    const queue = buildQueue(words, progress, today)
    const streak = computeStreak(progress.dailyStats, today)
    const rp = reviewProgress(words, progress)
    return {
      due: queue.due,
      fresh: queue.fresh,
      streak,
      count: rp.count,
      total: rp.total,
      ratio: rp.ratio,
      queueEmpty: queue.due.length === 0 && queue.fresh.length === 0,
      lapseCount: buildLapseQueue(words, progress).length,
    }
  }, [words, progress, today])

  // The "recent" block gets its own separate memo, depending only on
  // [progress, today] — it doesn't recompute with library size, and it
  // follows the same precedent above: on any provider re-render, the
  // progress object is a new reference.
  const { recentDays, weekMax, weekAccuracy, hasHistory } = useMemo(() => {
    const recentDays = dailySeries(progress, today, RECENT_DAYS)
    const weekMax = Math.max(0, ...recentDays.map(d => d.reviewed))
    const accDays = accuracySeries(progress, today, RECENT_DAYS)
      .map(d => d.accuracy)
      .filter((a): a is number => a !== null)
    const weekAccuracy = accDays.length === 0 ? null : accDays.reduce((s, a) => s + a, 0) / accDays.length
    return {
      recentDays,
      weekMax,
      weekAccuracy,
      // Only a complete absence of dailyStats counts as a "never studied"
      // new user; the seven-day window happening to be all zeros (e.g. all
      // activity happened more than seven days ago) doesn't count — that's
      // the scenario where bars fall back to their shortest height, not
      // the empty-state scenario.
      hasHistory: Object.keys(progress.dailyStats).length > 0,
    }
  }, [progress, today])

  return (
    <Page
      eyebrow="Today"
      title="今日"
      actions={<SyncStatus status={syncStatus} onRetry={() => void syncNow()} />}
    >
      {/* The badge only has room for the words "sync failed" — nowhere
          near enough to hold the sentence the user actually needs to see —
          and the most critical case in §8 (the remote file is corrupted,
          export a backup before doing anything else) depends entirely on
          that sentence getting through. The home screen is the one users
          open most often, so the failure reason must be spelled out in
          full here, not left only on the library/word-detail pages. */}
      {syncStatus === 'error' && syncError !== null && (
        <SyncStatus variant="note" status={syncStatus} message={syncError} onRetry={() => void syncNow()} />
      )}

      <Card className="today-stats">
        <div className="stat">
          <p className="num stat__value">{due.length}</p>
          <p className="stat__label">今日到期</p>
        </div>
        <div className="stat">
          <p className="num stat__value">{fresh.length}</p>
          <p className="stat__label">新词</p>
        </div>
        <div className="stat">
          <p className="num stat__value stat__value--accent">{streak}</p>
          <p className="stat__label">连续天数</p>
        </div>
      </Card>

      <Card className="today-progress">
        <div className="today-progress__head">
          <p className="today-progress__label" id="today-progress-label">
            总进度
          </p>
          <p className="num muted">
            {count} / {total}
          </p>
        </div>
        <div
          className="progress"
          role="progressbar"
          aria-labelledby="today-progress-label"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(ratio * 100)}
        >
          <div className="progress__fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
      </Card>

      <div className="today-actions">
        {queueEmpty ? (
          // The button is simply disabled when the queue is empty: there's
          // nothing on the Review page to navigate to right now, and a
          // disabled state is more honest than "click through to see an
          // empty page".
          <Button variant="primary" size="lg" block disabled>
            今日完成 🎉
          </Button>
        ) : (
          <Link to="/review" className="btn btn--primary btn--lg btn--block">
            开始复习
          </Link>
        )}
        <Link to="/quiz" className="btn btn--secondary btn--lg btn--block">
          快速测试
        </Link>
        {/* The lapsed-words entry point only appears when lapsed words
            actually exist: an always-visible "focus on the 0 words you
            get most wrong" button would be meaningless, and it would also
            crowd the two primary actions into a choice of three. */}
        {lapseCount > 0 && (
          <Link to="/review?mode=lapses" className="btn btn--ghost btn--block today-lapse">
            专攻顽固词
            <span className="num today-lapse__count">{lapseCount}</span>
          </Link>
        )}
      </div>

      {/* "Recent" — the entry point to the stats page; it doesn't get a
          slot in the bottom nav (all four are already taken, see v1.1
          §5.2). The last-7-days review bar chart is entirely hand-rolled
          CSS, with no charting library. */}
      <Link to="/stats" className="card card--interactive today-recent">
        <div className="today-recent__head">
          <p className="today-recent__title">最近</p>
          <span className="today-recent__more muted">查看全部 →</span>
        </div>
        {hasHistory ? (
          <>
            <div className="today-recent__bars" role="img" aria-label={`近 ${RECENT_DAYS} 天每日复习量`}>
              {recentDays.map(d => (
                <div key={d.date} className="today-recent__bar-col">
                  <div
                    className="today-recent__bar"
                    style={{
                      height: `${weekMax > 0 ? Math.max(MIN_BAR_PCT, (d.reviewed / weekMax) * 100) : MIN_BAR_PCT}%`,
                    }}
                  />
                </div>
              ))}
            </div>
            <p className="today-recent__accuracy num muted">
              近 {RECENT_DAYS} 天正确率 {weekAccuracy === null ? '暂无' : `${Math.round(weekAccuracy * 100)}%`}
            </p>
          </>
        ) : (
          <p className="today-recent__empty muted">复习几个词之后,这里会显示最近的学习曲线。</p>
        )}
      </Link>
    </Page>
  )
}
