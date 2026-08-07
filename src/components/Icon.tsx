/**
 * Inline SVG icon set (no icon library, works offline).
 * Strokes are consistently 1.5px, round caps/joins, 24 grid — same visual
 * language as the hairline dividers.
 * To add an icon: just add an entry to PATHS, the `name` union type follows automatically.
 */

const PATHS = {
  /* Today: sunrise over the horizon */
  today: (
    <>
      <path d="M3.5 18h17" />
      <path d="M7 18a5 5 0 0 1 10 0" />
      <path d="M12 3v2.5" />
      <path d="m4.9 6.9 1.8 1.8" />
      <path d="m19.1 6.9-1.8 1.8" />
      <path d="M20.5 21h-17" />
    </>
  ),
  /* Library: a standing book */
  library: (
    <>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v18H6.5A1.5 1.5 0 0 1 5 19.5z" />
      <path d="M5 17h14" />
      <path d="M9 3v14" />
    </>
  ),
  /* Stats: three bars of different heights on a baseline */
  stats: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="M7 20.5V13" />
      <path d="M12 20.5V6.5" />
      <path d="M17 20.5v-4.5" />
    </>
  ),
  /* Quiz: two rows of multiple choice, first row checked */
  quiz: (
    <>
      <rect x="3" y="4.5" width="18" height="6.5" rx="1.5" />
      <rect x="3" y="13" width="18" height="6.5" rx="1.5" />
      <path d="m6.5 7.8 1.3 1.3 2.4-2.6" />
    </>
  ),
  /* Settings: sliders */
  settings: (
    <>
      <path d="M3.5 7.5h9" />
      <path d="M17.5 7.5h3" />
      <circle cx="15" cy="7.5" r="2.5" />
      <path d="M3.5 16.5h4" />
      <path d="M12.5 16.5h8" />
      <circle cx="10" cy="16.5" r="2.5" />
    </>
  ),
  /* Back */
  back: <path d="m14.5 4.5-7.5 7.5 7.5 7.5" />,
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
