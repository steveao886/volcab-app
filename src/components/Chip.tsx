import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * chip has two uses:
 * - interactive (default): the filter toggles on the library page, renders
 *   <button aria-pressed>, selected state is the ink slab
 * - static label: synonyms/antonyms/collocations/related forms, renders
 *   <span>, does not enter the Tab sequence
 *   (a review card can show a dozen or more at once — making them all
 *   buttons would add a dozen-plus pointless focus stops)
 */
interface ChipProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: ReactNode
  /** Clickable toggle; renders as a plain display label when false */
  interactive?: boolean
  selected?: boolean
  /** Count shown on the right, tabular digits */
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
