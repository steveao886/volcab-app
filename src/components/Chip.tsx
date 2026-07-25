import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * chip 有两种用法:
 * - interactive(默认):词库页的筛选开关,渲染 <button aria-pressed>,选中态是墨板
 * - 静态标签:近义词/反义词/搭配/同根词,渲染 <span>,不进 Tab 序列
 *   （复习卡上可能一次出现十几个,全做成按钮会平白多出十几个焦点停靠点)
 */
interface ChipProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: ReactNode
  /** 可点开关;false 时渲染为纯展示标签 */
  interactive?: boolean
  selected?: boolean
  /** 右侧计数,等宽数字 */
  count?: number
}

export function Chip({
  label,
  interactive = true,
  selected = false,
  count,
  className,
  ...rest
}: ChipProps) {
  const classes = ['chip']
  if (!interactive) classes.push('chip--static')
  if (className) classes.push(className)

  const inner = (
    <>
      {label}
      {count === undefined ? null : <span className="chip__count">{count}</span>}
    </>
  )

  if (!interactive) {
    return <span className={classes.join(' ')}>{inner}</span>
  }

  return (
    <button
      type="button"
      className={classes.join(' ')}
      aria-pressed={selected}
      {...rest}
    >
      {inner}
    </button>
  )
}
