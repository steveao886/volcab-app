import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import { SyncStatus } from '../components/SyncStatus'
import { buildQueue } from '../lib/queue'
import { todayStr } from '../lib/srs'
import { useApp } from '../state/store'
import { computeStreak, reviewProgress } from './todayStats'
import './Today.css'

/** Task 16 实现:到期/新词数、连续天数、总进度、开始复习 / 快速测试、同步角标。 */
export function Today() {
  const { words, progress, syncStatus, syncNow } = useApp()

  const today = todayStr(new Date())
  // useApp() 的 context value 在任何 provider 重渲染时都会是新对象(比如 syncStatus
  // 翻转),这三项推导都要过一遍 476 个词,值没变就不用重算 —— Library 的搜索接下来
  // 会照着这个先例在每次按键时跑同一份数组,这里先立好规矩。
  const { due, fresh, streak, count, total, ratio, queueEmpty } = useMemo(() => {
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
    }
  }, [words, progress, today])

  return (
    <Page
      eyebrow="Today"
      title="今日"
      actions={<SyncStatus status={syncStatus} onRetry={() => void syncNow()} />}
    >
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
      </div>
    </Page>
  )
}
