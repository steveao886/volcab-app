import type { ReactNode } from 'react'

/**
 * 表单字段外壳:标签 + 控件 + 提示/错误。
 * 控件由调用方传入并自行设置 id(与 htmlFor 一致);
 * 提示与错误分别拿到 `${htmlFor}-hint` / `${htmlFor}-error`,
 * 需要时可在控件上写 aria-describedby 指过来。
 */
interface FieldProps {
  label: ReactNode
  htmlFor: string
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
}

export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint === undefined ? null : (
        <p className="field__hint" id={`${htmlFor}-hint`}>
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p className="field__error" id={`${htmlFor}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
