import { readFileSync, writeFileSync } from 'node:fs'

/**
 * Appends a batch of authored chunk boundaries to src/data/sentenceChunks.json.
 *
 * Input is one annotation a line, in the shorthand the worksheet's output is
 * read against:
 *
 *   sg <groupIndex> <cuts,csv> <blank>
 *   ex <wordId> <exampleIndex> <cuts,csv> <blank>
 *
 * `id` (for sg) and `answer` are **derived**, not typed: both are mechanical
 * reads off the sentence the indices point into, and typing them by hand
 * would only create a second place for them to be wrong.
 * validate-sentence-chunks re-derives `answer` independently and fails if it
 * disagrees, so a mis-aimed `blank` becomes a loud error rather than a
 * question that blanks the wrong word.
 *
 * Blank lines and `#` comments are ignored, so a worksheet block can be
 * pasted in and annotated in place.
 */

const input = process.argv[2]
if (input === undefined) {
  console.error('usage: tsx scripts/chunk-append.ts <batch-file>')
  process.exit(1)
}

const OUT = 'src/data/sentenceChunks.json'
const words = JSON.parse(readFileSync('data/words.json', 'utf8')).words as {
  id: string; examples: string[]
}[]
const byId = new Map(words.map(w => [w.id, w]))
const groups = JSON.parse(readFileSync('src/data/senseGroups.json', 'utf8')).groups as {
  en: string; order: string[]
}[]

const normalize = (s: string): string =>
  s.trim().toLowerCase().replace(/^[^a-z0-9]+/, '').replace(/[^a-z0-9]+$/, '')

interface Annotation { src: string; id: string; i: number; cuts: number[]; blank: number; answer: string }

const file = JSON.parse(readFileSync(OUT, 'utf8')) as { version: 1; chunks: Annotation[] }
const seen = new Set(file.chunks.map(c => `${c.src}:${c.id}:${c.i}`))
const added: Annotation[] = []
const errors: string[] = []

const lines = readFileSync(input, 'utf8').split(/\r?\n/)
lines.forEach((raw, n) => {
  const line = raw.split('#')[0].trim()
  if (line === '') return
  const parts = line.split(/\s+/)
  const at = `line ${n + 1}`

  let src: string, id: string, i: number, cutsRaw: string, blankRaw: string
  if (parts[0] === 'sg') {
    if (parts.length !== 4) { errors.push(`${at}: sg needs 4 fields, got ${parts.length}`); return }
    src = 'sg'
    i = Number(parts[1]);[, , cutsRaw, blankRaw] = parts
    const g = groups[i]
    if (g === undefined) { errors.push(`${at}: no group at index ${i}`); return }
    id = g.order[0]
  } else if (parts[0] === 'ex') {
    if (parts.length !== 5) { errors.push(`${at}: ex needs 5 fields, got ${parts.length}`); return }
    src = 'ex'
    id = parts[1]
    i = Number(parts[2]);[, , , cutsRaw, blankRaw] = parts
  } else {
    errors.push(`${at}: first field must be "ex" or "sg", got ${JSON.stringify(parts[0])}`)
    return
  }

  const key = `${src}:${id}:${i}`
  if (seen.has(key)) { errors.push(`${at}: ${key} is already annotated`); return }

  const en = src === 'sg' ? groups[i].en : byId.get(id)?.examples[i]
  if (en === undefined) { errors.push(`${at}: ${key} has no sentence`); return }
  const tokens = en.trim().split(/\s+/)

  const cuts = cutsRaw.split(',').map(Number)
  const blank = Number(blankRaw)
  if (cuts.some(x => !Number.isInteger(x))) { errors.push(`${at}: bad cuts ${cutsRaw}`); return }
  if (!Number.isInteger(blank) || blank < 0 || blank >= tokens.length) {
    errors.push(`${at}: blank ${blankRaw} outside 0..${tokens.length - 1}`)
    return
  }
  const answer = normalize(tokens[blank])
  if (!/^[a-z]+(-[a-z]+)*$/.test(answer)) {
    errors.push(`${at}: token ${blank} is ${JSON.stringify(tokens[blank])}, not a plain word`)
    return
  }

  seen.add(key)
  added.push({ src, id, i, cuts, blank, answer })
})

if (errors.length > 0) {
  console.error(`${errors.length} error(s), nothing written:`)
  for (const e of errors) console.error('  ' + e)
  process.exit(1)
}

file.chunks = [...file.chunks, ...added]
writeFileSync(OUT, JSON.stringify(file, null, 1) + '\n')
console.log(`appended ${added.length}, ${file.chunks.length} total`)
