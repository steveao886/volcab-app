import { readFileSync } from 'node:fs'
import { buildConceptIndex, buildQuestion, conceptMembers, DIVERGE_AXES, MIN_ANSWERS } from '../src/lib/diverge.ts'
import type { Concept } from '../src/lib/diverge.ts'
import type { Progress, Word } from '../src/types.ts'

/**
 * Gate for src/data/concepts.json — bundled content, so a bad entry ships and
 * stays until the next release. Strict here, lenient at runtime, the same
 * split as the other eight validators.
 *
 * The rule this file exists for: **an authored concept does not list its own
 * members.** It lists synonym *keys*, and the members are whatever currently
 * carries them. That is what lets a word added next month join three of the
 * four axes with nothing re-authored — and it is also what makes a concept
 * un-self-describing, so everything a reader would otherwise check by eye has
 * to be checked here instead.
 *
 * Resolution runs at **full-library scope**, not against anyone's progress.
 * A concept that needs six more words learned before it can be asked is not
 * an error; a concept that cannot reach three members even with the whole
 * library learned is.
 */

const file = process.argv[2] ?? 'src/data/concepts.json'
const data = JSON.parse(readFileSync(file, 'utf8')) as { version: number; concepts: Concept[] }
const words = JSON.parse(readFileSync('data/words.json', 'utf8')).words as Word[]
const errors: string[] = []

const index = buildConceptIndex(words)
const byId = new Map(words.map(w => [w.id, w]))
const everything = new Set(words.map(w => w.id))

/** Full-library progress: every word learned, so resolution is scope-free. */
const asIfLearned: Progress = {
  version: 1,
  settings: { newPerDay: 0 },
  words: Object.fromEntries(words.map(w => [w.id, {
    state: 'review' as const,
    ease: 2.5,
    intervalDays: 1,
    due: '2026-01-01',
    stepIndex: 0,
    reps: 1,
    lapses: 0,
    lastReviewedAt: '2026-01-01T00:00:00.000Z',
  }])),
  dailyStats: {},
}

/**
 * Prefixes the 加否定 axis tests. The base is deliberately **not** required to
 * be a standalone English word: `implacable` and `intransigent` have no
 * free-standing `placable` or `transigent`, and they are among the most
 * valuable entries here precisely because they are where the im-/in- choice
 * has to be known rather than reasoned out.
 */
const NEG_PREFIXES = ['dis', 'non', 'un', 'in', 'im', 'ir', 'il']

const seenIds = new Set<string>()
const seenMembers = new Map<string, string>()

for (const [i, c] of data.concepts.entries()) {
  const at = `[${i}] ${c.id ?? '(no id)'}`

  if (typeof c.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(c.id)) errors.push(`${at}: id must be a lowercase slug`)
  if (seenIds.has(c.id)) errors.push(`${at}: duplicate id`)
  seenIds.add(c.id)

  // The prompt is on screen *before* any answer exists, while the user is
  // retrieving. A single Latin letter is the answer walking in early — the
  // same rule, for the same reason, as SenseGroup.zh.
  if (typeof c.zh !== 'string' || c.zh.trim() === '') errors.push(`${at}: zh is required`)
  else if (/[A-Za-z]/.test(c.zh)) errors.push(`${at}: zh contains a Latin letter: ${c.zh}`)

  if (!Array.isArray(c.anchors) || c.anchors.length === 0) { errors.push(`${at}: anchors is required`); continue }

  for (const a of c.anchors) {
    const bucket = index.buckets.get(a.trim().toLowerCase())
    const isHeadword = index.byHeadword.has(a.trim().toLowerCase())
    // An anchor carrying one word is not a concept, it is that word. Two is
    // the floor for the key to mean anything at all.
    if ((bucket?.size ?? 0) + (isHeadword ? 1 : 0) < 2) {
      errors.push(`${at}: anchor "${a}" reaches ${(bucket?.size ?? 0) + (isHeadword ? 1 : 0)} word(s); it must reach at least 2`)
    }
  }

  for (const id of c.exclude ?? []) {
    if (!everything.has(id)) errors.push(`${at}: exclude "${id}" is not a library word`)
  }
  for (const id of c.negations ?? []) {
    if (!everything.has(id)) { errors.push(`${at}: negations "${id}" is not a library word`); continue }
    if (!NEG_PREFIXES.some(p => id.startsWith(p) && id.length - p.length >= 4)) {
      errors.push(`${at}: negations "${id}" carries no negation prefix`)
    }
  }

  const members = conceptMembers(c, index, everything)
  if (members.length < MIN_ANSWERS) {
    errors.push(`${at}: resolves to ${members.length} member(s) with the whole library learned; needs ${MIN_ANSWERS}`)
    continue
  }

  // Two concepts resolving to the same words are two spellings of one
  // question, which is the specific failure the anchor design exists to
  // prevent — 固执 splits into three heavily overlapping raw buckets
  // (stubborn 9, unyielding 8, obstinate 6), and authoring them separately
  // would put all three in the same round.
  const key = members.join('|')
  const twin = seenMembers.get(key)
  if (twin) errors.push(`${at}: resolves to exactly the same members as ${twin}`)
  else seenMembers.set(key, c.id)

  // An exclusion that no anchor ever drags in is a stale note about a word
  // that has since been deleted or had its synonyms rewritten.
  for (const id of c.exclude ?? []) {
    const reached = c.anchors.some(a => index.buckets.get(a.trim().toLowerCase())?.has(id) || index.byHeadword.get(a.trim().toLowerCase()) === id)
    if (!reached) errors.push(`${at}: exclude "${id}" is not reached by any anchor; it does nothing`)
  }
}

if (errors.length > 0) {
  console.error(`concepts: ${errors.length} error(s)`)
  for (const e of errors) console.error('  ' + e)
  process.exit(1)
}

// Coverage and per-axis reach are reported, never enforced: which axes a
// concept can ask depends on the library, and an axis that falls below the
// floor degrades to "not asked", which is the correct failure.
const reach = new Map(DIVERGE_AXES.map(a => [a, 0]))
const covered = new Set<string>()
for (const c of data.concepts) {
  for (const axis of DIVERGE_AXES) {
    if (buildQuestion(c, axis, index, asIfLearned)) reach.set(axis, reach.get(axis)! + 1)
  }
  for (const id of conceptMembers(c, index, everything)) covered.add(id)
}
console.log(`concepts: ${data.concepts.length} concepts OK, covering ${covered.size} words`)
console.log(`  askable with the whole library learned — ${[...reach].map(([a, n]) => `${a} ${n}`).join(', ')}`)

const thin = data.concepts.filter(c => conceptMembers(c, index, everything).length === MIN_ANSWERS)
if (thin.length > 0) {
  console.log(`\n${thin.length} concept(s) sitting exactly on the ${MIN_ANSWERS}-member floor — one deleted word stops them being asked:`)
  for (const c of thin) console.log(`  ${c.id}: ${conceptMembers(c, index, everything).map(id => byId.get(id)?.headword ?? id).join(', ')}`)
}
