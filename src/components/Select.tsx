import type { ComponentPropsWithRef } from 'react'

/**
 * Dropdown select. Reuses .input's appearance but **keeps the native
 * arrow**: tokens.css declares `color-scheme: light dark`, so the native
 * control already follows light/dark automatically — drawing a custom arrow
 * would mean painting it twice for both themes and managing its hit area.
 *
 * Used instead of a number input so the valid range can't be violated by
 * construction (meaning share is only ever a multiple of 10 from 10–90,
 * usage score only ever an integer from 1–10) — validation doesn't have to
 * catch mistyped values.
 */
export function Select({ className, ...rest }: ComponentPropsWithRef<'select'>) {
  return <select className={className ? `input ${className}` : 'input'} {...rest} />
}
