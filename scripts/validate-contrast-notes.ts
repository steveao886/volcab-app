import { readFileSync } from 'node:fs'
import { buildContrastPairs } from '../src/lib/contrast.ts'
import { contrastNoteKey } from '../src/lib/contrastNotes.ts'

/**
 * Gate for src/data/contrastNotes.json — bundled content, so a bad entry
 * ships and stays until the next release; strict here, lenient at runtime,
 * same split as the other three validators.
 *
 * Coverage over the quizzable pair set is *reported*, not enforced: the
 * pair set moves with the library, and a missing note degrades to "no
 * explanation shown", which is safe. A key pointing at a word that doesn't
 * exist, on the other hand, is a note that can never render — dead weight
 * in the bundle and probably a typo'd id — so that fails.
 */

const file = process.argv[2] ?? 'src/data/contrastNotes.json'
const data = JSON.parse(readFileSync(file, 'utf8'))
const words = JSON.parse(readFileSync('data/words.json', 'utf8')).words as { id: string }[]
const ids = new Set(words.map(w => w.id))
const errors: string[] = []

/** One or two sentences. Anything longer stops being an answer and starts being an article the card has no room for. */
const MAX_NOTE = 160

if (data.version !== 1) errors.push('version must be 1')
if (typeof data.notes !== 'object' || data.notes === null || Array.isArray(data.notes)) {
  console.error('notes must be an object')
  process.exit(1)
}

for (const [key, note] of Object.entries(data.notes as Record<string, unknown>)) {
  const parts = key.split('|')
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
    errors.push(`${key}: key must be two ids joined by '|'`)
    continue
  }
  if (contrastNoteKey(parts[0], parts[1]) !== key) {
    errors.push(`${key}: ids must be sorted — the lookup key is built sorted, so this note could never be found`)
  }
  for (const id of parts) {
    if (!ids.has(id)) errors.push(`${key}: "${id}" is not in the vocabulary`)
  }
  if (typeof note !== 'string' || note.trim() === '') {
    errors.push(`${key}: note must be a non-empty string`)
  } else {
    if (!/[一-鿿]/.test(note)) errors.push(`${key}: note must be Chinese — it is study content`)
    if (note.length > MAX_NOTE) errors.push(`${key}: note is ${note.length} chars (max ${MAX_NOTE}); it should answer the question, not lecture`)
  }
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}

// Coverage is measured against **every** pair, not just those over
// CONTRAST_MIN_SCORE: when a learner's studied words can't form enough
// high-scoring pairs, generateContrastQuiz deliberately falls back to all
// pairs among learned words — so any pair in the graph can be asked. The
// first batch of notes covered only the high-score subset on the wrong
// assumption that the threshold was a hard gate, and the gap surfaced
// immediately: the very first pair drawn in verification (alleviate |
// assuage, score 2) had no note.
const quizzable = buildContrastPairs(words as never[])
  .map(p => contrastNoteKey(p.a, p.b))
const covered = quizzable.filter(k => k in data.notes)
const missing = quizzable.filter(k => !(k in data.notes))
console.log(`OK: ${Object.keys(data.notes).length} notes valid`)
console.log(`coverage: ${covered.length}/${quizzable.length} quizzable pairs`)
if (missing.length > 0 && missing.length <= 20) console.log('missing:', missing.join(', '))
else if (missing.length > 20) console.log(`missing ${missing.length} pairs (first 10): ${missing.slice(0, 10).join(', ')}`)
