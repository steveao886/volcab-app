import type { ComponentPropsWithRef } from 'react'

/** 多行输入框(编辑释义/例句用)。 */
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
