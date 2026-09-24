/**
 * Inline SVG icon set (no icon library, works offline).
 * Strokes are consistently 1.5px, round caps/joins, 24 grid — same visual
 * language as the hairline dividers.
 * To add an icon: just add an entry to PATHS, the `name` union type follows automatically.
 */

const PATHS = {
  /* Back */
  back: <path d="m14.5 4.5-7.5 7.5 7.5 7.5" />,
  /* Forward: the mirror of back, at the end of a row that opens somewhere */
  chevron: <path d="m9.5 4.5 7.5 7.5-7.5 7.5" />,
  /* Speak: a speaker + two sound waves (review card and word detail) */
  speak: (
    <>
      <path d="M11 4.5 6.5 8.5H3.5v7h3l4.5 4z" />
      <path d="M15 9.2a4 4 0 0 1 0 5.6" />
      <path d="M17.8 6.4a8 8 0 0 1 0 11.2" />
    </>
  ),
  /* Search: magnifying glass (library) */
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4.5 4.5" />
    </>
  ),
} as const

interface IconProps {
  name: keyof typeof PATHS
  /** Side length (px), defaults to 22 */
  size?: number
  className?: string
}

export function Icon({ name, size = 22, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
