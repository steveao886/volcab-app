// scripts/check-live.ts
/**
 * Diffs data/words.json against the live volcab-data copy.
 *
 * Six of the 29 commits to data/words.json (f53adb9, 74b2cf5, 00dd875,
 * bf74fc9, cce0a48, 2710d51) repair the same drift: words the user deleted
 * in-app survived in the repo copy, and every content validator called them
 * valid because they all read the repo copy as ground truth. Each was found
 * by a person diffing by eye. This is that diff as one command.
 *
 * Reads through the authenticated gh CLI (the same call HANDOFF documents by
 * hand), so it never runs in CI and needs no PAT in a secret.
 *
 *   npx tsx scripts/check-live.ts            report, exit 1 on any difference
 *   npx tsx scripts/check-live.ts --write    overwrite data/words.json with the live file
 *   npx tsx scripts/check-live.ts --repo owner/name
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { serializeWords } from '../src/state/sync.ts'
import type { Word, WordsFile } from '../src/types.ts'

const DEFAULT_REPO = 'steveao886/volcab-data'
const REPO_PATH = 'data/words.json'

const args = process.argv.slice(2)
const write = args.includes('--write')
const repoFlagIndex = args.indexOf('--repo')
const repo = repoFlagIndex !== -1 ? args[repoFlagIndex + 1] : undefined
if (repoFlagIndex !== -1 && repo === undefined) {
  console.error('--repo requires an owner/name argument')
  process.exit(2)
}
const remoteRepo = repo ?? DEFAULT_REPO

let liveRaw: string
try {
  // execFileSync with an argument array, never a shell string -- the repo
  // name is untrusted input off argv and must not be interpolated into a
  // shell command.
  liveRaw = execFileSync(
    'gh',
    ['api', '-H', 'Accept: application/vnd.github.raw', `repos/${remoteRepo}/contents/words.json`],
    // Default maxBuffer is 1 MiB; the live file measured 1,179,748 bytes on
    // 2026-09-01 and only grows (design spec §1), so the default overflows
    // it (ENOBUFS) already. 16 MiB is well past the localStorage ceiling
    // the same spec measured (~3,700 words on Chromium), so this script
    // will not need raising again before that other limit does.
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  )
} catch (err) {
  // gh missing (ENOENT) and gh present-but-unauthenticated/network-failed
  // both land here; execFileSync's error carries gh's own stderr, which
  // already says which one happened.
  const e = err as { stderr?: string | Buffer; message: string }
  console.error(e.stderr ? String(e.stderr) : e.message)
  process.exit(2)
}

const live = JSON.parse(liveRaw) as WordsFile
const repoFile = JSON.parse(readFileSync(REPO_PATH, 'utf8')) as WordsFile

const liveById = new Map(live.words.map(w => [w.id, w]))
const repoById = new Map(repoFile.words.map(w => [w.id, w]))

const onlyLive = [...liveById.keys()].filter(id => !repoById.has(id)).sort()
const onlyRepo = [...repoById.keys()].filter(id => !liveById.has(id)).sort()

// Comparing serialized JSON rather than a field-by-field diff: any
// difference at all -- including one this script's authors didn't think of
// -- is exactly what should fail the check. A structural diff would need to
// be kept in sync with the Word shape by hand.
const differing = [...liveById.keys()]
  .filter(id => repoById.has(id))
  .filter(id => JSON.stringify(liveById.get(id) as Word) !== JSON.stringify(repoById.get(id) as Word))
  .sort()

console.log(`live: ${live.words.length} words, repo: ${repoFile.words.length} words`)
console.log(`only live: ${onlyLive.length}${onlyLive.length > 0 ? ` [${onlyLive.join(', ')}]` : ''}`)
console.log(`only repo: ${onlyRepo.length}${onlyRepo.length > 0 ? ` [${onlyRepo.join(', ')}]` : ''}`)
console.log(`differ: ${differing.length} entries${differing.length > 0 ? ` [${differing.slice(0, 10).join(', ')}${differing.length > 10 ? ', …' : ''}]` : ''}`)

const identical = onlyLive.length === 0 && onlyRepo.length === 0 && differing.length === 0

if (identical) {
  console.log('OK: repo copy matches the live file')
  process.exit(0)
}

if (write) {
  // Byte-identical to what the app itself would push, by construction --
  // this is the app's own serialiser, not a re-implementation of its shape.
  writeFileSync(REPO_PATH, serializeWords(live.words))
  console.log(`wrote ${live.words.length} words from live to ${REPO_PATH}`)
  process.exit(0)
}

process.exit(1)
