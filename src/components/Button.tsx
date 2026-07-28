import type { ComponentPropsWithRef } from 'react'

/**
 * Button.
 * primary            solid ink slab — the page's one and only primary action
 * secondary          paper surface + outline
 * ghost              text only
 * danger             solid vermilion — destructive actions only
 * grade-*            SRS four-way grading (again/hard/good/easy), a hot→cold temperature band
 * correct/incorrect  quiz answer feedback, keeps its color even when disabled
 *
 * Appearances are mutually exclusive, so this goes through a single `variant`
 * prop rather than "secondary + one more class" — otherwise two competing
 * `background` declarations end up settled by bundling order.
 *
 * Styling all lives in CSS (.btn / .btn--*). When you need "a link that looks
 * like a button," just write className="btn btn--secondary" directly on
 * <Link> — no need to wrap it in a component.
 *
 * Props use ComponentPropsWithRef instead of ButtonHTMLAttributes: in React 19
 * ref is just a plain prop, but you only get it if you declare it — it rides
 * along with ...rest onto <button>. Moving focus to "next question" after
 * grading, or to "cancel" when a confirm panel opens, needs a real ref;
 * without it the caller is stuck falling back to getElementById / querySelector.
 */
interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?:
    | 'primary'
    | 'secondary'
    | 'ghost'
    | 'danger'
    | 'grade-again'
    | 'grade-hard'
    | 'grade-good'
    | 'grade-easy'
    | 'correct'
    | 'incorrect'
  size?: 'sm' | 'md' | 'lg'
  /** Stretch to fill the row */
  block?: boolean
  /** Allow long text to wrap and left-align (quiz options are full English definitions) */
  wrap?: boolean
  /** Loading: sets aria-busy, disables, and shows a spinner */
  loading?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  wrap = false,
  loading = false,
  className,
  type = 'button',
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const classes = ['btn', `btn--${variant}`]
  if (size !== 'md') classes.push(`btn--${size}`)
  if (block) classes.push('btn--block')
  if (wrap) classes.push('btn--wrap')
  if (className) classes.push(className)

  return (
    <button
      type={type}
      className={classes.join(' ')}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="btn__spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  )
}
