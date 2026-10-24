/**
 * The 近义词 content round's to-do list: the groups the page will show next,
 * in page order, that have no current paragraph
 * (docs/superpowers/specs/2026-10-23-synonym-groups-design.md §4).
 *
 * Reads the live words.json and progress.json through the authenticated gh
 * CLI, the way check-live does: the live words decide the groups, and the
 * live progress (last-seen stamps, forget records) decides the order. The
 * order is upcoming(), the same rotation the page runs, so the first
 * paragraphs written are the first ones read. Never in CI. For the bare list
 * of what is missing, `npm run validate-synonym-notes` names every group
 * without a current paragraph.
 *
 *   npm run synonym-todo                 the next 30
 *   npm run synonym-todo -- --limit 60
 *   npm run synonym-todo -- --repo owner/name
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { currentNote } from '../src/lib/synonymContent.ts'
import type { SynonymNotesFile } from '../src/lib/synonymContent.ts'
import { buildSynonymGroups } from '../src/lib/synonymGroups.ts'
import { upcoming } from '../src/lib/synonymVisit.ts'
import type { Progress, WordsFile } from '../src/types.ts'

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}
const limit = Number(flag('--limit') ?? 30)
if (!Number.isInteger(limit) || limit < 1) {
  console.error('--limit takes a positive integer')
  process.exit(2)
}
const repo = flag('--repo') ?? 'steveao886/volcab-data'

function live(path: string): string {
  try {
    // An argument array, never a shell string: the repo name comes off argv.
    // 16 MiB for the reason check-live gives: words.json is past 1 MiB.
    return execFileSync(
      'gh',
      ['api', '-H', 'Accept: application/vnd.github.raw', `repos/${repo}/contents/${path}`],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    )
  } catch (err) {
    const e = err as { stderr?: string | Buffer; message: string }
    console.error(e.stderr ? String(e.stderr) : e.message)
    process.exit(2)
  }
}

const words = (JSON.parse(live('words.json')) as WordsFile).words
const progress = JSON.parse(live('progress.json')) as Progress
const notes = JSON.parse(readFileSync('src/data/synonymNotes.json', 'utf8')) as SynonymNotesFile

const groups = buildSynonymGroups(words)
const order = upcoming(groups, progress.synonymSeen, progress.words, groups.length)
const missing = order.filter((g) => currentNote(g, notes) === undefined)

console.log(`${groups.length} groups on the live library; ${groups.length - missing.length} have a current paragraph.\n`)
missing.slice(0, limit).forEach((g, i) => {
  const stale = g.terms.some((t) => notes.notes[t] !== undefined)
  console.log(`${i + 1}. ${g.key}  ${g.members.map((m) => m.id).join(', ')}  ${stale ? 'stale' : 'missing'}`)
})
