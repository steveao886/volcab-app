import { readFileSync } from 'node:fs'

/**
 * Gate for src/data/recallSentences.json — bundled content, so a bad entry
 * ships and stays until the next release. Strict here, lenient at runtime,
 * the same split as the other five validators.
 *
 * The rule with no counterpart outside sense groups: **`zh` may contain no
 * Latin letter at all.** The rendering is on screen *before* the options,
 * while the learner is retrieving, so a single English fragment is the
 * answer walking in early. In practice it bites on proper nouns carried
 * over from the English example — Slack, Bitcoin, PTA, CEO, Q4 — which have
 * to be rendered into Chinese rather than left standing.
 *
 * See docs/superpowers/specs/2026-08-16-recall-expansion-design.md.
 */

const file = process.argv[2] ?? 'src/data/recallSentences.json'
const data = JSON.parse(readFileSync(file, 'utf8'))
const words = JSON.parse(readFileSync('data/words.json', 'utf8')).words as {
  id: string
  headword: string
  examples: string[]
}[]
const byId = new Map(words.map(w => [w.id, w]))
const errors: string[] = []

/**
 * Same ceiling as a sense group's target, for the same reason: it is an
 * emphasis on the chunk being asked, not a second sentence. Anything longer
 * reads as "produce all of this in one English word".
 */
const MAX_TARGET = 16

if (data.version !== 1) errors.push('version must be 1')
if (!Array.isArray(data.sentences)) {
  console.error('sentences must be an array')
  process.exit(1)
}

const seen = new Set<string>()

data.sentences.forEach((s: unknown, n: number) => {
  const at = `sentences[${n}]`
  if (typeof s !== 'object' || s === null) { errors.push(`${at}: not an object`); return }
  const { id, i, zh, target } = s as { id?: unknown; i?: unknown; zh?: unknown; target?: unknown }

  if (typeof id !== 'string' || id === '') { errors.push(`${at}: id must be a non-empty string`); return }
  const w = byId.get(id)
  // Dangling is a hard failure, missing is not — the same asymmetry the
  // contrast/word-note validators settled on. A rendering keyed to a word
  // that isn't there can never render; a word with no rendering just isn't
  // asked from this source.
  if (w === undefined) { errors.push(`${at}: ${id} not in the vocabulary — this sentence can never render`); return }

  if (!Number.isInteger(i) || (i as number) < 0 || (i as number) >= w.examples.length) {
    errors.push(`${at} (${id}): i is ${JSON.stringify(i)} but ${id} has ${w.examples.length} examples`)
    return
  }

  const key = `${id}#${i as number}`
  if (seen.has(key)) errors.push(`${at}: duplicate ${key} — one rendering per example`)
  seen.add(key)

  if (typeof zh !== 'string' || zh.trim() === '') { errors.push(`${at} (${key}): zh must be a non-empty string`); return }
  if (!/[一-鿿]/.test(zh)) errors.push(`${at} (${key}): zh must be Chinese — it is the question`)
  if (/[a-zA-Z]/.test(zh)) {
    const leak = zh.match(/[a-zA-Z]+/g)?.join(', ') ?? ''
    errors.push(`${at} (${key}): zh contains Latin letters (${leak}) — the prompt shows before the options, this leaks`)
  }

  if (typeof target !== 'string' || target.trim() === '') {
    errors.push(`${at} (${key}): target must be a non-empty string — the prompt needs to say which part to express`)
    return
  }
  if (/[a-zA-Z]/.test(target)) errors.push(`${at} (${key}): target contains Latin letters`)
  if (target.length > MAX_TARGET) errors.push(`${at} (${key}): target is ${target.length} chars (max ${MAX_TARGET})`)
  const hits = zh.split(target).length - 1
  if (hits !== 1) errors.push(`${at} (${key}): target "${target}" appears ${hits}x in zh — must appear exactly once`)
})

if (errors.length > 0) {
  console.error(`recallSentences: ${errors.length} error(s)`)
  for (const e of errors) console.error('  ' + e)
  process.exit(1)
}

const covered = new Set(data.sentences.map((s: { id: string }) => s.id))
console.log(`recallSentences: ${data.sentences.length} sentences OK, covering ${covered.size} words`)

/**
 * The long-target tail, reported and never enforced — the same call
 * validate-sense-groups makes. How long a target should be depends on the
 * word: `alleviate` needs 减轻, and a word that genuinely says more needs
 * more. No length rule separates the two, so print the tail and let a human
 * read it.
 */
const LONG_TARGET = 6
const long = data.sentences.filter((s: { target: string }) => s.target.length > LONG_TARGET)
if (long.length > 0) {
  console.log(`\n${long.length} target(s) over ${LONG_TARGET} chars — read these, a target is the word, not the clause around it:`)
  for (const s of long.slice(0, 25) as { id: string; i: number; target: string }[]) {
    console.log(`  ${s.id}#${s.i}: ${s.target}`)
  }
  if (long.length > 25) console.log(`  … and ${long.length - 25} more`)
}
