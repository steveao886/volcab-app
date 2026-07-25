import { Link } from 'react-router-dom'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import { buildQueue } from '../lib/queue'
import { todayStr } from '../lib/srs'
import { useApp } from '../state/store'
import type { AppState } from '../state/store'
import { computeStreak, reviewProgress } from './todayStats'
import './Today.css'

/**
 * 同步状态角标。
 * synced 只是一段静态文字(非焦点元素);pending/offline/error 三态包一层原生
 * <button>,点击调用 syncNow() 重试推送 —— offline 用 info 色调,不当成错误处理。
 */
function SyncBadge({
  status,
  onRetry,
}: {
  status: AppState['syncStatus']
  onRetry: () => void
}) {
  if (status === 'synced') return <Badge>已同步</Badge>
  const copy = {
    pending: { tone: 'warning', label: '待同步' },
    offline: { tone: 'info', label: '离线' },
    error: { tone: 'danger', label: '同步失败' },
  } as const
  const { tone, label } = copy[status]
  return (
    <button
      type="button"
      className="today-sync"
      onClick={onRetry}
      aria-label={`${label},点击重试同步`}
    >
      <Badge tone={tone}>{label}</Badge>
    </button>
  )
}

/** Task 16 实现:到期/新词数、连续天数、总进度、开始复习 / 快速测试、同步角标。 */
export function Today() {
  const { words, progress, syncStatus, syncNow } = useApp()

  const today = todayStr(new Date())
  const { due, fresh } = buildQueue(words, progress, today)
  const streak = computeStreak(progress.dailyStats, today)
  const { count, total, ratio } = reviewProgress(words, progress)
  const queueEmpty = due.length === 0 && fresh.length === 0

  return (
    <Page
      eyebrow="Today"
      title="今日"
      actions={<SyncBadge status={syncStatus} onRetry={() => void syncNow()} />}
    >
      <Card className="today-stats">
        <div className="today-stat">
          <p className="num today-stat__value">{due.length}</p>
          <p className="today-stat__label">今日到期</p>
        </div>
        <div className="today-stat">
          <p className="num today-stat__value">{fresh.length}</p>
          <p className="today-stat__label">新词</p>
        </div>
        <div className="today-stat">
          <p className="num today-stat__value today-stat__value--accent">{streak}</p>
          <p className="today-stat__label">连续天数</p>
        </div>
      </Card>

      <Card className="today-progress">
        <div className="today-progress__head">
          <p className="today-progress__label">总进度</p>
          <p className="num muted">
            {count} / {total}
          </p>
        </div>
        <div className="progress">
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
