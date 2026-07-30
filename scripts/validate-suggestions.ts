import { readFileSync } from 'node:fs'
import { headwordPattern } from '../src/lib/headword.ts'

/**
 * Gate for src/data/suggestions.json.
 *
 * The pool is bundled content, so nothing about it can be fixed by the user
 * at runtime — a bad entry ships and stays until the next release. This runs
 * strict for that reason, matching validate-words.ts: quality is enforced on
 * the write side, and the runtime stays lenient.
 *
 * The rule that earns its place here is the locatability check. A suggestion
 * accepted by the user becomes a real word, and its example is the seed for
 * the cloze questions that follow; an example whose headword the app can't
 * find is a question with no blank. That failure is invisible on inspection —
 * "He put the meeting off twice" looks like a perfectly good sentence for
 * "put off" — so it has to be machine-checked, with the same matcher the app
 * itself uses rather than a second implementation that could drift.
 */

const file = process.argv[2] ?? 'src/data/suggestions.json'
const data = JSON.parse(readFileSync(file, 'utf8'))
const errors: string[] = []

const KINDS = new Set(['phrasal', 'idiom', 'expression'])
const MIN_WORDS = 12
const MAX_WORDS = 30

if (data.version !== 1) errors.push('version must be 1')
if (!Array.isArray(data.items)) { console.error('items must be an array'); process.exit(1) }

const seenId = new Set<string>()
const seenHead = new Set<string>()

for (const s of data.items) {
  const ctx = s.id ?? '(missing id)'
  if (!s.id || s.id !== String(s.id).toLowerCase() || /\s/.test(s.id)) {
    errors.push(`${ctx}: id must be lowercase with no whitespace (spaces become hyphens)`)
  }
  if (seenId.has(s.id)) errors.push(`${ctx}: duplicate id`)
  seenId.add(s.id)

  if (!s.headword || typeof s.headword !== 'string') errors.push(`${ctx}: missing headword`)
  else {
    // Across four separately-generated batches the same phrase can easily be
    // proposed twice under different ids (put-off / put-something-off), and a
    // pool that offers the same thing twice looks broken.
    const key = s.headword.trim().toLowerCase().replace(/\s+/g, ' ')
    if (seenHead.has(key)) errors.push(`${ctx}: duplicate headword "${s.headword}"`)
    seenHead.add(key)
  }

  if (!KINDS.has(s.kind)) errors.push(`${ctx}: kind must be one of ${[...KINDS].join(' / ')}, got ${JSON.stringify(s.kind)}`)
  for (const k of ['zh', 'en'] as const) {
    if (typeof s[k] !== 'string' || s[k].trim() === '') errors.push(`${ctx}: ${k} must be a non-empty string`)
  }
  // zh is study content and must actually be Chinese; a batch that quietly
  // fell back to English glosses would otherwise pass every other check.
  if (typeof s.zh === 'string' && !/[一-鿿]/.test(s.zh)) errors.push(`${ctx}: zh must contain Chinese`)
  if (s.note !== undefined && (typeof s.note !== 'string' || s.note.trim() === '')) {
    errors.push(`${ctx}: note, when present, must be a non-empty string (omit the key instead)`)
  }

  if (!Number.isInteger(s.usageScore) || s.usageScore < 1 || s.usageScore > 10) {
    errors.push(`${ctx}: usageScore must be an integer from 1-10, got ${JSON.stringify(s.usageScore)}`)
  }

  if (typeof s.example !== 'string' || s.example.trim() === '') {
    errors.push(`${ctx}: missing example`)
  } else {
    const n = s.example.trim().split(/\s+/).length
    if (n < MIN_WORDS || n > MAX_WORDS) errors.push(`${ctx}: example should be ${MIN_WORDS}-${MAX_WORDS} words, got ${n}`)
    if (s.headword && headwordPattern(s.example, s.headword) === null) {
      errors.push(`${ctx}: the app cannot locate "${s.headword}" in its own example — it would produce a cloze with no blank: ${JSON.stringify(s.example)}`)
    }
  }
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1) }
console.log(`OK: ${data.items.length} suggestions passed validation`)
