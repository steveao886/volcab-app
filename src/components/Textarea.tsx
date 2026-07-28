import type { ComponentPropsWithRef } from 'react'

/** Multi-line text input (for editing definitions/example sentences). */
export function Textarea({
  className,
  rows = 3,
  ...rest
}: ComponentPropsWithRef<'textarea'>) {
  const classes = className
    ? `input input--area ${className}`
    : 'input input--area'

  return <textarea rows={rows} className={classes} {...rest} />
}
