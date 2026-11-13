/**
 * One-time: bring the review intervals written under the 100-day ceiling
 * back under MAX_INTERVAL_DAYS, on the live progress.json.
 *
 *   npx tsx scripts/pull-back-intervals.ts                      dry run
 *   npx tsx scripts/pull-back-intervals.ts --review-cap 120     dry run, also shows the settings change
 *   npx tsx scripts/pull-back-intervals.ts --review-cap 120 --write
 *
 * Why it exists: MAX_INTERVAL_DAYS is forward-looking. An entry already
 * scheduled 60 days out keeps its `due` until it next comes up, and on the
 * live history a 31-60 day gap is remembered 68.9% of the time and a longer
 * one 43.1%. See docs/superpowers/specs/2026-11-12-interval-ceiling-design.md.
 *
 * **Run it only once the build that carries the lower ceiling is deployed,
 * and reload the app before reviewing.** An older build grades a pulled-back
 * word from 21 days straight back to 72.
 *
 * It reads the live file and edits entries in place, so nothing the user
 * deleted or changed in the app is overwritten from a stale copy. The write
 * carries the blob sha it read: if the app syncs in between, GitHub refuses
 * it and the answer is to run it again.
 *
 * Dates are local dates, like every `due` the app writes. Run it on a
 * machine in the timezone the user reviews in.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { addDays, MAX_INTERVAL_DAYS, todayStr } from '../src/lib/srs'
import { serializeProgress } from '../src/state/sync'
import type { Progress, ProgressEntry } from '../src/types'

/**
 * How many already-late words become due on each day from tomorrow.
 *
 * Simulated on the live state of 2026-11-12, releasing all of them at once
 * and releasing 33 a day lose the same number of words (1,167 and 1,178
 * lapses over 120 days), so this is for the user's days and not for memory:
 * 33 spreads that day's 448 late words over about two weeks instead of
 * opening one day with a full cap of the oldest cards.
 */
export const DEFAULT_PER_DAY = 33

export interface PullBack {
  words: Progress['words']
  /** Entries rewritten. */
  pulled: number
  /** Of those, how many were already more than the ceiling past their last review. */
  late: number
}

/**
 * Rewrites every review-phase entry whose interval is over the ceiling.
 *
 * `intervalDays` and `due` move together. Pulling `due` forward alone is
 * the 71fba29 bug: gradeWord multiplies whatever `intervalDays` it finds.
 * `due` only ever moves toward now.
 *
 * `lastReviewedAt` moves by one second, because mergeProgress keeps the
 * local entry on a tie and every device holds a cached copy. A whole
 * second and not a millisecond: the strings compare as strings, and
 * '…:00.001Z' sorts below '…:00Z'.
 *
 * A word already past the ceiling takes a slot from **tomorrow**. Made due
 * today after the day's session, it would be carried over tomorrow and take
 * a new word's place (newQuota in lib/queue.ts).
 *
 * Entries it does not touch are returned as the same objects.
 */
export function pullBackIntervals(
  words: Progress['words'],
  today: string,
  perDay: number = DEFAULT_PER_DAY,
  ceiling: number = MAX_INTERVAL_DAYS,
): PullBack {
  const out: Progress['words'] = { ...words }
  const late: [id: string, entry: ProgressEntry][] = []
  let pulled = 0
  for (const [id, e] of Object.entries(words)) {
    if (e.state !== 'review' || !(e.intervalDays > ceiling)) continue
    const seenAt = Date.parse(e.lastReviewedAt)
    // Fail closed: without a readable date there is nothing to count 21 days from.
    if (!Number.isFinite(seenAt)) continue
    const next: ProgressEntry = {
      ...e,
      intervalDays: ceiling,
      lastReviewedAt: new Date(seenAt + 1000).toISOString(),
    }
    const target = addDays(todayStr(new Date(seenAt)), ceiling)
    if (target > today) next.due = target < e.due ? target : e.due
    else late.push([id, next])
    out[id] = next
    pulled++
  }
  late.sort(([aId, a], [bId, b]) => (a.due < b.due ? -1 : a.due > b.due ? 1 : aId < bId ? -1 : 1))
  late.forEach(([, e], k) => {
    const slot = addDays(today, 1 + Math.floor(k / Math.max(1, perDay)))
    if (slot < e.due) e.due = slot
  })
  return { words: out, pulled, late: late.length }
}

const REPO = 'steveao886/volcab-data'
const BIG = { encoding: 'utf8' as const, maxBuffer: 64 * 1024 * 1024 }

/** Review-phase words due on each of the next `days` days; everything already overdue counts on day 0. */
function dueHistogram(words: Progress['words'], today: string, days: number): number[] {
  const counts = Array.from({ length: days }, () => 0)
  const index = new Map(counts.map((_, i) => [addDays(today, i), i]))
  for (const e of Object.values(words)) {
    if (e.state !== 'review') continue
    const i = e.due <= today ? 0 : index.get(e.due)
    if (i !== undefined) counts[i]++
  }
  return counts
}

function main(): void {
  const args = process.argv.slice(2)
  const write = args.includes('--write')
  const flag = (name: string): number | undefined => {
    const i = args.indexOf(name)
    if (i < 0) return undefined
    const n = Number.parseInt(args[i + 1] ?? '', 10)
    if (!Number.isInteger(n) || n <= 0) {
      console.error(`${name} needs a positive whole number`)
      process.exit(1)
    }
    return n
  }
  const perDay = flag('--per-day') ?? DEFAULT_PER_DAY
  const cap = flag('--review-cap')

  const sha = execFileSync('gh', ['api', `repos/${REPO}/contents/progress.json`, '--jq', '.sha'], BIG).trim()
  const live = JSON.parse(
    execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github.raw', `repos/${REPO}/contents/progress.json`], BIG),
  ) as Progress

  const now = new Date()
  const today = todayStr(now)
  const result = pullBackIntervals(live.words, today, perDay)

  const review = Object.values(live.words).filter(e => e.state === 'review').length
  console.log(`today ${today}, ceiling ${MAX_INTERVAL_DAYS} days, ${perDay} late words a day`)
  console.log(`review-phase words: ${review}`)
  console.log(`over the ceiling:   ${result.pulled}  (${result.late} of them last reviewed ${MAX_INTERVAL_DAYS} days ago or more)`)
  const before = dueHistogram(live.words, today, 30)
  const after = dueHistogram(result.words, today, 30)
  console.log('\nreview-phase words due, next 30 days (day 0 = today and overdue)')
  console.log(`  before  ${before.map(n => String(n).padStart(3)).join(' ')}   total ${before.reduce((a, b) => a + b, 0)}`)
  console.log(`  after   ${after.map(n => String(n).padStart(3)).join(' ')}   total ${after.reduce((a, b) => a + b, 0)}`)

  const next: Progress = { ...live, words: result.words }
  const capBefore = live.settings.reviewCap
  if (cap !== undefined && cap !== capBefore) {
    // updatedAt is what makes every device take the remote settings (see Progress.settings in types.ts).
    next.settings = { ...live.settings, reviewCap: cap, updatedAt: now.toISOString() }
    console.log(`\nsettings.reviewCap: ${capBefore ?? '(unset, 88)'} -> ${cap}`)
  }

  const settingsChanged = next.settings !== live.settings
  if (result.pulled === 0 && !settingsChanged) {
    console.log('\nnothing to change')
    return
  }
  if (!write) {
    console.log('\nDRY RUN: pass --write to push')
    return
  }

  mkdirSync('scripts/out', { recursive: true })   // gitignored scratch; absent in a fresh clone
  const tmp = 'scripts/out/.put-progress.json'
  const parts = [
    result.pulled > 0 ? `pull ${result.pulled} review intervals back under the ${MAX_INTERVAL_DAYS}-day ceiling` : '',
    settingsChanged ? `reviewCap ${capBefore ?? 88} -> ${cap}` : '',
  ].filter(Boolean)
  writeFileSync(tmp, JSON.stringify({
    message: parts.join('; '),
    content: Buffer.from(serializeProgress(next), 'utf8').toString('base64'),
    sha,
  }))
  try {
    execFileSync('gh', ['api', '-X', 'PUT', `repos/${REPO}/contents/progress.json`, '--input', tmp], BIG)
    console.log(`\npushed progress.json: ${parts.join('; ')}`)
  } finally {
    unlinkSync(tmp)
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('pull-back-intervals.ts')) main()
