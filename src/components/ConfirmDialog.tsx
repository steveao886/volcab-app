import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Button } from './Button'

/**
 * Second confirmation for destructive actions (native <dialog> + showModal()).
 *
 * Uses the native dialog instead of a hand-rolled overlay: top-layer
 * stacking, focus trapping, and Esc-to-close all come from the browser for
 * free. The cost is that its open/close is imperative, so this component
 * keeps the "controlled open boolean ↔ showModal/close" ref + effect wiring
 * internal — the caller only has to manage a single piece of state.
 *
 * Esc-to-close doesn't go through the cancel button, it only dispatches a
 * close event, so onClose also has to call back into onCancel — otherwise
 * the dialog closes while the caller's open is still true, and the next
 * click can't reopen it.
 *
 * The confirm button is always solid danger vermilion: this component only
 * serves destructive actions, so other confirmation contexts should not
 * borrow this look (see the color conventions at the top of tokens.css).
 */
interface ConfirmDialogProps {
  /** Controlled open state */
  open: boolean
  /** id of the title element, wired to the dialog's aria-labelledby */
  titleId: string
  title: ReactNode
  /** Explanation under the title: spell out what's lost and whether it's recoverable */
  body: ReactNode
  /** Optional extra block (e.g. a list of headwords about to be deleted), placed after the body */
  detail?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** Confirm action in progress: confirm button spins, cancel is disabled */
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
  // Double/repeat-click guard: set synchronously to block the second click,
  // rather than waiting for `busy` to disable the button on the next render.
  // Unlocked on close, recounted fresh next time it opens.
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
