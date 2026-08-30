import { existsSync, readFileSync } from 'node:fs'

/**
 * Authoring aid for src/data/sentenceChunks.json.
 *
 * Chunk boundaries are authored, not derived — a splitter cutting only at
 * safe boundaries lands 1.0% of the library's sentences in the 5–6 chunk
 * range (see the design doc). What *can* be mechanised is everything around
 * the judgement call: printing each candidate with its tokens numbered so cut
 * indices are read off rather than counted, locating the blank, and skipping
 * whatever is already annotated.
 *
 *   npm run chunk-worksheet -- sg --limit 40
 *   npm run chunk-worksheet -- ex --limit 40 --offset 80
 *
 * Output is one block per sentence:
 *
 *   sg#12  succumb  (14 tokens, floor 4)  blank=9
 *     0:He 1:held 2:out 3:through 4:the 5:whole 6:meeting 7:and 8:then
 *     9:succumbed 10:to 11:the 12:leftover 13:cake.
 */

const args = process.argv.slice(2)
const pool = args.find(a => a === 'ex' || a === 'sg') ?? 'sg'
const num = (flag: string, fallback: number): number => {
  const k = args.indexOf(flag)
  return k === -1 ? fallback : Number(args[k + 1] ?? fallback)
}
const limit = num('--limit', 40)
const offset = num('--offset', 0)

const words = JSON.parse(readFileSync('data/words.json', 'utf8')).words as {
  id: string; headword: string; examples: string[]
}[]
const byId = new Map(words.map(w => [w.id, w]))
const groups = JSON.parse(readFileSync('src/data/senseGroups.json', 'utf8')).groups as {
  en: string; order: string[]
}[]
const renderings = JSON.parse(readFileSync('src/data/recallSentences.json', 'utf8')).sentences as {
  id: string; i: number; zh: string
}[]

const OUT = 'src/data/sentenceChunks.json'
const done = new Set<string>(
  existsSync(OUT)
    ? (JSON.parse(readFileSync(OUT, 'utf8')).chunks as { src: string; id: string; i: number }[])
      .map(c => `${c.src}:${c.id}:${c.i}`)
    : [],
)

/** Shortest English token count that can carry the floor at ~2.5 tokens a chunk. */
const MIN_TOKENS: Record<string, number> = { ex: 12, sg: 10 }
const FLOOR: Record<string, number> = { ex: 5, sg: 4 }

const normalize = (s: string): string =>
  s.trim().toLowerCase().replace(/^[^a-z0-9]+/, '').replace(/[^a-z0-9]+$/, '')

/**
 * Where the practised word sits, by prefix against the lemma. Reported, never
 * trusted — validate-sentence-chunks re-derives `answer` from the token and
 * fails if the two disagree, so a wrong guess here becomes a loud error
 * rather than a silently mis-blanked question.
 */
const findBlank = (tokens: string[], id: string): number => {
  const stem = id.slice(0, Math.min(4, id.length))
  return tokens.findIndex(t => normalize(t).startsWith(stem))
}

/**
 * Multi-word idiom entries, which cannot host a blank.
 *
 * `smoking-gun`, `move-the-needle`, `pull-the-plug` — blanking one token of a
 * phrase asks for a word with no single defensible answer (`the ___ gun`
 * takes half a dozen), and a defensible answer marked wrong is the one
 * failure this mode must not have. Detected rather than listed: an idiom id's
 * later segments appear in the sentence as separate words, while a genuinely
 * hyphenated single word like `self-esteem` never does.
 */
const isPhrase = (id: string, en: string): boolean => {
  const parts = id.split('-')
  if (parts.length < 2) return false
  const hay = ` ${en.toLowerCase().replace(/[^a-z\s-]/g, '')} `
  return parts.slice(1).every(seg => hay.includes(` ${seg} `))
}

interface Row { key: string; id: string; tokens: string[]; blank: number }

const rows: Row[] = []
if (pool === 'sg') {
  groups.forEach((g, i) => {
    const id = g.order[0]
    const tokens = g.en.trim().split(/\s+/)
    if (tokens.length < MIN_TOKENS.sg) return
    if (byId.get(id) === undefined) return
    if (isPhrase(id, g.en)) return
    if (done.has(`sg:${id}:${i}`)) return
    const blank = findBlank(tokens, id)
    if (blank === -1) return
    rows.push({ key: `sg#${i}`, id, tokens, blank })
  })
} else {
  // One sentence per word, breadth before depth — the mode is usable at one
  // each, and depth only changes how often a hard word can repeat.
  const taken = new Set<string>()
  for (const s of renderings) {
    const w = byId.get(s.id)
    if (w === undefined || w.examples[s.i] === undefined) continue
    if (taken.has(s.id) || done.has(`ex:${s.id}:${s.i}`)) continue
    const tokens = w.examples[s.i].trim().split(/\s+/)
    if (tokens.length < MIN_TOKENS.ex) continue
    if (isPhrase(s.id, w.examples[s.i])) continue
    const blank = findBlank(tokens, s.id)
    if (blank === -1) continue
    taken.add(s.id)
    rows.push({ key: `ex#${s.id}#${s.i}`, id: s.id, tokens, blank })
  }
}

const slice = rows.slice(offset, offset + limit)
console.log(`# ${pool}: ${rows.length} unannotated candidates, showing ${slice.length} from ${offset}\n`)
for (const r of slice) {
  console.log(`${r.key}  ${r.id}  (${r.tokens.length} tokens, floor ${FLOOR[pool]})  blank=${r.blank} "${normalize(r.tokens[r.blank])}"`)
  const numbered = r.tokens.map((t, k) => `${k}:${t}`)
  for (let k = 0; k < numbered.length; k += 9) console.log('  ' + numbered.slice(k, k + 9).join(' '))
  console.log('')
}
