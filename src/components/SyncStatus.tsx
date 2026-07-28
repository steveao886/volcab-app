import { Badge } from './Badge'
import type { AppState } from '../state/store'

/**
 * The single presentation surface for sync status. Two shapes, one behavior.
 *
 * badge slots into the header's actions area (today page); note is a
 * sentence inline in the page body (the receipt after adding a word, the
 * failure notice on the library/word detail pages).
 *
 * Behavior is unified as: the three states other than synced — pending /
 * offline / error — are all clickable to retry.
 * offline uses the info tone rather than danger: no network isn't an error,
 * retrying is just trying a bit early.
 * synced is static text, not focusable, not clickable (nothing to retry).
 *
 * "When to show it" is still up to the caller: the today page and add-word
 * page show all four states permanently; the library and word detail pages
 * only surface it when sync has failed (those pages' body content is the
 * word entry itself, which shouldn't be permanently crowded out by a status row).
 */

type SyncStatusValue = AppState['syncStatus']

/** Badge copy and tone. offline uses info, not treated as an error. */
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
  /** badge: header chip; note: full sentence in the body */
  variant?: 'badge' | 'note'
  /** The specific reason sync failed (the store's syncError); spliced into the sentence in note form */
  message?: string | null
  onRetry: () => void
}

export function SyncStatus({ status, variant = 'badge', message = null, onRetry }: SyncStatusProps) {
  if (variant === 'badge') {
    if (status === 'synced') return <Badge>已同步</Badge>
    const { tone, label } = BADGE_COPY[status]
    // Badge itself is a <span>; this outer native <button> handles clickable
    // semantics and keyboard reachability. The hit area is padded vertically
    // to 44px by .sync-badge::after.
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
