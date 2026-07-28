import { cloneElement, isValidElement } from 'react'
import type { ReactNode } from 'react'

interface ControlAria {
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
}

/**
 * Form field shell: label + control + hint/error.
 * The caller just needs to set the control's id (matching htmlFor) —
 * aria-describedby and aria-invalid get wired up automatically here, so
 * when there's an error the control is also outlined red via
 * `.input[aria-invalid='true']`, not just a line of red text below it.
 * Any aria-describedby / aria-invalid the caller sets explicitly is kept as-is.
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
