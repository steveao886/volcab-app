import type { WordState } from '../types'

const LABELS: Record<WordState, string> = {
  new: '未学',
  learning: '学习中',
  review: '已掌握',
}

/** Color dot for a word's learning state. New is a hollow ring (ink not yet applied), the rest are solid. */
export function StateDot({
  state,
  className,
}: {
  state: WordState
  className?: string
}) {
  const classes = ['dot', `dot--${state}`]
  if (className) classes.push(className)

  return (
    <span
      className={classes.join(' ')}
      role="img"
      aria-label={LABELS[state]}
      title={LABELS[state]}
    />
  )
}
