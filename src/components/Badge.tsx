import type { HTMLAttributes } from 'react'

/** 小徽标:同步状态、「新词」标记等。 */
interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'
}

export function Badge({ tone = 'neutral', className, ...rest }: BadgeProps) {
  const classes = ['badge']
  if (tone !== 'neutral') classes.push(`badge--${tone}`)
  if (className) classes.push(className)

  return <span className={classes.join(' ')} {...rest} />
}
