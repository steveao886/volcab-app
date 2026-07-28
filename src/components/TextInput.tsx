import type { ComponentPropsWithRef } from 'react'

/** Single-line text input. */
export function TextInput({
  className,
  type = 'text',
  ...rest
}: ComponentPropsWithRef<'input'>) {
  return (
    <input
      type={type}
      className={className ? `input ${className}` : 'input'}
      {...rest}
    />
  )
}
