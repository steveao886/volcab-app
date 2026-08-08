import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * chip has three uses:
 * - filter toggle (default): the library page, renders <button aria-pressed>,
 *   selected state is the ink slab
 * - one-shot action: a synonym/antonym/collocation/related form that can be
 *   staged (see components/CaptureChips). Renders <button> with `toggle`
 *   false, because aria-pressed on an action that only fires once would be
 *   announced as "not pressed", which is false.
 * - static label: renders <span>, does not enter the Tab sequence.
 *
 * The static case used to cover every chip on a word card, justified by "a
 * review card can show a dozen or more at once — making them all buttons
 * would add a dozen-plus pointless focus stops". Staging kept half of that:
 * only a word you don't already have is a button, so on a typical card the
 * focus stops land exactly on the words there is something to do with.
 */
interface ChipProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: ReactNode
  /** Clickable; renders as a plain display label when false */
  interactive?: boolean
  /** Emit aria-pressed. False for one-shot actions, which have no pressed state. */
  toggle?: boolean
  selected?: boolean
  /** Count shown on the right, tabular digits */
  count?: number
}

export function Chip({
  label,
  interactive = true,
  toggle = true,
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
      aria-pressed={toggle ? selected : undefined}
      {...rest}
    >
      {inner}
    </button>
  )
}
