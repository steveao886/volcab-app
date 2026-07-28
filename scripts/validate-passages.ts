/**
 * The write-side gate for passage corpus data. Doesn't pass validation, doesn't go into the repo.
 *
 * Run: npm run validate-passages
 *
 * The read side (lib/passage.ts) is lenient with bad data -- it skips that
 * passage, no throw, no white screen. That's a fallback against white
 * screens, not a quality guarantee; the quality guarantee lives here.
 */
import { readFileSync } from 'node:fs'
import { isInflectionOf } from '../src/lib/headword.ts'

/** Minimum number of words each passage must mark. Cloze only pulls from learned words, so too few marks and an early passage can't even scrape together 3 blanks. */
const MIN_MARKS = 6

const MARKER = /\{\{([^{}|]+)(?:\|([^{}|]+))?\}\}/g

// Consistent with validate-words.ts: no types wrapped around data in these scripts, since the object being validated may well not match the shape
const words = JSON.parse(readFileSync('data/words.json', 'utf8'))
const file = JSON.parse(readFileSync('src/data/passages.json', 'utf8'))

if (file.version !== 1) { console.error('version must be 1'); process.exit(1) }
if (!Array.isArray(file.passages)) { console.error('passages must be an array'); process.exit(1) }

const byId = new Map<string, { headword: string }>(
  words.words.map((w: { id: string; headword: string }) => [w.id, w]),
)
const errors: string[] = []
const seenIds = new Set<string>()
const useCount = new Map<string, number>()

for (const p of file.passages) {
  const at = (msg: string) => errors.push(`[${p.id}] ${msg}`)

  // Cover the shape first, or p.en.entries() below would throw a stack trace that doesn't say which passage is at fault
  if (typeof p.id !== 'string' || typeof p.title !== 'string'
      || !Array.isArray(p.en) || !Array.isArray(p.zh)) {
    errors.push(`[${String(p.id)}] missing id / title / en / zh, or wrong type`)
    continue
  }

  if (!/^[a-z0-9-]+$/.test(p.id)) at('id may only contain lowercase letters, digits, and hyphens')
  if (seenIds.has(p.id)) at('duplicate id')
  seenIds.add(p.id)

  if (p.title.trim() === '') at('title cannot be empty')
  if (p.en.length === 0) at('en cannot be empty')
  if (p.en.length !== p.zh.length) at(`English/Chinese sentence counts don't match: en has ${p.en.length}, zh has ${p.zh.length}`)

  let marks = 0
  for (const [si, sentence] of p.en.entries()) {
    // Strip out valid markers first; any braces left over mean it's malformed
    const stripped = sentence.replace(MARKER, '')
    if (/[{}]/.test(stripped)) at(`sentence ${si + 1} has a malformed marker`)

    for (const m of sentence.matchAll(MARKER)) {
      marks += 1
      const wordId = m[1].trim()
      const surface = (m[2] ?? m[1]).trim()
      const w = byId.get(wordId)
      if (w === undefined) {
        at(`sentence ${si + 1} references ${wordId}, which isn't in the vocabulary`)
        continue
      }
      if (!isInflectionOf(surface, w.headword)) {
        at(`sentence ${si + 1}: "${surface}" is not an inflection of ${w.headword}`)
      }
      useCount.set(wordId, (useCount.get(wordId) ?? 0) + 1)
    }
  }
  if (marks < MIN_MARKS) at(`only marked ${marks} words, needs at least ${MIN_MARKS}`)
}

// --- Coverage distribution report (not an error, just input for the next batch of passages) ---
const covered = [...useCount.keys()].length
console.log(`${file.passages.length} passages, covering ${covered} / ${words.words.length} words`)
const multi = [...useCount.values()].filter(c => c >= 3).length
console.log(`of which ${multi} appear 3+ times`)

if (errors.length > 0) {
  console.error(`\nvalidation failed, ${errors.length} issue(s):`)
  for (const e of errors) console.error('  ' + e)
  process.exit(1)
}
console.log('validation passed')
