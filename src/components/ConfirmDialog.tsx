import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Button } from './Button'

/**
 * 破坏性操作的二次确认(原生 <dialog> + showModal())。
 *
 * 用原生 dialog 而不是自己搭浮层:顶层堆叠、焦点陷阱、Esc 关闭都由浏览器提供。
 * 代价是它的开合是命令式的,所以这里把「受控的 open 布尔值 ↔ showModal/close」
 * 这段 ref + effect 的接线收在组件内部 —— 调用方只管一个 state。
 *
 * Esc 关闭不会经过取消按钮,只会派发 close 事件,所以 onClose 也要接回 onCancel,
 * 否则弹窗关了而调用方的 open 还是 true,再点一次就打不开了。
 *
 * 确认按钮固定是 danger 实心朱砂:本组件只服务于破坏性操作,
 * 别的确认场景不要借这里的外观(见 tokens.css 顶部的用色约定)。
 */
interface ConfirmDialogProps {
  /** 受控开合 */
  open: boolean
  /** 标题元素的 id,接到 dialog 的 aria-labelledby 上 */
  titleId: string
  title: ReactNode
  /** 标题下的说明:说清楚会丢什么、能不能恢复 */
  body: ReactNode
  /** 可选的补充块(如即将删除的词头清单),排在说明之后 */
  detail?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** 确认动作进行中:确认按钮转圈、取消置灰 */
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  titleId,
  title,
  body,
  detail,
  confirmLabel,
  cancelLabel = '取消',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  // 双击/连击守卫:同步置位挡掉第二次点击,不等 busy 在下一次渲染后才把按钮禁用。
  // 关上时解锁,下次打开重新计一次。
  const firedRef = useRef(false)

  useEffect(() => {
    if (!open) firedRef.current = false
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  function handleConfirm() {
    if (busy || firedRef.current) return
    firedRef.current = true
    onConfirm()
  }

  return (
    <dialog ref={dialogRef} className="confirm-dialog" aria-labelledby={titleId} onClose={onCancel}>
      <p className="confirm-dialog__title" id={titleId}>
        {title}
      </p>
      <p className="confirm-dialog__body">{body}</p>
      {detail === undefined ? null : <p className="confirm-dialog__list">{detail}</p>}
      <div className="confirm-dialog__actions">
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button variant="danger" loading={busy} onClick={handleConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  )
}
