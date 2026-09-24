export type ProgressMark = 'done' | 'current' | 'todo'

/**
 * One 圈点 mark per item of a session: filled for finished, a heavy ring for
 * the one on screen, hollow for the rest. `null` means "don't draw marks" —
 * an empty session, or more items than fit on one line — and the caller
 * falls back to the hairline bar. The length always comes from `total`, so
 * a done count past it can't draw marks for items that don't exist.
 */
export function progressMarks(done: number, total: number, max: number): ProgressMark[] | null {
  if (total <= 0 || total > max) return null
  return Array.from({ length: total }, (_, i) => (i < done ? 'done' : i === done ? 'current' : 'todo'))
}
