import type { ReactNode } from 'react'
import type { DayPoint } from './statsDerive'

/**
 * The hand-rolled SVG bar chart on the stats page and its axis frame. No
 * charting library — see the header of Stats.tsx.
 *
 * **Axis text is HTML, never SVG.** The chart stretches to the column width
 * with `preserveAspectRatio="none"`, which scales x and y by different
 * factors; any <text> inside would come out horizontally squashed by a
 * ratio that changes with the viewport. Gridlines survive it because
 * `vector-effect="non-scaling-stroke"` keeps them a hairline regardless.
 */

const W = 300
const H = 90

/** Gridline fractions, top to bottom. */
const GRID = [0, 0.5, 1]

function GridLines() {
  return (
    <g className="stats-grid">
      {GRID.map(f => (
        <line key={f} x1={0} x2={W} y1={f * H} y2={f * H} vectorEffect="non-scaling-stroke" />
      ))}
    </g>
  )
}

interface ChartFrameProps {
  /** Top-to-bottom, one per gridline. */
  yLabels: string[]
  xLeft: string
  xRight: string
  /**
   * Where today falls across the plot, 0–1 (for bars, the centre of the
   * last one). It gets the one cinnabar thing a chart may carry — a tick on
   * the time axis, a mark and not a data color.
   */
  todayAt: number
  children: ReactNode
}

/**
 * Puts numbers on a chart: a y-axis gutter aligned to the gridlines, and the
 * two ends of the x range. It also carried a gridline inset for the accuracy
 * line, so a 100% dot wasn't sliced by the plot edge; that chart went on
 * 2026-09-23 and the inset went with it.
 */
function ChartFrame({ yLabels, xLeft, xRight, todayAt, children }: ChartFrameProps) {
  return (
    <div className="stats-chart">
      <div className="stats-chart__y" aria-hidden="true">
        {yLabels.map((l, i) => (
          <span className="num" key={i}>{l}</span>
        ))}
      </div>
      <div className="stats-chart__plot">
        {children}
        <span className="stats-chart__today" style={{ left: `${todayAt * 100}%` }} aria-hidden="true" />
      </div>
      <div className="stats-chart__x" aria-hidden="true">
        <span className="num">{xLeft}</span>
        <span>{xRight}</span>
      </div>
    </div>
  )
}

interface ReviewBarsProps {
  days: DayPoint[]
  /** The busiest day's review count, i.e. what the top gridline means. 0 when nothing was reviewed. */
  max: number
  xLeft: string
  xRight: string
}

/**
 * Daily review volume, stacked: new words at the base in --chart-2, repeat
 * reviews above them in --chart-1 (`newLearned` is a subset of `reviewed` —
 * see recordReview in store.tsx, which increments both for a first
 * encounter). The two segments are separated by a 2px gap in the paper
 * color rather than touching: the gap, not a stroke, is what keeps two
 * fills apart (dataviz mark spec), and adjacent bars get the same gap.
 *
 * **A day with no study is drawn as a muted baseline tick, not a short
 * bar.** The previous version gave every day a minimum bar height in the
 * accent color, so a month of nothing looked like a month of a little; the
 * gaps in the streak were invisible in the one chart that should show them.
 *
 * Bars are laid out in viewBox units rather than pixels: 30 bars allocated
 * by pixel width would accumulate rounding error into an overflow on a
 * 375px card, while viewBox scaling always fills the container exactly.
 */
export function ReviewBars({ days, max, xLeft, xRight }: ReviewBarsProps) {
  const n = days.length
  const colW = W / n
  const gap = colW * 0.22
  const barW = colW - gap
  /** Floor in viewBox units (~2px on screen) so a 1-review day is still visible next to a 40-review day. */
  const MIN_H = 3
  const ZERO_H = 1.5
  /** 2px of the 64px plot height (--chart-h in Stats.css), in viewBox units. */
  const GAP_Y = (2 / 64) * H

  // A window with no reviews at all has no scale to label, and printing
  // "0 / 0 / 0" up the axis would look like a rendering bug rather than an
  // empty month. All that's left worth saying is where the baseline is.
  const yLabels = max === 0 ? ['', '', '0'] : [String(max), String(Math.round(max / 2)), '0']

  return (
    <ChartFrame yLabels={yLabels} xLeft={xLeft} xRight={xRight} todayAt={(n - 0.5) / n}>
      <svg
        className="stats-bars"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`近 ${n} 天每日复习量柱状图，最高 ${max} 次`}
      >
        <GridLines />
        {days.map((d, i) => {
          const x = i * colW + gap / 2
          const label = <title>{`${d.date}：复习 ${d.reviewed} 次，新词 ${d.newLearned} 个`}</title>
          if (d.reviewed === 0 || max === 0) {
            return (
              <rect key={d.date} className="stats-bars__zero" x={x} y={H - ZERO_H} width={barW} height={ZERO_H}>
                {label}
              </rect>
            )
          }
          const barH = Math.max(MIN_H, (d.reviewed / max) * H)
          const newH = Math.min(barH, (d.newLearned / max) * H)
          // The repeat-review segment gives up GAP_Y at its foot when a
          // new-word segment sits under it. A sliver thinner than the gap
          // is dropped rather than drawn inverted; the <title> still says it.
          const reviewH = newH > 0 ? barH - newH - GAP_Y : barH
          return (
            <g key={d.date}>
              {reviewH > 0 && (
                <rect className="stats-bars__bar" x={x} y={H - barH} width={barW} height={reviewH}>
                  {label}
                </rect>
              )}
              {newH > 0 && (
                <rect className="stats-bars__bar--new" x={x} y={H - newH} width={barW} height={newH}>
                  {label}
                </rect>
              )}
            </g>
          )
        })}
      </svg>
    </ChartFrame>
  )
}
