import { readFileSync } from 'node:fs'
import { buildContrastPairs } from '../src/lib/contrast.ts'
import { contrastNoteKey } from '../src/lib/contrastNotes.ts'

/**
 * The staleness scan behind the periodic content refresh (see
 * .claude/skills/word-content/SKILL.md). Read-only: it names the gaps in
 * priority order and stops; the authoring session decides what to write.
 *
 * "FRESH" is a real verdict, not a formality — a refresh run that starts
 * here and sees FRESH must stop rather than invent work. Padding content to
 * have something to commit is exactly the failure the fail-closed rule
 * exists to prevent.
 *
 * Sense-group coverage counts an *anchor* covered when any group contains
 * it. The anchor set (words with ≥2 same-POS confusable partners) moves
 * with the library, so this number can go DOWN when words are added — that
 * is the mechanism by which a growing library keeps generating refresh
 * work, and it is intended.
 */

const words = JSON.parse(readFileSync('data/words.json', 'utf8')).words as {
  id: string
  meanings: { pos: string }[]
}[]
const contrastNotes = JSON.parse(readFileSync('src/data/contrastNotes.json', 'utf8')).notes as Record<string, string>
const wordNotes = JSON.parse(readFileSync('src/data/wordNotes.json', 'utf8')).notes as Record<string, string>
const senseGroups = JSON.parse(readFileSync('src/data/senseGroups.json', 'utf8')).groups as { order: string[] }[]
const passages = JSON.parse(readFileSync('src/data/passages.json', 'utf8')).passages as { en: string[] }[]
const recallSentences = JSON.parse(readFileSync('src/data/recallSentences.json', 'utf8')).sentences as { id: string }[]

const pairs = buildContrastPairs(words as never)
const posOf = new Map(words.map(w => [w.id, w.meanings[0]?.pos ?? '']))

// 1. Contrast notes: required coverage over every pair (see the validator's
// comment on why every pair, not just tight ones, is quizzable).
const missingContrast = pairs
  .map(p => contrastNoteKey(p.a, p.b))
  .filter(k => !(k in contrastNotes))

// 2. Word notes: required coverage over every word taking part in a pair.
const confusable = new Set(pairs.flatMap(p => [p.a, p.b]))
const missingNotes = [...confusable].filter(id => !(id in wordNotes))

// 3. Sense groups: anchors (≥2 same-POS partners) not yet in any group.
const partners = new Map<string, string[]>()
for (const p of pairs) {
  const pa = posOf.get(p.a) ?? ''
  if (pa === '' || pa !== posOf.get(p.b)) continue
  ;(partners.get(p.a) ?? partners.set(p.a, []).get(p.a)!).push(p.b)
  ;(partners.get(p.b) ?? partners.set(p.b, []).get(p.b)!).push(p.a)
}
const anchors = [...partners.entries()].filter(([, l]) => l.length >= 2).map(([id]) => id)
const grouped = new Set(senseGroups.flatMap(g => g.order))
const uncoveredAnchors = anchors.filter(id => !grouped.has(id))

// 4. 回想 coverage. The mode draws from two pools and a word needs only one
// of them, so neither file alone answers "can this word be asked at all":
// sense groups take words with confusable partners, recall sentences take
// the rest. A word in neither is invisible to 回想 permanently, and until
// this line existed nothing said so — measured on 2026-08-17, 36 words were
// in that state while the scan printed FRESH.
//
// Reported as growth, not a required gap, on purpose. Every added word would
// otherwise flip the library to STALE the moment it lands, and "FRESH is a
// real verdict" is the property that keeps a refresh run from inventing work.
// This used to add that **none of them are anchors**, so the backlog could
// only ever be cleared by authoring renderings. That held while every anchor
// already had a group, and stopped holding the first time a batch landed
// faster than the groups did: re-measured 2026-08-26 over 635 words, 10 of
// the 12 words here are anchors, and a group would clear them. Read the two
// lists together — the overlap is which half of the backlog has a choice.
const inGroup = new Set(senseGroups.flatMap(g => g.order))
const inRecall = new Set(recallSentences.map(s => s.id))
const noRecallQuestion = words.map(w => w.id).filter(id => !inGroup.has(id) && !inRecall.has(id))

// --- Report, priority order ------------------------------------------------

let stale = false
const gap = (label: string, items: string[], required: boolean) => {
  if (items.length === 0) { console.log(`ok    ${label}`); return }
  stale = true
  console.log(`${required ? 'GAP  ' : 'grow '}${label}: ${items.length}`)
  for (const i of items.slice(0, 20)) console.log(`        ${i}`)
  if (items.length > 20) console.log(`        … and ${items.length - 20} more`)
}

console.log(`library: ${words.length} words · ${pairs.length} pairs · ${senseGroups.length} sense groups · ${passages.length} passages\n`)
gap('contrastNotes missing (required)', missingContrast, true)
gap('wordNotes missing (required)', missingNotes, true)
gap('sense-group anchors uncovered (pool growth)', uncoveredAnchors, false)
gap('words with no 回想 question at all (pool growth)', noRecallQuestion, false)

// Passage coverage is printed, never a STALE trigger. Covering every word
// three times over needs roughly 200 passages, so a coverage line here would
// hold the scan at STALE for months and train the reader to ignore it. The
// number that actually decides whether to write more is not in this repo: it
// is how often the corpus gets played, because play-count selection puts
// `corpus size` sessions between repeats (see the passage-selection spec).
const marked = new Set<string>()
for (const p of passages) for (const s of p.en) for (const m of s.matchAll(/\{\{([^{}|]+)/g)) marked.add(m[1].trim())
console.log(`\npassages: ${passages.length}, marking ${marked.size}/${words.length} words — grow when the corpus feels thin; no required floor`)

console.log(stale ? '\nSTALE — author what is named above, nothing else' : '\nFRESH — nothing owed, stop here')
