import type { ButtonHTMLAttributes, ReactNode } from 'react'

/** 筛选标签。选中态是墨板,与主按钮同一套语言。 */
interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: ReactNode
  selected?: boolean
  /** 右侧计数,等宽数字 */
  count?: number
}

export function Chip({
  label,
  selected = false,
  count,
  className,
  ...rest
}: ChipProps) {
  const classes = ['chip']
  if (className) classes.push(className)

  return (
    <button
      type="button"
      className={classes.join(' ')}
      aria-pressed={selected}
      {...rest}
    >
      {label}
      {count === undefined ? null : <span className="chip__count">{count}</span>}
    </button>
  )
}
