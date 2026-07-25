import type { ComponentPropsWithRef } from 'react'

/** 单行输入框。 */
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
