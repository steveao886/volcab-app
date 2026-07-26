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
/** 全 0 周时柱子仍给一档「最矮但看得见」的高度,不然一排 0 高度的柱子会像页面渲染坏了。 */
const MIN_BAR_PCT = 6

/** Task 16 实现:到期/新词数、连续天数、总进度、开始复习 / 快速测试、同步角标。 */
export function Today() {
  const { words, progress, syncStatus, syncError, syncNow } = useApp()

  const today = todayStr(new Date())
  // useApp() 的 context value 在任何 provider 重渲染时都会是新对象(比如 syncStatus
  // 翻转),这三项推导都要过一遍 476 个词,值没变就不用重算 —— Library 的搜索接下来
  // 会照着这个先例在每次按键时跑同一份数组,这里先立好规矩。
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

  // 「最近」块单独一个 memo,依赖只到 [progress, today] —— 不随词库大小重算,
  // 且遵循上面那条先例:provider 任何一次重渲染 progress 对象都是新的。
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
      // 完全没有 dailyStats 才是「从没学过」的新用户;七天窗口恰好全 0(比如活动
      // 都发生在七天前)不算 —— 那是柱状图取「最矮档」的场景,不是空状态的场景。
      hasHistory: Object.keys(progress.dailyStats).length > 0,
    }
  }, [progress, today])

  return (
    <Page
      eyebrow="Today"
      title="今日"
      actions={<SyncStatus status={syncStatus} onRetry={() => void syncNow()} />}
    >
      {/* 角标只有「同步失败」四个字,装不下要给用户看的那句话 —— 而 §8 里最要紧的
          一条(远端文件损坏,请先导出备份再操作)正是靠这句话传达。首页是用户最
          常打开的一屏,失败原因必须在这里说全,不能只留在词库/词条页。 */}
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
          // 队列为空时按钮直接禁用:Review 页此刻没有可复习的内容可导航,
          // 用禁用态比「点进去看一个空页面」更诚实。
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
        {/* 顽固词入口只在真有顽固词时出现:一个恒亮的「专攻错得最多的 0 个词」
            按钮毫无意义,而且会把两个主操作挤成三选一。 */}
        {lapseCount > 0 && (
          <Link to="/review?mode=lapses" className="btn btn--ghost btn--block today-lapse">
            专攻顽固词
            <span className="num today-lapse__count">{lapseCount}</span>
          </Link>
        )}
      </div>

      {/* 「最近」——统计页的入口,不进底部导航(四格已满,见 v1.1 §5.2)。
          近 7 天复习量柱状图纯手写 CSS,不引图表库。 */}
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
