import type { CSSProperties, ReactNode } from 'react'
import type { AccuracyPoint, DayPoint } from './statsDerive'

/**
 * The two hand-rolled SVG charts on the stats page, plus the axis frame
 * they share. No charting library — see the header of Stats.tsx.
 *
 * **Axis text is HTML, never SVG.** Both charts stretch to the card width
 * with `preserveAspectRatio="none"`, which scales x and y by different
 * factors; any <text> inside would come out horizontally squashed by a
 * ratio that changes with the viewport. Gridlines survive it because
 * `vector-effect="non-scaling-stroke"` keeps them a hairline regardless.
 */

const W = 300
const H = 90

/** Gridline fractions, top to bottom, shared by both charts so their rules line up when the cards sit above one another. */
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
   * How far the top and bottom gridlines sit inside the plot box, as a
   * fraction of its height. Passed through to CSS rather than duplicated
   * there: the accuracy chart insets its gridlines by PAD_Y so a 100% dot
   * isn't sliced in half by the edge, and a y-axis label that didn't follow
   * would point at empty space — which is exactly the kind of "close
   * enough" annotation this pass exists to remove.
   */
  insetRatio?: number
  children: ReactNode
}

/** Puts numbers on a chart: a y-axis gutter aligned to the gridlines, and the two ends of the x range. */
function ChartFrame({ yLabels, xLeft, xRight, insetRatio = 0, children }: ChartFrameProps) {
  const style = { '--chart-inset': `calc(var(--chart-h) * ${insetRatio})` } as CSSProperties
  return (
    <div className="stats-chart" style={style}>
      <div className="stats-chart__y" aria-hidden="true">
        {yLabels.map((l, i) => (
          <span className="num" key={i}>{l}</span>
        ))}
      </div>
      <div className="stats-chart__plot">{children}</div>
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
 * Daily review volume, stacked: new words at the base, repeat reviews above
 * them (`newLearned` is a subset of `reviewed` — see recordReview in
 * store.tsx, which increments both for a first encounter).
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

  // A window with no reviews at all has no scale to label, and printing
  // "0 / 0 / 0" up the axis would look like a rendering bug rather than an
  // empty month. All that's left worth saying is where the baseline is.
  const yLabels = max === 0 ? ['', '', '0'] : [String(max), String(Math.round(max / 2)), '0']

  return (
    <ChartFrame yLabels={yLabels} xLeft={xLeft} xRight={xRight}>
      <svg
        className="stats-bars"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`近 ${n} 天每日复习量柱状图,最高 ${max} 次`}
      >
        <GridLines />
        {days.map((d, i) => {
          const x = i * colW + gap / 2
          const label = <title>{`${d.date} · 复习 ${d.reviewed} 次,新词 ${d.newLearned} 个`}</title>
          if (d.reviewed === 0 || max === 0) {
            return (
              <rect key={d.date} className="stats-bars__zero" x={x} y={H - ZERO_H} width={barW} height={ZERO_H}>
                {label}
              </rect>
            )
          }
          const barH = Math.max(MIN_H, (d.reviewed / max) * H)
          const newH = Math.min(barH, (d.newLearned / max) * H)
          return (
            <g key={d.date}>
              <rect className="stats-bars__bar" x={x} y={H - barH} width={barW} height={barH}>
                {label}
              </rect>
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

interface AccuracyTrendProps {
  points: AccuracyPoint[]
  /** Weighted window average, drawn as a dashed reference line. null when there is nothing to average. */
  average: number | null
  xLeft: string
  xRight: string
}

/**
 * Accuracy trend. Days with null (no review that day) must break the line
 * rather than be plotted at 0 — for the same reason as accuracySeries
 * itself: 0% would falsely claim "everything was wrong that day". Approach:
 * split consecutive non-null points into segments and draw each segment as
 * its own polyline; an isolated point (broken on both sides) is drawn as a
 * lone dot, since a single point can't form a line.
 *
 * The dashed average line is what makes a wobble readable: without a
 * reference, a line that swings between 80% and 90% looks identical to one
 * swinging between 20% and 90%, because both fill the same box.
 */
export function AccuracyTrend({ points, average, xLeft, xRight }: AccuracyTrendProps) {
  const PAD_Y = 8
  const n = points.length
  const stepX = n > 1 ? W / (n - 1) : 0
  const yAt = (a: number) => PAD_Y + (1 - a) * (H - 2 * PAD_Y)

  const segments: { x: number; y: number }[][] = []
  let current: { x: number; y: number }[] = []
  points.forEach((p, i) => {
    if (p.accuracy === null) {
      if (current.length > 0) segments.push(current)
      current = []
      return
    }
    current.push({ x: i * stepX, y: yAt(p.accuracy) })
  })
  if (current.length > 0) segments.push(current)

  if (segments.length === 0) {
    return <p className="stats-accuracy-empty muted">这段时间还没有复习记录。</p>
  }

  return (
    <ChartFrame yLabels={['100%', '50%', '0']} xLeft={xLeft} xRight={xRight} insetRatio={PAD_Y / H}>
      <svg
        className="stats-accuracy"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="近 30 天正确率趋势,没有复习的日子不连线"
      >
        {/* Gridlines sit at the plot edges (0 / 50 / 100%), but the line
            itself is inset by PAD_Y so a 100% day's dot isn't clipped in
            half by the top edge. */}
        <g className="stats-grid">
          {GRID.map(f => (
            <line
              key={f}
              x1={0}
              x2={W}
              y1={PAD_Y + f * (H - 2 * PAD_Y)}
              y2={PAD_Y + f * (H - 2 * PAD_Y)}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
        {average !== null && (
          <line
            className="stats-accuracy__avg"
            x1={0}
            x2={W}
            y1={yAt(average)}
            y2={yAt(average)}
            vectorEffect="non-scaling-stroke"
          >
            <title>{`平均 ${Math.round(average * 100)}%`}</title>
          </line>
        )}
        {segments.map((seg, i) => (
          <g key={i}>
            {seg.length > 1 && (
              <polyline
                className="stats-accuracy__line"
                vectorEffect="non-scaling-stroke"
                points={seg.map(p => `${p.x},${p.y}`).join(' ')}
              />
            )}
            {seg.map((p, j) => (
              <circle key={j} className="stats-accuracy__dot" cx={p.x} cy={p.y} r={2.5} />
            ))}
          </g>
        ))}
      </svg>
    </ChartFrame>
  )
}
