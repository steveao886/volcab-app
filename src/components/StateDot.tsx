import type { WordState } from '../types'

const LABELS: Record<WordState, string> = {
  new: '未学',
  learning: '学习中',
  review: '已掌握',
}

/** 词条学习状态的色点。未学是空心圈(尚未落墨),其余实心。 */
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
