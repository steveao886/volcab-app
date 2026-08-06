import { readFileSync } from 'node:fs'
import { buildContrastPairs } from '../src/lib/contrast.ts'

/**
 * Gate for src/data/wordNotes.json — bundled content, so a bad entry ships
 * and stays until the next release; strict here, lenient at runtime, the
 * same split as the other four validators.
 *
 * Coverage is *reported*, not enforced, for the same reason as the contrast
 * notes: the library moves, a missing note degrades to "nothing shown", and
 * most importantly a blank is often the correct answer — a word with no
 * confusable twin has no 要点 worth inventing.
 */

const file = process.argv[2] ?? 'src/data/wordNotes.json'
const data = JSON.parse(readFileSync(file, 'utf8'))
const words = JSON.parse(readFileSync('data/words.json', 'utf8')).words as { id: string; headword: string }[]
const ids = new Set(words.map(w => w.id))
const errors: string[] = []

/**
 * Half the contrast-note ceiling (160), because a contrast note has to
 * describe two words and this describes one. Past this it stops being the
 * line you glance at under the meanings and becomes a paragraph the card
 * has no room for.
 */
const MAX_NOTE = 80

/**
 * Headwords that are a single English word, for the "must not name another
 * word" check below. The 12 multi-word entries (`smoking gun`, `de facto`)
 * are matched as phrases instead — their individual tokens ("gun", "in",
 * "the") are ordinary English and would fire on everything.
 */
const singleHeadwords = new Map<string, string>()
const phraseHeadwords: { id: string; phrase: string }[] = []
for (const w of words) {
  const h = w.headword.trim().toLowerCase()
  if (/^[a-z]+$/.test(h)) singleHeadwords.set(h, w.id)
  else phraseHeadwords.push({ id: w.id, phrase: h })
}

if (data.version !== 1) errors.push('version must be 1')
if (typeof data.notes !== 'object' || data.notes === null || Array.isArray(data.notes)) {
  console.error('notes must be an object')
  process.exit(1)
}

for (const [id, note] of Object.entries(data.notes as Record<string, unknown>)) {
  if (!ids.has(id)) {
    errors.push(`${id}: not in the vocabulary — this note can never render`)
    continue
  }
  if (typeof note !== 'string' || note.trim() === '') {
    errors.push(`${id}: note must be a non-empty string`)
    continue
  }
  if (!/[一-鿿]/.test(note)) errors.push(`${id}: note must be Chinese — it is study content`)
  if (note.length > MAX_NOTE) {
    errors.push(`${id}: note is ${note.length} chars (max ${MAX_NOTE}); it is a line under the meanings, not a paragraph`)
  }

  // The content contract, made mechanical: a word note states what **this**
  // word does, because it is read on this word's card where the twin is
  // nowhere in sight. The moment it says "不同于 alleviate" it has become a
  // contrast note, and those have their own file, their own key, and their
  // own place in the quiz.
  //
  // Measured before adopting: across the 325 authored contrast notes — the
  // closest comparable body of text — only 2 mention a library headword
  // beyond their own pair (obdurate|refractory → recalcitrant,
  // pious|reverent → platitude). A rule that fires on 0.6% of that corpus
  // is catching real drift, not manufacturing noise. English collocation
  // fragments are otherwise wanted: all 325 carry one.
  const lower = note.toLowerCase()
  const named = new Set<string>()
  for (const token of new Set(lower.match(/[a-z]+/g) ?? [])) {
    const other = singleHeadwords.get(token)
    if (other !== undefined && other !== id) named.add(token)
  }
  for (const p of phraseHeadwords) {
    if (p.id !== id && new RegExp(`\\b${p.phrase}\\b`).test(lower)) named.add(p.phrase)
  }
  if (named.size > 0) {
    errors.push(`${id}: names another word in the library (${[...named].join(', ')}) — that makes it a contrast note; state what ${id} itself does`)
  }
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}

// Coverage is measured over the words that take part in a contrast pair,
// not over the whole library: those are the words a 要点 exists to serve.
// The remaining ones are expected to stay blank.
const confusable = new Set<string>()
for (const p of buildContrastPairs(words as never[])) {
  confusable.add(p.a)
  confusable.add(p.b)
}
const covered = [...confusable].filter(id => id in data.notes)
console.log(`OK: ${Object.keys(data.notes).length} notes valid`)
console.log(`coverage: ${covered.length}/${confusable.size} words that appear in a contrast pair`)
