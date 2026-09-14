/**
 * Pushes edits to EXISTING entries in the live volcab-data words.json.
 *
 *   npx tsx scripts/push-words.ts <id> [<id> ...]           dry run
 *   npx tsx scripts/push-words.ts <id> [<id> ...] --apply   writes
 *
 * The companion to `scripts/out/push-live.ts`-style append scripts, which only
 * ever add new ids. Nothing in the repo could edit an entry that already
 * existed, which is why the six defects an example review found in 2026-09-14
 * sat in `data/words.json` with no way to reach the copy the app actually reads.
 *
 * **Edits are applied on top of a FRESH pull of the live file, by id.** The live
 * copy is authoritative and has diverged from this repo's before (`f53adb9`):
 * the user deletes words in the app and those deletions land only in
 * volcab-data, so pushing the repo copy wholesale would resurrect them. This
 * script never writes an id it was not given, and refuses if an id is missing
 * live rather than creating it — use an append script for new words.
 *
 * The PUT is pinned to the sha read in the same run, so a concurrent write
 * fails the request instead of being silently clobbered, and the body goes
 * through the app's own `serializeWords` so formatting cannot drift.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { serializeWords } from '../src/state/sync'
import type { Word, WordsFile } from '../src/types'

const REPO = 'steveao886/volcab-data'
const BIG = { encoding: 'utf8' as const, maxBuffer: 16 * 1024 * 1024 }

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const ids = args.filter(a => !a.startsWith('--'))

if (ids.length === 0) {
  console.error('usage: npx tsx scripts/push-words.ts <id> [<id> ...] [--apply]')
  process.exit(1)
}

const repoWords = (JSON.parse(readFileSync('data/words.json', 'utf8')) as WordsFile).words
const fixed = new Map(repoWords.map(w => [w.id, w]))

const missingLocally = ids.filter(id => !fixed.has(id))
if (missingLocally.length > 0) {
  console.error(`not in data/words.json: ${missingLocally.join(', ')}`)
  process.exit(1)
}

const liveSha = execFileSync('gh', ['api', `repos/${REPO}/contents/words.json`, '--jq', '.sha'], BIG).trim()
const live = JSON.parse(
  execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github.raw', `repos/${REPO}/contents/words.json`], BIG),
) as WordsFile

const missingLive = ids.filter(id => !live.words.some(w => w.id === id))
if (missingLive.length > 0) {
  console.error(`not present live (use an append script for new words): ${missingLive.join(', ')}`)
  process.exit(1)
}

let changed = 0
const out: Word[] = live.words.map(lw => {
  if (!ids.includes(lw.id)) return lw
  const rw = fixed.get(lw.id)
  if (rw === undefined) return lw
  if (JSON.stringify(lw) === JSON.stringify(rw)) {
    console.log(`   ${lw.id}: already identical`)
    return lw
  }
  console.log(`   ${lw.id}: ${lw.meanings.length} -> ${rw.meanings.length} meanings, ${lw.examples.length} -> ${rw.examples.length} examples`)
  changed++
  return rw
})

console.log(`\nlive words: ${live.words.length} (unchanged); entries to replace: ${changed}`)

if (!apply) {
  console.log('DRY RUN — pass --apply to push')
  process.exit(0)
}
if (changed === 0) {
  console.log('nothing to push')
  process.exit(0)
}

const body = serializeWords(out)
mkdirSync('scripts/out', { recursive: true })   // gitignored scratch; absent in a fresh clone
const tmp = 'scripts/out/.put-words.json'
writeFileSync(tmp, JSON.stringify({
  message: `Fix ${changed} ${changed === 1 ? 'entry' : 'entries'}: ${ids.join(', ')}`,
  content: Buffer.from(body, 'utf8').toString('base64'),
  sha: liveSha,
}))
try {
  execFileSync('gh', ['api', '-X', 'PUT', `repos/${REPO}/contents/words.json`, '--input', tmp], BIG)
  console.log(`pushed words.json (${body.length} chars)`)
} finally {
  unlinkSync(tmp)
}
