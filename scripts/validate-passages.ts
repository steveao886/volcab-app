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
import { headwordPattern, isInflectionOf } from '../src/lib/headword.ts'
import { buildContrastPairs } from '../src/lib/contrast.ts'

/**
 * Minimum number of *distinct* words each passage must mark. Cloze only pulls from learned
 * words, so too few marks and an early passage can't even scrape together 3 blanks.
 *
 * Must be distinct, not raw occurrences: selectBlanks in passage.ts dedupes marks by wordId
 * (a word marked six times still only ever yields one blank), so counting regex matches lets
 * a passage that can structurally never produce a question sail through as "validation
 * passed" -- verified: a passage marking one word six times passed and yielded exactly 1
 * blank at runtime, permanently below MIN_BLANKS.
 */
const MIN_MARKS = 6

const MARKER = /\{\{([^{}|]+)(?:\|([^{}|]+))?\}\}/g
/**
 * Warns when an article sits directly against a marker: "an {{ominous}}" tells the reader
 * the answer is vowel-initial before they've read a word of the sentence, and "a
 * {{precursor}}" rules out every vowel-initial candidate in the choice list. Either leaks
 * part of the answer for free. Not global / not reused across calls, so plain `.test()` is
 * safe to call repeatedly. Case-insensitive so a sentence-initial "An {{...}}" is caught too.
 */
const ARTICLE_LEAK = /\b(a|an)\s+\{\{/i

// Consistent with validate-words.ts: no types wrapped around data in these scripts, since the object being validated may well not match the shape
const words = JSON.parse(readFileSync('data/words.json', 'utf8'))
// Path is overridable so a draft corpus can be checked before it is merged in,
// matching validate-words and validate-suggestions.
const passagesPath = process.argv[2] ?? 'src/data/passages.json'
const file = JSON.parse(readFileSync(passagesPath, 'utf8'))

if (file.version !== 1) { console.error('version must be 1'); process.exit(1) }
if (!Array.isArray(file.passages)) { console.error('passages must be an array'); process.exit(1) }
if (file.passages.length === 0) { console.error('passages cannot be empty'); process.exit(1) }

const byId = new Map<string, { headword: string }>(
  words.words.map((w: { id: string; headword: string }) => [w.id, w]),
)
// Computed once over the full word list and reused per passage -- same reasoning as
// pickPassage in passage.ts building it once outside its per-passage loop, rather than
// recomputing the inverted index on every iteration.
const pairs = buildContrastPairs(words.words)

const errors: string[] = []
const warnings: string[] = []
const poolLines: string[] = []
const seenIds = new Set<string>()
const useCount = new Map<string, number>()

for (const p of file.passages) {
  const at = (msg: string) => errors.push(`[${p.id}] ${msg}`)

  // Cover the shape first, or p.en.entries() below would throw a stack trace that doesn't say
  // which passage is at fault. Every element of en/zh must itself be a string too -- an "en"
  // array holding a stray number used to reach sentence.replace() below and blow up with a raw
  // "sentence.replace is not a function" instead of an error naming the passage.
  if (typeof p.id !== 'string' || typeof p.title !== 'string'
      || !Array.isArray(p.en) || !Array.isArray(p.zh)
      || !p.en.every((s: unknown) => typeof s === 'string')
      || !p.zh.every((s: unknown) => typeof s === 'string')) {
    errors.push(`[${String(p.id)}] missing id / title / en / zh, or wrong type (en/zh must be arrays of strings)`)
    continue
  }

  if (!/^[a-z0-9-]+$/.test(p.id)) at('id may only contain lowercase letters, digits, and hyphens')
  if (seenIds.has(p.id)) at('duplicate id')
  seenIds.add(p.id)

  if (p.title.trim() === '') at('title cannot be empty')
  if (p.en.length === 0) at('en cannot be empty')
  if (p.en.length !== p.zh.length) at(`English/Chinese sentence counts don't match: en has ${p.en.length}, zh has ${p.zh.length}`)

  for (const [si, z] of p.zh.entries()) {
    if (z.trim() === '') at(`zh sentence ${si + 1} is empty or whitespace-only`)
  }

  const markedIds = new Set<string>()
  const strippedSentences: string[] = []
  for (const [si, sentence] of p.en.entries()) {
    // Strip out valid markers first; any braces left over mean it's malformed
    const stripped = sentence.replace(MARKER, '')
    strippedSentences.push(stripped)
    if (/[{}]/.test(stripped)) at(`sentence ${si + 1} has a malformed marker`)
    if (ARTICLE_LEAK.test(sentence)) warnings.push(`[${p.id}] sentence ${si + 1}: article sits directly against a marker, leaking the answer's first letter -- "${sentence}"`)

    for (const m of sentence.matchAll(MARKER)) {
      const wordId = m[1].trim()
      const surface = (m[2] ?? m[1]).trim()
      markedIds.add(wordId)
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
  if (markedIds.size < MIN_MARKS) at(`only marked ${markedIds.size} distinct word(s), needs at least ${MIN_MARKS}`)

  // Same hazard quiz.ts guards against twice (clozeExample's "blank out every occurrence in
  // the same sentence", contrastQuestion's "the other word's headword must not remain in the
  // sentence") -- except here the leftover occurrence can be in any *other* sentence of the
  // same passage, not just the one it's marked in. Strip every marker out of the whole
  // passage first, so what's left is exactly the prose the reader sees printed as-is; if a
  // marked word's headword still shows up in that prose, the answer is sitting in plain sight.
  const prose = strippedSentences.join(' ')
  for (const wordId of markedIds) {
    const w = byId.get(wordId)
    if (w === undefined) continue // already reported above as not in the vocabulary
    if (headwordPattern(prose, w.headword) !== null) {
      at(`"${wordId}" (${w.headword}) is marked as a blank but also appears as plain text elsewhere in the passage, giving the answer away`)
    }
  }

  // Tier-1 distractor pool: non-direct neighbours of this passage's marked words on the
  // confusable-word graph, minus the marked words themselves and the author's manual
  // `exclude` list (see Passage.exclude's doc comment in src/lib/passage.ts). Mirrors
  // pickDistractors' tier 1 exactly -- direct pairs are never offered as distractors, see the
  // comment on pickDistractors for why -- so the author can review, ahead of time, everything
  // tier 1 could hand out for this passage.
  const neighbours = new Set<string>()
  for (const pair of pairs) {
    if (pair.direct) continue
    if (markedIds.has(pair.a)) neighbours.add(pair.b)
    else if (markedIds.has(pair.b)) neighbours.add(pair.a)
  }
  const excludeSet = new Set<string>([...markedIds, ...(Array.isArray(p.exclude) ? p.exclude : [])])
  const pool = [...neighbours]
    .filter(id => !excludeSet.has(id))
    .sort()
    .map(id => `${byId.get(id)?.headword ?? id} (${id})`)
  poolLines.push(`  [${p.id}] ${pool.length > 0 ? pool.join(', ') : '(none)'}`)
}

// --- Coverage distribution report (not an error, just input for the next batch of passages) ---
const covered = [...useCount.keys()].length
console.log(`${file.passages.length} passages, covering ${covered} / ${words.words.length} words`)
const multi = [...useCount.values()].filter(c => c >= 3).length
console.log(`of which ${multi} appear 3+ times`)

// --- Tier-1 distractor pool, per passage ---
console.log('\nTier-1 distractor pool per passage (NOT exhaustive -- see note below):')
for (const line of poolLines) console.log(line)
console.log(
  '  Note: this is only the tier-1 pool (confusable-word graph neighbours). When tier 1 ' +
  "can't fill the quota, pickDistractors falls back to same-part-of-speech words and then " +
  'any learned word, both of which draw from the entire library -- words outside this list ' +
  'CAN still appear as distractors (measured: committee-report draws at least one from ' +
  "outside this pool in 24% of its questions). Read each listed word for whether it could " +
  'double as a correct answer in this passage; this is not a closed set.',
)

// --- Warnings: don't block the gate, but the author should see them before shipping ---
if (warnings.length > 0) {
  console.warn(`\n${warnings.length} warning(s) (non-blocking):`)
  for (const w of warnings) console.warn('  ' + w)
}

if (errors.length > 0) {
  console.error(`\nvalidation failed, ${errors.length} issue(s):`)
  for (const e of errors) console.error('  ' + e)
  process.exit(1)
}
console.log('\nvalidation passed')
