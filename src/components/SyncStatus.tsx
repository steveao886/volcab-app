import { Badge } from './Badge'
import type { AppState } from '../state/store'

/**
 * 同步状态的唯一展示口。两种形态,一套行为。
 *
 * badge 角标塞进页头的 actions 槽(今日页);note 是正文里的一句话
 * (添加新词的回执、词库/词条页的失败提示)。
 *
 * 行为统一为:synced 之外的三态 —— pending / offline / error —— 都可点重试。
 * offline 用 info 色调而不是 danger:没网不是错误,重试也只是提前试一次。
 * synced 是一段静态文字,不可聚焦、不可点(没什么可重试的)。
 *
 * 「什么时候显示」仍由调用方决定:今日页与添加新词页常驻四态,词库页与词条页
 * 只在同步失败时才提示(那两页的正文是词条本身,不该被状态条常年占一行)。
 */

type SyncStatusValue = AppState['syncStatus']

/** 角标文案与色调。offline 走 info,不当成错误。 */
const BADGE_COPY = {
  pending: { tone: 'warning', label: '待同步' },
  offline: { tone: 'info', label: '离线' },
  error: { tone: 'danger', label: '同步失败' },
} as const

const NOTE_COPY = {
  pending: '正在同步…',
  offline: '当前离线,联网后会自动同步。',
} as const

interface SyncStatusProps {
  status: SyncStatusValue
  /** badge:页头角标;note:正文里的整句 */
  variant?: 'badge' | 'note'
  /** 同步失败的具体原因(store 的 syncError),note 形态下拼进句子 */
  message?: string | null
  onRetry: () => void
}

export function SyncStatus({ status, variant = 'badge', message = null, onRetry }: SyncStatusProps) {
  if (variant === 'badge') {
    if (status === 'synced') return <Badge>已同步</Badge>
    const { tone, label } = BADGE_COPY[status]
    // Badge 本身是 <span>,外面这层原生 <button> 负责可点语义与键盘可达;
    // 命中区由 .sync-badge::after 纵向补到 44px。
    return (
      <button type="button" className="sync-badge" onClick={onRetry} aria-label={`${label},点击重试同步`}>
        <Badge tone={tone}>{label}</Badge>
      </button>
    )
  }

  if (status === 'synced') return <p className="sync-note">已同步到云端。</p>

  const failed = status === 'error'
  return (
    <p className={failed ? 'sync-note sync-note--error' : 'sync-note'} role={failed ? 'alert' : undefined}>
      {failed ? `同步失败:${message ?? '未知错误'}` : NOTE_COPY[status]}{' '}
      <button type="button" className="sync-note__retry" onClick={onRetry}>
        重试同步
      </button>
    </p>
  )
}
