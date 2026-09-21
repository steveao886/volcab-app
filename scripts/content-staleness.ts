import { readFileSync } from 'node:fs'
import { buildContrastPairs } from '../src/lib/contrast.ts'
import { contrastNoteKey } from '../src/lib/contrastNotes.ts'
import { buildConceptIndex, conceptMembers } from '../src/lib/diverge.ts'
import type { Concept } from '../src/lib/diverge.ts'

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
  examples: string[]
  antonyms: string[]
}[]
const contrastNotes = JSON.parse(readFileSync('src/data/contrastNotes.json', 'utf8')).notes as Record<string, string>
const wordNotes = JSON.parse(readFileSync('src/data/wordNotes.json', 'utf8')).notes as Record<string, string>
const senseGroups = JSON.parse(readFileSync('src/data/senseGroups.json', 'utf8')).groups as { order: string[] }[]
const passages = JSON.parse(readFileSync('src/data/passages.json', 'utf8')).passages as { en: string[] }[]
const recallSentences = JSON.parse(readFileSync('src/data/recallSentences.json', 'utf8')).sentences as { id: string; i: number }[]
const sentenceChunks = JSON.parse(readFileSync('src/data/sentenceChunks.json', 'utf8')).chunks as { id: string }[]
const concepts = JSON.parse(readFileSync('src/data/concepts.json', 'utf8')).concepts as Concept[]

// 发散 is the one mode a new word joins with nothing authored: a concept lists
// synonym *keys*, and its members are whatever words currently carry them. So
// the membership of every concept shifts every time the library grows, and
// nothing in this scan can tell a member that belongs from one that does not
// — that judgment is what `exclude` records, and only a person can make it.
// What a script can do is name the candidates, by diffing the membership
// across the batch:
//
//   npx tsx scripts/content-staleness.ts --concepts > before.txt
//   ...add the words...
//   npx tsx scripts/content-staleness.ts --concepts | diff before.txt -
//
// Every `>` line is a membership this batch created and a person has to read.
// Measured 2026-09-21 over 931 words: 82 concepts reach 325 words, so roughly
// a third of the library is inside some answer set and an added word has a
// real chance of landing in one.
const conceptIndex = buildConceptIndex(words as never)
const allIds = new Set(words.map(w => w.id))
if (process.argv.includes('--concepts')) {
  for (const c of concepts) {
    for (const m of conceptMembers(c, conceptIndex, allIds)) console.log(`${c.id}	${m}`)
  }
  process.exit(0)
}

const pairs = buildContrastPairs(words as never)
const posOf = new Map(words.map(w => [w.id, w.meanings[0]?.pos ?? '']))

// --- --batch: what one batch of just-added words still owes -----------------
//
// The scan proper is stateless: it cannot tell a word added an hour ago from
// one added in June, and that is exactly the distinction the add flow needs.
// A new word's 回想 hole blocks its batch; the historical backlog below is the
// monthly refresh's to clear, and merging the two would hide whether that
// backlog is shrinking. So the batch names itself on the command line:
//
//   npx tsx scripts/content-staleness.ts --batch abrogate,rescind
//
// Exit 1 on any required hole, so the check can sit in front of a commit.
if (process.argv.includes('--batch')) {
  const arg = process.argv[process.argv.indexOf('--batch') + 1]
  if (arg === undefined || arg.startsWith('--')) {
    console.error('--batch needs a comma-separated list of word ids')
    process.exit(2)
  }
  const ids = arg.split(',').map(x => x.trim()).filter(x => x !== '')
  const byId = new Map(words.map(w => [w.id, w]))
  const noted = new Set(Object.keys(wordNotes))
  const renderings = new Map<string, Set<number>>()
  for (const r of recallSentences) {
    const set = renderings.get(r.id)
    if (set) set.add(r.i)
    else renderings.set(r.id, new Set([r.i]))
  }
  const inAnyGroup = new Set(senseGroups.flatMap(g => g.order))

  let owed = 0
  for (const id of ids) {
    const w = byId.get(id)
    console.log(id)
    // The whole check reads data/words.json, so a missing id means the entry
    // was never written there — the one ordering mistake that makes every
    // other gate in the add flow silently pass on nothing.
    if (w === undefined) {
      console.log('  GAP  not in data/words.json — write the repo copy first')
      owed++
      continue
    }

    const mine = pairs.filter(pp => pp.a === id || pp.b === id)
    const missingKeys = mine.map(pp => contrastNoteKey(pp.a, pp.b)).filter(k => !(k in contrastNotes))
    if (missingKeys.length > 0) { owed++; console.log(`  GAP  contrastNotes: ${missingKeys.join(', ')}`) }
    else console.log(`  ok   contrastNotes (${mine.length} pair(s))`)

    // Both the word itself and any partner this batch just made confusable:
    // a word that had no pair before owes a 要点 the moment it gains one, and
    // that debt belongs to the batch that created the pair, not to its owner.
    const owesNotes = [id, ...mine.map(pp => (pp.a === id ? pp.b : pp.a))]
      .filter(x => mine.length > 0 && !noted.has(x))
    if (owesNotes.length > 0) { owed++; console.log(`  GAP  wordNotes: ${[...new Set(owesNotes)].join(', ')}`) }
    else console.log('  ok   wordNotes')

    // 回想 is a required add-time top-up as of 2026-09-21. Two legs, not a
    // choice between them: an anchor is covered by the sense group it joins,
    // and an anchor whose group was skipped for being indefensible falls back
    // to renderings like any other word. Five is `examples.length`, not a
    // constant — the five-examples content rule is not enforced by any gate.
    const have = renderings.get(id)?.size ?? 0
    const want = w.examples?.length ?? 0
    if (inAnyGroup.has(id)) console.log('  ok   回想 (in a sense group)')
    else if (have >= want && want > 0) console.log(`  ok   回想 (${have}/${want} renderings)`)
    else { owed++; console.log(`  GAP  回想: no sense group, ${have}/${want} renderings`) }

    // 反义 never blocks. There is no file to top up — the mode reads the
    // entry's own `antonyms` array — and 107 of 931 words carry no opposite
    // at all (measured 2026-09-21). Inventing one to clear a line is the
    // failure the fail-closed rule exists to prevent.
    if ((w.antonyms?.length ?? 0) === 0) console.log('  note 反义: antonyms is empty — the word is unaskable there; fine if it has no opposite')
    else console.log(`  ok   反义 (${w.antonyms.length} opposite(s))`)
  }

  console.log(owed === 0
    ? `
${ids.length} word(s): nothing owed`
    : `
${owed} required hole(s) across ${ids.length} word(s) — author them before committing`)
  process.exit(owed === 0 ? 0 : 1)
}

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
// The "grow" label states whose debt this is, not whether it counts: GAP
// lines are coverage the word-adding session owes before it ships; grow
// lines are pool growth left to the scheduled refresh. Both hold the
// verdict at STALE, deliberately — "FRESH — stop here" stops a refresh run
// before it reads any list, so a backlog that spared the verdict would be
// invisible to the only session meant to clear it. That is the very bug
// this line fixed (2026-08-17, commit 85226f0: FRESH printed while 36
// words had no 回想 question). An earlier version of this paragraph
// claimed growth was meant not to flip the verdict; the code has never
// worked that way (gap() flips on any non-empty list since f0be0c9), and
// the one list that truly must not hold the verdict — passage coverage —
// bypasses gap() entirely below.
//
// Re-measured 2026-08-29 over 659 words: 14 of the 25 words here are
// anchors, and a sense group would clear them; the other 11 can only be
// cleared by authoring renderings. Read the two grow lists together — the
// overlap is which half of the backlog has a choice.
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

// 组句 coverage is printed, never a STALE trigger, and for the same reason
// the passage line below bypasses gap(). Its ceiling is a subset of the
// library by construction: a word can only be asked once some sentence of
// it has authored chunk boundaries, and the pool it draws from is itself
// bounded by which sentences carry a Chinese rendering. A line that can
// never reach zero would hold the scan at STALE permanently, and a
// permanently red scan stops being read — which is the failure the 回想
// coverage line above was added to fix, in the other direction.
//
// Depth is reported beside breadth because they buy different things.
// Breadth is whether a word can be asked at all; depth is whether a word
// the difficulty draw wants three times can be asked three times without
// repeating a sentence, and a repeated sentence tests the sentence.
const chunked = new Set(sentenceChunks.map(c => c.id))
const perChunkWord = new Map<string, number>()
for (const c of sentenceChunks) perChunkWord.set(c.id, (perChunkWord.get(c.id) ?? 0) + 1)
const deep = [...perChunkWord.values()].filter(n => n >= 3).length
console.log(`
组句: ${sentenceChunks.length} annotations covering ${chunked.size}/${words.length} words, ${deep} of them 3+ sentences deep — grow with the content batches; no required floor`)

// 发散 coverage is printed, never a STALE trigger, and for the third time for
// the same reason: it cannot reach zero. A concept is a semantic cluster
// keyed on synonym keys, and most of the library — concrete nouns, phrases,
// anything with no near-synonyms authored — will never belong to one, so a
// coverage line here would sit red forever and stop being read.
//
// Reach is printed instead of a gap because reach is the number that moves on
// its own. It is the size of the surface a new word can silently land on, and
// the only reason the --concepts diff above is worth running.
const conceptReach = new Set(concepts.flatMap(c => conceptMembers(c, conceptIndex, allIds)))
console.log(`
发散: ${concepts.length} concepts reaching ${conceptReach.size}/${words.length} words — membership is derived, so a new word joins with nothing authored; diff --concepts across the batch and read every new line`)

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
