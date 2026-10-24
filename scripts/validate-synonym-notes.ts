import { readFileSync } from 'node:fs'
import type { SynonymNotesFile } from '../src/lib/synonymContent.ts'
import { buildSynonymGroups } from '../src/lib/synonymGroups.ts'
import { oppositeExcludeErrors, synonymCoverageErrors, synonymNoteErrors } from '../src/lib/synonymNotesValidate.ts'
import { oppositeCandidates, oppositeGroups } from '../src/lib/synonymOpposites.ts'
import type { Word } from '../src/types.ts'

/**
 * Gate for src/data/synonymNotes.json — the 近义词 paragraphs
 * (docs/superpowers/specs/2026-10-23-synonym-groups-design.md §4 and R4).
 * Bundled content, so a bad entry ships and stays until the next release:
 * strict here, lenient at runtime (currentNote skips a malformed entry, and a
 * paragraph whose members no longer match the group shows the pieces).
 *
 * **Coverage is enforced** (R4): every group computed from data/words.json
 * needs a current paragraph naming its base words, and no paragraph may be
 * current for no group. So a word that creates or changes a group fails CI
 * until its paragraph is written — adding a word cannot skip this page.
 * `npm run synonym-todo` gives the same list in the order the page shows it.
 *
 * Also gates src/data/synonymOpposites.json, the hand-kept vetoes on opposite
 * pairings (spec R3): each must still match a pairing, or it is stale.
 * `--opposites` prints every pairing the page shows, with the word pairs
 * behind it, and every vetoed one — the list a person reads, since the rule
 * cannot tell which sense an antonym was listed in.
 *
 * The rules live in src/lib/synonymNotesValidate.ts with their tests.
 */

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--')) ?? 'src/data/synonymNotes.json'
const data = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown; notes?: unknown }
const words = JSON.parse(readFileSync('data/words.json', 'utf8')).words as Word[]
const wordsById = new Map(words.map((w) => [w.id, w]))
const errors: string[] = []

if (data.version !== 1) errors.push(`version must be 1, got ${JSON.stringify(data.version)}`)
const groups = buildSynonymGroups(words)
if (typeof data.notes !== 'object' || data.notes === null || Array.isArray(data.notes)) {
  errors.push('notes must be an object keyed by gloss term')
} else {
  for (const [key, entry] of Object.entries(data.notes)) errors.push(...synonymNoteErrors(key, entry, wordsById))
  errors.push(...synonymCoverageErrors(groups, data as SynonymNotesFile, wordsById))
}
const oppositesFile = JSON.parse(readFileSync('src/data/synonymOpposites.json', 'utf8')) as { exclude?: [string, string][] }
errors.push(...oppositeExcludeErrors(oppositesFile, groups, words))

if (args.includes('--opposites')) {
  const exclude = Array.isArray(oppositesFile.exclude) ? oppositesFile.exclude : []
  const shown = oppositeGroups(groups, words, exclude)
  const candidates = oppositeCandidates(groups, words)
  const pairsOf = (from: string, to: string) => candidates.find((c) => c.from === from && c.to === to)?.pairs.join(' ') ?? ''
  console.log(`${shown.size} pairings shown on the page:`)
  for (const [from, to] of [...shown].sort()) console.log(`  ${from} → ${to}   ${pairsOf(from, to)}`)
  const byKey = new Map(groups.map((g) => [g.key, g]))
  const vetoed = candidates.filter((c) => exclude.some(([a, b]) => byKey.get(c.from)?.terms.includes(a) && byKey.get(c.to)?.terms.includes(b)))
  console.log(`\n${vetoed.length} vetoed in synonymOpposites.json:`)
  for (const c of vetoed) console.log(`  ${c.from} ↛ ${c.to}   ${c.pairs.join(' ')}`)
  console.log('')
}

const count = typeof data.notes === 'object' && data.notes !== null ? Object.keys(data.notes).length : 0
if (errors.length > 0) {
  for (const e of errors) console.error(e)
  console.error(`\n${errors.length} error(s) in ${file} (${count} paragraph(s), ${groups.length} groups)`)
  process.exit(1)
}
console.log(`${file}: ${count} paragraph(s) covering all ${groups.length} groups, all valid`)
