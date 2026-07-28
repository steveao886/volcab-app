import type { HTMLAttributes } from 'react'

/** Paper surface container: hairline outline + very subtle shadow, not a plastic card. */
interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** md is the default; sm is more compact; none lets the content handle its own layout (e.g. a flush list) */
  pad?: 'none' | 'sm' | 'md'
  /** Raise one layer, for overlays / sticky bars */
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
