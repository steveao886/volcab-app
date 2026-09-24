import { progressMarks } from '../lib/progressMarks'

/** 28 × (7px dot + 5px gap) − 5px = 331px: the most that fits one line of 343px, the content width at 375px. */
const MAX_MARKS = 28

interface ProgressMarksProps {
  /** Items finished so far; the next one is the one on screen. */
  done: number
  total: number
  label: string
  /** Read out instead of the raw numbers, e.g. 还剩 11 张. */
  valueText: string
}

/**
 * Session progress as 圈点 — one mark per item — or, past MAX_MARKS, the
 * hairline bar it replaced. A review queue often runs longer than a line,
 * and dots wrapped onto a second row stop reading as one sequence. Either
 * way it is a single progressbar to assistive tech; the dots are
 * presentation.
 */
export function ProgressMarks({ done, total, label, valueText }: ProgressMarksProps) {
  const marks = progressMarks(done, total, MAX_MARKS)
  const a11y = {
    role: 'progressbar',
    'aria-label': label,
    'aria-valuemin': 0,
    'aria-valuemax': total,
    'aria-valuenow': done,
    'aria-valuetext': valueText,
  } as const
  if (marks === null) {
    return (
      <div className="progress" {...a11y}>
        <div className="progress__fill" style={{ width: `${total === 0 ? 0 : (done / total) * 100}%` }} />
      </div>
    )
  }
  return (
    <div className="marks" {...a11y}>
      {marks.map((m, i) => (
        <span key={i} className={`marks__dot marks__dot--${m}`} />
      ))}
    </div>
  )
}
