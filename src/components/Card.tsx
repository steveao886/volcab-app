import type { HTMLAttributes } from 'react'

/** 纸面容器:发丝描边 + 极浅投影,不是塑料卡片。 */
interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** md 默认;sm 更紧凑;none 由内部自己排版(如整块列表) */
  pad?: 'none' | 'sm' | 'md'
  /** 抬高一层,用于弹层/置顶条 */
  raised?: boolean
}

export function Card({
  pad = 'md',
  raised = false,
  className,
  ...rest
}: CardProps) {
  const classes = ['card']
  if (pad === 'sm') classes.push('card--sm')
  if (pad === 'none') classes.push('card--flush')
  if (raised) classes.push('card--raised')
  if (className) classes.push(className)

  return <div className={classes.join(' ')} {...rest} />
}
