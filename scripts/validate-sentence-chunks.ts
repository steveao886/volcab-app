import { readFileSync } from 'node:fs'

/**
 * Gate for src/data/sentenceChunks.json — bundled content, so a bad entry
 * ships and stays until the next release. Strict here, lenient at runtime,
 * the same split as the other six validators.
 *
 * The rules with no counterpart elsewhere all come from one fact: an
 * annotation is a set of **token indices into a sentence stored somewhere
 * else**. Nothing about it is self-describing, so every index has to be
 * checked against the live text, and `answer` has to still be the token it
 * names. `sentenceChunk.ts` re-checks all of this at runtime and silently
 * skips what fails; this is where it gets said out loud.
 *
 * See docs/superpowers/specs/2026-08-30-sentence-compose-design.md.
 */

const file = process.argv[2] ?? 'src/data/sentenceChunks.json'
const data = JSON.parse(readFileSync(file, 'utf8'))
const words = JSON.parse(readFileSync('data/words.json', 'utf8')).words as {
  id: string
  examples: string[]
}[]
const groups = JSON.parse(readFileSync('src/data/senseGroups.json', 'utf8')).groups as {
  en: string
  order: string[]
}[]
const renderings = JSON.parse(readFileSync('src/data/recallSentences.json', 'utf8')).sentences as {
  id: string
  i: number
}[]

const byId = new Map(words.map(w => [w.id, w]))
const rendered = new Set(renderings.map(s => `${s.id}:${s.i}`))
const errors: string[] = []

/** Chunk-count floors. See MIN_CHUNKS in src/lib/sentenceChunk.ts for why sg is lower. */
const MIN_CHUNKS: Record<string, number> = { ex: 5, sg: 4 }

/**
 * A chunk longer than this stops reading as one meaning unit and starts
 * being half a sentence — which is exactly what the heuristic splitter
 * produced (median 8 tokens, p90 13) and why boundaries are authored.
 */
const MAX_CHUNK_TOKENS = 8

const normalize = (s: string): string =>
  s.trim().toLowerCase().replace(/^[^a-z0-9]+/, '').replace(/[^a-z0-9]+$/, '')

if (data.version !== 1) errors.push('version must be 1')
if (!Array.isArray(data.chunks)) {
  console.error('chunks must be an array')
  process.exit(1)
}

const seen = new Set<string>()

data.chunks.forEach((c: unknown, n: number) => {
  const at = `chunks[${n}]`
  if (typeof c !== 'object' || c === null) { errors.push(`${at}: not an object`); return }
  const { src, id, i, cuts, blank, answer } = c as Record<string, unknown>

  if (src !== 'ex' && src !== 'sg') { errors.push(`${at}: src must be "ex" or "sg"`); return }
  if (typeof id !== 'string' || id === '') { errors.push(`${at}: id must be a non-empty string`); return }
  if (!Number.isInteger(i) || (i as number) < 0) { errors.push(`${at} (${id}): i must be a non-negative integer`); return }

  const key = `${src}:${id}:${i}`
  if (seen.has(key)) { errors.push(`${at}: duplicate ${key}`); return }
  seen.add(key)

  // Resolve the English the same way the runtime does.
  let en: string | undefined
  if (src === 'ex') {
    const w = byId.get(id)
    // Dangling is a hard failure, missing is not — the same asymmetry every
    // other content validator settled on.
    if (w === undefined) { errors.push(`${at} (${key}): ${id} not in the vocabulary`); return }
    if ((i as number) >= w.examples.length) {
      errors.push(`${at} (${key}): i is ${i} but ${id} has ${w.examples.length} examples`)
      return
    }
    en = w.examples[i as number]
    // The Chinese prompt for an ex annotation lives in recallSentences.json.
    // Without it the question has nothing to show and can never be asked.
    if (!rendered.has(`${id}:${i}`)) {
      errors.push(`${at} (${key}): no Chinese rendering in recallSentences.json — this can never be asked`)
      return
    }
  } else {
    const g = groups[i as number]
    if (g === undefined) { errors.push(`${at} (${key}): no group at index ${i}`); return }
    // A group's sentence has exactly one correct word. Blanking a ranked
    // alternative would demand an answer the sentence does not want.
    if (g.order[0] !== id) {
      errors.push(`${at} (${key}): id must be the group's order[0] (${g.order[0]}), not a ranked alternative`)
      return
    }
    en = g.en
  }

  const tokens = en.trim().split(/\s+/)

  if (!Array.isArray(cuts) || cuts.some(x => !Number.isInteger(x))) {
    errors.push(`${at} (${key}): cuts must be an array of integers`)
    return
  }
  const cs = cuts as number[]
  const floor = MIN_CHUNKS[src]
  if (cs.length + 1 < floor) {
    errors.push(`${at} (${key}): ${cs.length + 1} chunks, floor for ${src} is ${floor}`)
  }
  if (cs.length > 0 && cs[0] < 1) errors.push(`${at} (${key}): first cut is ${cs[0]} — would make an empty chunk`)
  for (let k = 1; k < cs.length; k++) {
    if (cs[k] <= cs[k - 1]) errors.push(`${at} (${key}): cuts are not strictly increasing at index ${k}`)
  }
  if (cs.length > 0 && cs[cs.length - 1] >= tokens.length) {
    errors.push(`${at} (${key}): last cut ${cs[cs.length - 1]} is past the final token (${tokens.length - 1})`)
  }

  const bounds = [0, ...cs, tokens.length]
  for (let k = 0; k + 1 < bounds.length; k++) {
    const len = bounds[k + 1] - bounds[k]
    if (len > MAX_CHUNK_TOKENS) {
      errors.push(`${at} (${key}): chunk ${k} is ${len} tokens (max ${MAX_CHUNK_TOKENS}) — "${tokens.slice(bounds[k], bounds[k + 1]).join(' ')}"`)
    }
  }

  if (!Number.isInteger(blank) || (blank as number) < 0 || (blank as number) >= tokens.length) {
    errors.push(`${at} (${key}): blank is ${JSON.stringify(blank)}, outside 0..${tokens.length - 1}`)
    return
  }
  if (typeof answer !== 'string' || !/^[a-z]+(-[a-z]+)*$/.test(answer)) {
    errors.push(`${at} (${key}): answer must be lowercase letters and internal hyphens, got ${JSON.stringify(answer)}`)
    return
  }
  const tok = normalize(tokens[blank as number])
  if (tok !== answer) {
    errors.push(`${at} (${key}): answer is "${answer}" but token ${blank} is "${tokens[blank as number]}"`)
  }
  // The whole point of the mode is retrieving *this* word. A blank whose
  // token does not belong to the word being practised is an annotation
  // pointing at the wrong place.
  if (!tok.startsWith(id.slice(0, Math.min(4, id.length)))) {
    errors.push(`${at} (${key}): blanked token "${tok}" does not look like a form of ${id}`)
  }
  // A second form of the same word elsewhere in the sentence hands the answer
  // over. `placate` has an example reading "…to placate passengers stranded
  // overnight, which placated almost no one" — blank either one and the other
  // is still on screen.
  //
  // **One word must be a prefix of the other**, not merely share a prefix
  // with it. A shared-first-five-characters rule flagged `interceded` against
  // `intern,` on its first run, which are unrelated words that happen to open
  // the same way. The length gap is capped at four so a prefix relation
  // between genuinely different words (`preside` inside `president…`) does
  // not fire either.
  const inflection = (a: string, b: string): boolean => {
    if (a === b) return true
    const [short, long] = a.length <= b.length ? [a, b] : [b, a]
    return short.length >= 4 && long.length - short.length <= 4 && long.startsWith(short)
  }
  const leak = tokens.findIndex((t, k) => k !== blank && inflection(answer, normalize(t)))
  if (leak !== -1) {
    errors.push(`${at} (${key}): token ${leak} ("${tokens[leak]}") is another form of the answer — the blank gives itself away`)
  }
})

if (errors.length > 0) {
  console.error(`sentenceChunks: ${errors.length} error(s)`)
  for (const e of errors) console.error('  ' + e)
  process.exit(1)
}

const list = data.chunks as { src: string; id: string }[]
const covered = new Set(list.map(c => c.id))
const ex = list.filter(c => c.src === 'ex').length
console.log(`sentenceChunks: ${list.length} annotations OK (${ex} ex, ${list.length - ex} sg), covering ${covered.size} words`)

/**
 * Words with only one annotated sentence, reported and never enforced.
 *
 * 组句 lets a hard word repeat within a session, but only from distinct
 * sentences — the second pass through the same sentence tests the sentence,
 * not the word. A word with one annotation can therefore never be asked
 * twice, which is the ceiling on "难词多题" and worth being able to see.
 */
const perWord = new Map<string, number>()
for (const c of list) perWord.set(c.id, (perWord.get(c.id) ?? 0) + 1)
const thin = [...perWord.entries()].filter(([, n]) => n < 2).length
console.log(`${thin} of ${perWord.size} covered words have a single sentence — those can never be asked twice in a round.`)
