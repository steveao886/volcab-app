import { readFileSync } from 'node:fs'
import type { SynonymNotesFile } from '../src/lib/synonymContent.ts'
import { buildSynonymGroups } from '../src/lib/synonymGroups.ts'
import { synonymCoverageErrors, synonymNoteErrors } from '../src/lib/synonymNotesValidate.ts'
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
 * The rules live in src/lib/synonymNotesValidate.ts with their tests.
 */

const file = process.argv[2] ?? 'src/data/synonymNotes.json'
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

const count = typeof data.notes === 'object' && data.notes !== null ? Object.keys(data.notes).length : 0
if (errors.length > 0) {
  for (const e of errors) console.error(e)
  console.error(`\n${errors.length} error(s) in ${file} (${count} paragraph(s), ${groups.length} groups)`)
  process.exit(1)
}
console.log(`${file}: ${count} paragraph(s) covering all ${groups.length} groups, all valid`)
