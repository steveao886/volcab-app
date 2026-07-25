/**
 * 内联 SVG 图标集(不引图标库,离线可用)。
 * 线条统一 1.5px、圆头圆角、24 网格,与发丝分隔线是同一套语言。
 * 新增图标:往 PATHS 里加一条,并把 name 加进联合类型。
 */

const PATHS = {
  /* 今日:地平线上的日出 */
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
  /* 词库:立着的书 */
  library: (
    <>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v18H6.5A1.5 1.5 0 0 1 5 19.5z" />
      <path d="M5 17h14" />
      <path d="M9 3v14" />
    </>
  ),
  /* 测试:选择题两行,首行打勾 */
  quiz: (
    <>
      <rect x="3" y="4.5" width="18" height="6.5" rx="1.5" />
      <rect x="3" y="13" width="18" height="6.5" rx="1.5" />
      <path d="m6.5 7.8 1.3 1.3 2.4-2.6" />
    </>
  ),
  /* 设置:推子 */
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
  /* 返回 */
  back: <path d="m14.5 4.5-7.5 7.5 7.5 7.5" />,
} as const

interface IconProps {
  name: keyof typeof PATHS
  /** 边长(px),默认 22 */
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
