import { readFileSync } from 'node:fs'

/**
 * Gate for src/data/senseGroups.json — bundled content, so a bad entry
 * ships and stays until the next release; strict here, lenient at runtime,
 * the same split as the other five validators.
 *
 * The one rule with no counterpart elsewhere: **the prompt may contain no
 * Latin letters at all.** Every other authored file shows its text next to
 * the word it belongs to; a sense-group prompt is on screen *before* the
 * options exist, while the user is retrieving — a single English fragment
 * is the answer walking in early. Stricter than /guess's masking because
 * there is nothing to mask: the prompt is authored, so it can simply be
 * clean.
 */

const file = process.argv[2] ?? 'src/data/senseGroups.json'
const data = JSON.parse(readFileSync(file, 'utf8'))
const words = JSON.parse(readFileSync('data/words.json', 'utf8')).words as {
  id: string
  meanings: { pos: string }[]
}[]
const posOf = new Map(words.map(w => [w.id, w.meanings[0]?.pos ?? '']))
const errors: string[] = []

/**
 * Longer than a gloss, shorter than a passage sentence: the prompt sits
 * alone on the card at 375px and must be readable in one glance. The 59
 * groups in the initial batch measure 14–29 characters; 40 leaves headroom
 * without letting a paragraph in.
 */
const MAX_ZH = 40

if (data.version !== 1) errors.push('version must be 1')
if (!Array.isArray(data.groups)) {
  console.error('groups must be an array')
  process.exit(1)
}

const seenZh = new Set<string>()
const seenSet = new Set<string>()

data.groups.forEach((g: unknown, i: number) => {
  const at = `groups[${i}]`
  if (typeof g !== 'object' || g === null) { errors.push(`${at}: not an object`); return }
  const { zh, order, why } = g as { zh?: unknown; order?: unknown; why?: unknown }

  if (typeof zh !== 'string' || zh.trim() === '') { errors.push(`${at}: zh must be a non-empty string`); return }
  if (zh.length > MAX_ZH) errors.push(`${at} (${zh.slice(0, 10)}…): zh is ${zh.length} chars (max ${MAX_ZH})`)
  if (!/[一-鿿]/.test(zh)) errors.push(`${at}: zh must be Chinese — it is the question`)
  // The leak rule. [a-zA-Z] rather than a headword lookup, deliberately:
  // an inflection, a fragment, or a *different* English word all prime the
  // answer's shape. Zero Latin is the only version that needs no judgment.
  if (/[a-zA-Z]/.test(zh)) errors.push(`${at} (${zh.slice(0, 10)}…): zh contains Latin letters — the prompt shows before the options, this leaks`)

  if (seenZh.has(zh)) errors.push(`${at}: duplicate zh — it doubles as the rotation key, so a repeat makes two groups one`)
  seenZh.add(zh)

  if (!Array.isArray(order) || order.some(id => typeof id !== 'string')) {
    errors.push(`${at}: order must be an array of word ids`); return
  }
  if (order.length < 2 || order.length > 4) errors.push(`${at}: ${order.length} members (must be 2–4)`)
  if (new Set(order).size !== order.length) errors.push(`${at}: duplicate ids in order`)
  for (const id of order) {
    if (!posOf.has(id)) errors.push(`${at}: ${id} not in the vocabulary — this group can never render`)
  }
  // Same POS only: two words with different parts of speech never compete
  // inside one sentence, so ranking them is not a judgment the mode tests.
  const poses = new Set(order.map(id => posOf.get(id)).filter(p => p !== undefined))
  if (poses.size > 1) errors.push(`${at}: mixed POS ${[...poses].join('/')} — members must compete in the same slot`)

  const key = [...order].sort().join('|')
  if (seenSet.has(key)) errors.push(`${at}: same member set as an earlier group — one trio, one scenario each; merge or differentiate`)
  seenSet.add(key)

  if (typeof why !== 'string' || why.trim() === '') errors.push(`${at}: why must be a non-empty string — the answer without the why is just an assertion`)
  else if (!/[一-鿿]/.test(why)) errors.push(`${at}: why must be Chinese — it is study content`)
})

if (errors.length > 0) {
  console.error(`senseGroups: ${errors.length} error(s)`)
  for (const e of errors) console.error('  ' + e)
  process.exit(1)
}

// Coverage is reported, not enforced, like the other content validators:
// the library moves, and a candidate trio without a group degrades to
// "not asked", which is the correct failure.
const covered = new Set(data.groups.flatMap((g: { order: string[] }) => g.order))
console.log(`senseGroups: ${data.groups.length} groups OK, covering ${covered.size} words`)
