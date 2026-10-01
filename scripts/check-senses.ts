// scripts/check-senses.ts
/**
 * Asks Jev which sense of its headword each 回想 rendering's English example
 * uses, and prints every rendering whose `sense` tag it disagrees with or
 * agrees with only unsurely.
 *
 * The tag picks the English hint (`hintFor`), so a wrong one points the
 * learner at a different meaning than the sentence is about. The 09-12 audit
 * tagged by character overlap and could not see part of speech; Jev, asked
 * over the 904 renderings on polysemous words on 2026-10-01, disagreed 59
 * times, and read by hand 37 of those were wrong tags (`harangued` on the
 * noun, `mimed` on 哑剧演员), 14 were Jev wrong and 8 read either way.
 *
 * Jev is a typed-judgment model (TypeSafe AI): it answers a choice question
 * with a probability and writes no prose. It reads English best, which is
 * why it is shown the English example and the English glosses only.
 *
 * Agreement is not proof. A second pass over the same 904 the same day
 * moved 7 of the doubtful band (5 in, 2 out) while the confident band held,
 * and one that moved in, `stoic#3`, was a wrong tag the first pass had
 * agreed with. Run it once per batch and read what it prints; re-running
 * to make a line go away proves nothing.
 *
 * Measured by hand the same day over the first pass's 845 agreements: all
 * 93 below 0.9 confidence held 3 wrong tags (`stoic#3`, `grouse#1`,
 * `ramble#4` — each a noun tagged as its verb or adjective); 50 drawn at
 * random from the 752 at or above 0.9 held none, which bounds that band
 * at roughly 6% wrong (rule of three), not at zero. So an unsure agreement
 * is printed too: 93 lines over the library, a few per batch, at a 3% hit
 * rate on exactly the part-of-speech slip Jev misses.
 *
 * Every line is advice, never an edit: the person reads it and decides.
 * Exit 0 with a report, 2 on a missing key or a failed API call. Needs
 * TYPESAFE_API_KEY (environment, or .env.local, which is gitignored), so it
 * never runs in CI.
 *
 *   npx tsx scripts/check-senses.ts                 every rendering on a polysemous word
 *   npx tsx scripts/check-senses.ts --ids a,b,c     only these words (a batch)
 */
import { existsSync, readFileSync } from 'node:fs'
import type { Word, WordsFile } from '../src/types.ts'
import type { RecallSentence, RecallSentencesFile } from '../src/lib/recallSentence.ts'

/**
 * Pinned, not `jev-latest`: the threshold below was measured on this
 * version. Bump it and re-run the whole library against the tags first.
 */
export const MODEL = 'jev-1.13.0'

/**
 * Splits both sides (2026-10-01): a disagreement at or above it was a wrong
 * tag 33 times in 34, below it 3 in 25; an agreement below it 3 in 93,
 * above it 0 in 50 sampled. Only a confident agreement goes unprinted.
 */
export const CONFIDENT = 0.9

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
const CONCURRENCY = 8

export function readKey(envFile: string | undefined, fromEnv: string | undefined): string | undefined {
  if (fromEnv?.trim()) return fromEnv.trim()
  const line = envFile?.split(/\r?\n/).find((l) => l.startsWith('TYPESAFE_API_KEY='))
  const value = line?.slice('TYPESAFE_API_KEY='.length).trim().replace(/^(['"])(.*)\1$/, '$2')
  return value || undefined
}

export interface Item {
  key: string
  id: string
  i: number
  headword: string
  sentence: string
  meanings: Word['meanings']
  tag: number
}

/** Renderings on polysemous words. A missing word or example is skipped, never thrown on. */
export function buildItems(words: Word[], sentences: RecallSentence[], ids?: Set<string>): Item[] {
  const byId = new Map(words.map((w) => [w.id, w]))
  const items: Item[] = []
  for (const s of sentences) {
    if (ids && !ids.has(s.id)) continue
    const w = byId.get(s.id)
    const sentence = w?.examples[s.i]
    if (!w || w.meanings.length < 2 || typeof sentence !== 'string') continue
    items.push({ key: `${s.id}#${s.i}`, id: s.id, i: s.i, headword: w.headword, sentence, meanings: w.meanings, tag: s.sense ?? 0 })
  }
  return items
}

/**
 * One choice question over every sense. Measured against a yes/no "is this
 * the first sense?" question on the same 904: AUROC 0.970 against 0.946,
 * because the yes/no form could not separate a sense from its other part
 * of speech (`relapse` the noun from `relapse` the verb).
 */
export function requestBody(item: Item) {
  return {
    model: MODEL,
    state: item.sentence,
    questions: {
      sense: {
        type: 'choice' as const,
        instructions: `Which meaning of the word "${item.headword}" is used in this sentence?`,
        criteria: Object.fromEntries(item.meanings.map((m, k) => [`s${k}`, `(${m.pos}) ${m.en}`])),
      },
    },
  }
}

export interface Verdict {
  pick: number | null
  confidence: number
  verdict: 'agree' | 'unsure' | 'retag' | 'read'
}

/** A malformed answer goes to be read: counting it as agreement would hide it. */
export function classify(tag: number, response: unknown): Verdict {
  const answer = (response as { answers?: { sense?: { choice?: unknown; confidence?: unknown } } } | null)?.answers?.sense
  const m = typeof answer?.choice === 'string' ? /^s(\d+)$/.exec(answer.choice) : null
  const confidence = typeof answer?.confidence === 'number' ? answer.confidence : 0
  if (!m) return { pick: null, confidence, verdict: 'read' }
  const pick = Number(m[1])
  if (pick === tag) return { pick, confidence, verdict: confidence >= CONFIDENT ? 'agree' : 'unsure' }
  return { pick, confidence, verdict: confidence >= CONFIDENT ? 'retag' : 'read' }
}

async function ask(key: string, item: Item, attempt = 0): Promise<unknown> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody(item)),
  })
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    return ask(key, item, attempt + 1)
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

async function main() {
  const args = process.argv.slice(2)
  const idsAt = args.indexOf('--ids')
  if (idsAt !== -1 && !args[idsAt + 1]) {
    console.error('--ids requires a comma-separated list of word ids')
    process.exit(2)
  }
  const ids = idsAt === -1 ? undefined : new Set(args[idsAt + 1].split(',').map((s) => s.trim()).filter(Boolean))

  const key = readKey(existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : undefined, process.env.TYPESAFE_API_KEY)
  if (!key) {
    console.error('TYPESAFE_API_KEY is not set (environment or .env.local)')
    process.exit(2)
  }

  const words = (JSON.parse(readFileSync('data/words.json', 'utf8')) as WordsFile).words
  const sentences = (JSON.parse(readFileSync('src/data/recallSentences.json', 'utf8')) as RecallSentencesFile).sentences
  const items = buildItems(words, sentences, ids)
  if (ids) {
    const missing = [...ids].filter((id) => !items.some((it) => it.id === id))
    if (missing.length) console.log(`no rendering on a polysemous word, nothing to ask: ${missing.join(', ')}`)
  }

  const results: { item: Item; v: Verdict }[] = []
  const queue = [...items]
  let tokens = 0
  try {
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let item = queue.shift(); item; item = queue.shift()) {
          const response = await ask(key, item)
          tokens += (response as { usage?: { input_tokens?: number } }).usage?.input_tokens ?? 0
          results.push({ item, v: classify(item.tag, response) })
        }
      }),
    )
  } catch (e) {
    console.error(`Jev request failed after ${results.length} of ${items.length}: ${(e as Error).message}`)
    process.exit(2)
  }

  // Every sense with its part of speech: most wrong tags were the right
  // meaning in the wrong word class, which only shows beside the others.
  const show = ({ item, v }: { item: Item; v: Verdict }) => {
    const senses = item.meanings.map((m, k) => {
      const marks = [k === item.tag && 'tagged', k === v.pick && 'Jev'].filter(Boolean).join(', ')
      return `    s${k} (${m.pos}) ${m.en}${marks ? `  <- ${marks}` : ''}`
    })
    if (v.pick === null) senses.push('    (Jev gave no usable answer)')
    return [`  ${item.key}  confidence ${v.confidence.toFixed(2)}`, `    ${item.sentence}`, ...senses].join('\n')
  }
  const byKey = (a: { item: Item }, b: { item: Item }) => a.item.key.localeCompare(b.item.key)
  const band = (verdict: Verdict['verdict']) => results.filter((r) => r.v.verdict === verdict).sort(byKey)
  const sections = [
    [band('retag'), `confident disagreement (>= ${CONFIDENT}) — a wrong tag 33 times in 34; read, then fix the tag:`],
    [band('read'), `doubtful disagreement (< ${CONFIDENT}) — usually Jev wrong; change only what is clearly wrong:`],
    [band('unsure'), `unsure agreement (< ${CONFIDENT}) — a wrong tag 3 times in 93, each a noun tagged as its verb or adjective; check the part of speech:`],
  ] as const

  const cost = ((tokens * 0.042) / 1e6).toFixed(4)
  console.log(`check-senses: ${results.length} renderings asked, ${sections.reduce((n, [rows]) => n + rows.length, 0)} to read (${tokens} input tokens, ~$${cost})`)
  for (const [rows, heading] of sections) {
    if (!rows.length) continue
    console.log(`\n${heading}`)
    rows.forEach((r) => console.log(show(r)))
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('check-senses.ts')) await main()
