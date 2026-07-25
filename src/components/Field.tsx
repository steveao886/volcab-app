import { cloneElement, isValidElement } from 'react'
import type { ReactNode } from 'react'

interface ControlAria {
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
}

/**
 * 表单字段外壳:标签 + 控件 + 提示/错误。
 * 调用方只要给控件设好 id(与 htmlFor 一致),aria-describedby 与
 * aria-invalid 由这里自动接上 —— 有 error 时控件同时会被
 * `.input[aria-invalid='true']` 描红,不会只有下面一行红字。
 * 调用方自己写的 aria-describedby / aria-invalid 优先保留。
 */
interface FieldProps {
  label: ReactNode
  htmlFor: string
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
}

export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  const hintId = hint === undefined ? null : `${htmlFor}-hint`
  const errorId = error === undefined ? null : `${htmlFor}-error`

  let control: ReactNode = children
  if (isValidElement<ControlAria>(children)) {
    const describedBy = [children.props['aria-describedby'], hintId, errorId]
      .filter(Boolean)
      .join(' ')
    control = cloneElement(children, {
      'aria-describedby': describedBy === '' ? undefined : describedBy,
      'aria-invalid':
        children.props['aria-invalid'] ?? (errorId === null ? undefined : true),
    })
  }

  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {control}
      {hintId === null ? null : (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {errorId === null ? null : (
        <p className="field__error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
