import type { ButtonHTMLAttributes } from 'react'

/**
 * 按钮。
 * primary   墨板实心 —— 页面唯一主操作
 * secondary 纸面 + 发丝描边
 * ghost     纯文字
 * danger    实心朱砂 —— 只给破坏性操作
 *
 * 样式全在 CSS(.btn / .btn--*),需要一个「长得像按钮的链接」时,
 * 直接给 <Link> 写 className="btn btn--secondary" 即可,不必包装组件。
 */
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  /** 撑满一行 */
  block?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = ['btn', `btn--${variant}`]
  if (size !== 'md') classes.push(`btn--${size}`)
  if (block) classes.push('btn--block')
  if (className) classes.push(className)

  return <button type={type} className={classes.join(' ')} {...rest} />
}
